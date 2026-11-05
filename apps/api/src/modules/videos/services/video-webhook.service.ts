import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { ERROR_CODES } from '@ce/shared';
import { AppException } from '../../../common/errors/app-exception.js';
import { AppConfig } from '../../../config/app-config.service.js';
import { safeEqual } from '../../../core/crypto/crypto.service.js';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { QUEUES } from '../../../core/queue/queue.constants.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { VideosRepository } from '../videos.repository.js';
import { VideoProcessingService } from './video-processing.service.js';

export const VIDEO_JOBS = { SYNC: 'video-sync', MAINTAIN: 'video-maintain', USAGE: 'video-usage' } as const;

interface BunnyWebhookBody { VideoLibraryId?: number | string; VideoGuid?: string; Status?: number }

/**
 * Bunny Stream webhooks.
 *
 * Authenticity: the webhook URL configured in Bunny carries a secret (`?secret=`), compared in
 * constant time. The body is then treated as a hint only — the video status is re-read from the
 * authenticated Bunny API, so a forged or replayed request can at most cause a harmless re-read.
 * Idempotency: each delivery is stored once under a key derived from the body and the video's
 * processing round; duplicates are acknowledged without reprocessing.
 */
@Injectable()
export class VideoWebhookService {
  private readonly log = new Logger(VideoWebhookService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly config: AppConfig,
    private readonly repo: VideosRepository,
    private readonly processing: VideoProcessingService,
    @InjectQueue(QUEUES.VIDEO) private readonly queue: Queue,
  ) {}

  private assertSecret(secret: string | undefined) {
    const expected = this.config.get('BUNNY_STREAM_WEBHOOK_SECRET');
    // Without a configured secret the endpoint does not exist (no unauthenticated mode).
    if (!expected || expected.length < 24) throw AppException.notFound('Not found');
    if (!secret || !safeEqual(secret, expected)) throw new AppException(ERROR_CODES.UNAUTHENTICATED, 'Invalid webhook credentials', HttpStatus.UNAUTHORIZED);
  }

  async receive(secret: string | undefined, rawBody: Buffer | undefined) {
    this.assertSecret(secret);
    let body: BunnyWebhookBody;
    try {
      body = JSON.parse((rawBody ?? Buffer.alloc(0)).toString('utf8') || '{}');
    } catch {
      throw AppException.validation([{ field: 'body', message: 'Invalid JSON' }]);
    }
    const guid = typeof body.VideoGuid === 'string' ? body.VideoGuid : null;
    if (!guid || !/^[A-Za-z0-9-]{8,64}$/.test(guid)) throw AppException.validation([{ field: 'VideoGuid', message: 'Missing video id' }]);
    if (String(body.VideoLibraryId ?? '') !== String(this.config.get('BUNNY_STREAM_LIBRARY_ID'))) {
      return { received: true, ignored: 'other library' };
    }
    const video = await this.repo.findByProviderId('BUNNY', guid);
    if (!video) return { received: true, ignored: 'unknown video' };
    const key = createHash('sha256').update(rawBody ?? '').update(`:${video.processingRound}`).digest('hex');
    let eventId: string;
    try {
      const ev = await this.prisma.videoProcessingEvent.create({
        data: { tenantId: video.tenantId, videoAssetId: video.id, provider: 'BUNNY', providerEventId: key, eventType: `status.${Number(body.Status ?? -1)}`, eventPayload: body as Prisma.InputJsonValue },
      });
      eventId = ev.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { received: true, duplicate: true };
      throw e;
    }
    try {
      const after = await this.ctx.run(video.tenantId, () => this.processing.sync(video.id, 'WEBHOOK'));
      await this.prisma.videoProcessingEvent.update({ where: { id: eventId }, data: { processedAt: new Date(), result: `status=${after.status}` } });
      return { received: true, status: after.status };
    } catch (e) {
      // Provider unreachable: acknowledge (so Bunny does not hammer us) and retry from the queue.
      this.log.warn(`Webhook for ${video.id} deferred: ${(e as Error).message}`);
      await this.prisma.videoProcessingEvent.update({ where: { id: eventId }, data: { result: `deferred: ${(e as Error).message}`.slice(0, 255) } });
      await this.queue.add(VIDEO_JOBS.SYNC, { tenantId: video.tenantId, videoId: video.id, eventId }, { attempts: 6, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: true, removeOnFail: 200 });
      return { received: true, deferred: true };
    }
  }
}
