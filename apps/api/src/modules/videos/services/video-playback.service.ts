import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ERROR_CODES } from '@ce/shared';
import { AppException } from '../../../common/errors/app-exception.js';
import { TENANT_PRISMA } from '../../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.service.js';
import { LearningService } from '../../learning/learning.service.js';
import { VIDEO_PROVIDER, type VideoProvider } from '../providers/video-provider.interface.js';
import { providerError } from './provider-error.js';

/** Simultaneous playback sessions per student (devices/tabs active in the last 2 minutes). */
export const MAX_CONCURRENT_STREAMS = 3;
export const ACTIVE_WINDOW_MS = 2 * 60_000;

/** Token lifetime: enough to load and watch the video, never more than 6 hours. */
export function playbackTtlSeconds(durationSeconds: number | null) {
  return Math.min(6 * 3600, Math.max(30 * 60, (durationSeconds ?? 0) * 2 + 30 * 60));
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Playback authorisation for provider-hosted videos. Every grant re-checks the student, the
 * academy, the enrolment, the lesson's publication/locks and the video's ownership, then issues a
 * short-lived provider token. This is token authentication, not DRM (no Widevine/FairPlay).
 */
@Injectable()
export class VideoPlaybackService {
  private readonly log = new Logger(VideoPlaybackService.name);
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly ctx: TenantContext,
    private readonly learning: LearningService,
    @Inject(VIDEO_PROVIDER) private readonly provider: VideoProvider,
  ) {}

  async assertConcurrency(userId: string) {
    const active = await this.db.videoPlaybackSession.count({ where: { userId, revokedAt: null, lastSeenAt: { gte: new Date(Date.now() - ACTIVE_WINDOW_MS) }, expiresAt: { gt: new Date() } } });
    if (active >= MAX_CONCURRENT_STREAMS) {
      throw new AppException(ERROR_CODES.RATE_LIMITED, `You're watching on too many devices. Close another player and try again.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** `videoId` is optional for the lesson-based player; when given it must be the lesson's video. */
  async authorize(userId: string, lessonId: string, videoId: string | null, meta: { ip?: string; userAgent?: string }) {
    // Enrolment (or free preview), lesson publication, drip/locks and tenant are checked here.
    const { lesson, enrollment } = await this.learning.accessibleLesson(userId, lessonId);
    if (lesson.type !== 'VIDEO' || !lesson.videoAssetId || (videoId && lesson.videoAssetId !== videoId)) {
      this.log.warn(`Playback denied: video ${videoId} is not the video of lesson ${lessonId} (user ${userId}, tenant ${this.ctx.tenantId})`);
      throw AppException.notFound('No such video in this lesson');
    }
    const video = await this.db.videoAsset.findFirst({ where: { id: lesson.videoAssetId, deletedAt: null, status: 'READY' } });
    if (!video) throw AppException.notFound('This video is unavailable');
    if (video.provider !== 'BUNNY' || !video.providerAssetId) throw AppException.notFound('This video is unavailable');
    await this.assertConcurrency(userId);

    const ttl = playbackTtlSeconds(video.durationSeconds ?? lesson.durationSeconds);
    let auth;
    try {
      auth = this.provider.authorizePlayback(video.providerAssetId, ttl);
    } catch (e) {
      throw providerError(e, 'Playback is not available right now');
    }
    const token = new URL(auth.url).searchParams.get('token') ?? auth.url;
    const session = await this.db.videoPlaybackSession.create({
      data: {
        videoAssetId: video.id, lessonId: lesson.id, userId, enrollmentId: enrollment?.id ?? 'preview',
        ipHash: meta.ip ? sha(meta.ip) : null, userAgent: meta.userAgent?.slice(0, 512),
        sessionTokenHash: sha(token), expiresAt: auth.expiresAt,
      } as never,
    });
    const progress = enrollment ? await this.db.lessonProgress.findFirst({ where: { enrollmentId: enrollment.id, lessonId: lesson.id } }) : null;
    this.log.log(`Playback granted: session ${session.id} video ${video.id} user ${userId} tenant ${this.ctx.tenantId}`);
    return {
      sessionId: session.id,
      player: { kind: auth.kind, url: auth.url },
      protection: auth.protection,
      drm: false,
      expiresAt: auth.expiresAt,
      durationSeconds: video.durationSeconds ?? lesson.durationSeconds,
      resumeAt: progress?.completedAt ? 0 : (progress?.positionSeconds ?? 0),
      preview: !enrollment,
    };
  }
}
