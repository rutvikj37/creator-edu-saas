import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { AppException } from '../../../common/errors/app-exception.js';
import { AppConfig } from '../../../config/app-config.service.js';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { QUEUES } from '../../../core/queue/queue.constants.js';
import { REDIS_CLIENT } from '../../../core/redis/redis.constants.js';
import { TENANT_PRISMA } from '../../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.service.js';
import type { VideoStatus } from '../../../generated/prisma/client.js';
import { VIDEO_PROVIDER, type ProviderVideo, type VideoProvider } from '../providers/video-provider.interface.js';
import { type StatusSource, VideosRepository } from '../videos.repository.js';
import { providerError } from './provider-error.js';

export const BACKUP_JOBS = { VIDEO: 'backup-video', DOCUMENT: 'backup-document', RESTORE: 'restore-video', QUOTA: 'drive-quota' } as const;
const STALE_SYNC_MS = 2 * 60_000;
const ABANDONED_UPLOAD_DAYS = 7;

/** Internal status a provider state leads to (CREATED keeps the upload-side status). */
function target(state: ProviderVideo['state'], current: VideoStatus): VideoStatus | null {
  switch (state) {
    case 'CREATED': return null;
    case 'UPLOADED': return current === 'PROCESSING' || current === 'READY' ? null : 'UPLOADED';
    case 'PROCESSING': return 'PROCESSING';
    case 'READY': return 'READY';
    case 'FAILED': return 'FAILED';
  }
}

/**
 * Processing status is always taken from the provider API — never from the browser or a webhook
 * body. Webhooks and the browser only trigger a re-read (`sync`).
 */
@Injectable()
export class VideoProcessingService {
  private readonly log = new Logger(VideoProcessingService.name);
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly config: AppConfig,
    private readonly repo: VideosRepository,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue(QUEUES.BACKUPS) private readonly backups: Queue,
    @Inject(VIDEO_PROVIDER) private readonly provider: VideoProvider,
  ) {}

  /** Re-reads a video from the provider and applies the result. Returns the updated row. */
  async sync(videoId: string, source: StatusSource) {
    const video = await this.repo.find(videoId);
    if (!video) throw AppException.notFound('Video not found');
    if (video.provider !== 'BUNNY' || !video.providerAssetId || ['DELETING', 'DELETED'].includes(video.status)) return video;
    let remote: ProviderVideo;
    try {
      remote = await this.provider.getVideo(video.providerAssetId);
    } catch (e) {
      throw providerError(e, 'Could not read the video status from the provider');
    }
    const now = new Date();
    const meta = {
      providerStatus: remote.rawStatus,
      durationSeconds: remote.durationSeconds ?? video.durationSeconds,
      width: remote.width, height: remote.height,
      availableResolutions: remote.availableResolutions.join(',').slice(0, 255) || null,
      thumbnailUrl: remote.thumbnailUrl?.slice(0, 1024) ?? null,
      storageSize: remote.storageBytes !== null ? BigInt(remote.storageBytes) : null,
      encodeProgress: remote.encodeProgress,
      originalHash: remote.originalHash,
      lastSyncedAt: now,
    };
    const to = target(remote.state, video.status);
    let updated = null;
    if (to && to !== video.status) {
      const extra: Record<string, unknown> = { ...meta };
      if (to === 'PROCESSING' && !video.processingStartedAt) extra.processingStartedAt = now;
      if (to === 'READY') Object.assign(extra, { readyAt: now, errorMessage: null });
      if (to === 'FAILED') extra.errorMessage = remote.rawStatus === 6 ? 'The upload failed at the provider. Upload the file again.' : 'The provider could not process this video. Retry processing or upload a different file.';
      try {
        updated = await this.repo.transition(video.id, to, source, `Provider status ${remote.rawStatus} (${remote.state})`, extra);
      } catch (e) {
        this.log.warn(`Ignoring provider state ${remote.state} for ${video.id}: ${(e as Error).message}`);
      }
    }
    if (!updated) updated = await this.db.videoAsset.update({ where: { id: video.id }, data: meta });
    // The original is at the provider once it reports anything past CREATED: start the backup.
    if (remote.state !== 'CREATED' && remote.state !== 'FAILED') await this.enqueueBackup(video.tenantId, video.id);
    return updated;
  }

  async enqueueBackup(tenantId: string, videoId: string) {
    const flag = `video:backup-queued:${videoId}`;
    if (!(await this.redis.set(flag, '1', 'EX', 7 * 86_400, 'NX'))) return;
    await this.backups.add(BACKUP_JOBS.VIDEO, { tenantId, videoId }, { jobId: `backup-video-${videoId}`, attempts: 1, removeOnComplete: true, removeOnFail: 100 });
  }

  /** Status for the UI. Provider-hosted videos still in flight are re-read (at most every 10 s). */
  async status(videoId: string) {
    const v = await this.repo.find(videoId);
    if (!v) throw AppException.notFound('Video not found');
    const inFlight = ['UPLOAD_AUTHORIZED', 'UPLOADING', 'UPLOADED', 'PROCESSING'].includes(v.status);
    if (v.provider === 'BUNNY' && inFlight && (await this.redis.set(`video:status-read:${v.id}`, '1', 'EX', 10, 'NX'))) {
      await this.sync(v.id, 'SYNC').catch((e) => this.log.warn(`Status refresh failed for ${v.id}: ${e.message}`));
    }
    const fresh = (await this.repo.find(videoId))!;
    const backup = await this.db.videoBackup.findFirst({ where: { videoAssetId: v.id }, select: { status: true, completedAt: true, errorMessage: true } });
    return { id: fresh.id, status: fresh.status, encodeProgress: fresh.encodeProgress, errorMessage: fresh.errorMessage, durationSeconds: fresh.durationSeconds, readyAt: fresh.readyAt, lastSyncedAt: fresh.lastSyncedAt, backup };
  }

  async retryProcessing(videoId: string) {
    const v = await this.repo.find(videoId);
    if (!v || v.provider !== 'BUNNY' || !v.providerAssetId) throw AppException.notFound('Video not found');
    if (v.status !== 'FAILED') throw AppException.conflict('Only failed videos can be retried.');
    if (v.providerStatus === 6 || !v.providerStatus) throw AppException.conflict('The file never reached the provider. Upload it again.');
    try {
      await this.provider.reprocess(v.providerAssetId);
    } catch (e) {
      throw providerError(e, 'The provider refused to reprocess this video');
    }
    await this.repo.transition(v.id, 'PROCESSING', 'USER', 'Processing retried', { processingRound: v.processingRound + 1, processingStartedAt: new Date(), errorMessage: null });
    return this.status(v.id);
  }

  /** Detailed view for the library/details screen. */
  async view(videoId: string) {
    const v = await this.db.videoAsset.findFirst({ where: { id: videoId } });
    if (!v) throw AppException.notFound('Video not found');
    const [lessons, backup, course, sessions, history, file] = await Promise.all([
      this.db.courseLesson.findMany({ where: { videoAssetId: v.id }, select: { id: true, title: true, course: { select: { id: true, title: true } } } }),
      this.db.videoBackup.findFirst({ where: { videoAssetId: v.id }, select: { id: true, status: true, startedAt: true, completedAt: true, errorMessage: true, attempts: true, backupSize: true } }),
      v.courseId ? this.db.course.findFirst({ where: { id: v.courseId }, select: { id: true, title: true } }) : null,
      this.db.videoUploadSession.findMany({ where: { videoAssetId: v.id }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, uploadStatus: true, attempt: true, uploadStartedAt: true, uploadCompletedAt: true, errorMessage: true, createdAt: true } }),
      this.repo.history(v.id),
      v.sourceFileId ? this.db.fileAsset.findFirst({ where: { id: v.sourceFileId }, select: { fileName: true, sizeBytes: true, mimeType: true } }) : null,
    ]);
    return serializeVideo(v, { usedIn: lessons, backup, course, uploadSessions: sessions, history, file });
  }

  /**
   * Worker sweep: re-reads videos stuck in flight, fails those past the processing timeout,
   * expires upload authorisations, cleans up abandoned provider entries and retries deletions.
   */
  async maintain(now = new Date()) {
    const res = { synced: 0, timedOut: 0, expiredUploads: 0, cleaned: 0, deleted: 0 };
    if (!this.provider.isConfigured()) return res;
    const timeoutMs = this.config.get('VIDEO_PROCESSING_TIMEOUT_MINUTES') * 60_000;
    const inflight = await this.prisma.videoAsset.findMany({
      where: { provider: 'BUNNY', deletedAt: null, status: { in: ['UPLOADING', 'UPLOADED', 'PROCESSING'] }, OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(now.getTime() - STALE_SYNC_MS) } }] },
      take: 200, orderBy: { updatedAt: 'asc' },
    });
    for (const v of inflight) {
      await this.ctx.run(v.tenantId, async () => {
        const after = await this.sync(v.id, 'SYNC').catch((e) => { this.log.warn(`Sync failed for ${v.id}: ${e.message}`); return null; });
        res.synced += after ? 1 : 0;
        const cur = after ?? v;
        const since = (cur.processingStartedAt ?? cur.updatedAt).getTime();
        if (['UPLOADED', 'PROCESSING'].includes(cur.status) && now.getTime() - since > timeoutMs) {
          await this.repo.transition(v.id, 'FAILED', 'WORKER', 'Processing timed out', { errorMessage: 'Processing took too long. Retry processing or upload again.' }).catch(() => null);
          res.timedOut++;
        }
      });
    }
    // Upload authorisations that ran out.
    const expired = await this.prisma.videoUploadSession.updateMany({ where: { uploadStatus: { in: ['AUTHORIZED', 'UPLOADING'] }, authorizationExpiresAt: { lt: now } }, data: { uploadStatus: 'EXPIRED' } });
    res.expiredUploads = expired.count;
    // Videos whose upload never happened: confirm with the provider, then fail and remove the empty entry.
    const stale = await this.prisma.videoAsset.findMany({
      where: { provider: 'BUNNY', deletedAt: null, status: { in: ['UPLOAD_AUTHORIZED', 'UPLOADING'] }, uploadSessions: { none: { uploadStatus: { in: ['AUTHORIZED', 'UPLOADING'] } } } },
      take: 100,
    });
    for (const v of stale) {
      await this.ctx.run(v.tenantId, async () => {
        const after = await this.sync(v.id, 'SYNC').catch(() => null);
        if (after && ['UPLOAD_AUTHORIZED', 'UPLOADING'].includes(after.status)) {
          await this.repo.transition(v.id, 'FAILED', 'WORKER', 'Upload authorisation expired without a file', { errorMessage: 'The upload did not finish. Upload the file again.' }).catch(() => null);
          res.cleaned++;
        }
      });
    }
    // Failed uploads abandoned for a week: remove the empty provider entry (the record stays for history).
    const abandoned = await this.prisma.videoAsset.findMany({
      where: { provider: 'BUNNY', deletedAt: null, status: 'FAILED', providerAssetId: { not: null }, OR: [{ providerStatus: null }, { providerStatus: { in: [0, 6] } }], updatedAt: { lt: new Date(now.getTime() - ABANDONED_UPLOAD_DAYS * 86_400_000) } },
      take: 50,
    });
    for (const v of abandoned) {
      await this.provider.deleteVideo(v.providerAssetId!).then(() => this.prisma.videoAsset.update({ where: { id: v.id }, data: { providerAssetId: null } })).then(() => res.cleaned++).catch(() => null);
    }
    // Deletions that could not reach the provider earlier.
    const deleting = await this.prisma.videoAsset.findMany({ where: { status: 'DELETING' }, take: 50 });
    for (const v of deleting) {
      await this.ctx.run(v.tenantId, () => this.finishDeletion(v.id).then(() => res.deleted++).catch(() => null));
    }
    return res;
  }

  async finishDeletion(videoId: string) {
    const v = await this.prisma.videoAsset.findUnique({ where: { id: videoId } });
    if (!v || v.status !== 'DELETING') return;
    if (v.provider === 'BUNNY' && v.providerAssetId) await this.provider.deleteVideo(v.providerAssetId);
    await this.repo.transition(v.id, 'DELETED', 'WORKER', 'Removed from the provider', { deletedAt: v.deletedAt ?? new Date() });
  }
}

export function serializeVideo(v: Record<string, any>, extra: Record<string, unknown> = {}) {
  return {
    id: v.id, title: v.title, provider: v.provider, providerVideoId: v.providerAssetId, status: v.status, protection: v.protection,
    courseId: v.courseId, lessonId: v.lessonId, originalFilename: v.originalFilename, mimeType: v.mimeType,
    originalSize: v.originalSize !== null && v.originalSize !== undefined ? Number(v.originalSize) : null,
    durationSeconds: v.durationSeconds, width: v.width, height: v.height, thumbnailUrl: v.thumbnailUrl,
    availableResolutions: v.availableResolutions ? String(v.availableResolutions).split(',') : [],
    storageSize: v.storageSize !== null && v.storageSize !== undefined ? Number(v.storageSize) : null,
    encodeProgress: v.encodeProgress, errorMessage: v.errorMessage, readyAt: v.readyAt, lastSyncedAt: v.lastSyncedAt,
    createdById: v.createdById, createdAt: v.createdAt, updatedAt: v.updatedAt,
    ...extra,
  };
}
