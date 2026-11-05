import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ERROR_CODES } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { LearningService } from '../learning/learning.service.js';
import { isEnrollmentUsable } from '../learning/access.js';

/** Simultaneous playback sessions per student (devices/tabs active in the last 2 minutes). */
export const MAX_CONCURRENT_STREAMS = 3;
const ACTIVE_WINDOW_MS = 2 * 60_000;
/** Lesson is auto-completed once this share of the video has been watched. */
export const COMPLETE_AT = 0.9;

/** Signed URL lifetime: long enough to watch the whole video (players re-request ranges while seeking). */
export function playbackTtlSeconds(durationSeconds: number | null) {
  return Math.min(6 * 3600, Math.max(30 * 60, (durationSeconds ?? 0) * 2 + 30 * 60));
}

/**
 * Video library and playback. Delivery is from private storage through short-lived signed URLs
 * authorised per student and lesson. This is access control, not DRM: a determined viewer can
 * still capture the stream. DRM providers are out of scope for this phase.
 */
@Injectable()
export class VideosService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly storage: StorageService,
    private readonly learning: LearningService,
    private readonly audit: AuditService,
  ) {}

  private async view(v: Awaited<ReturnType<TenantPrismaClient['videoAsset']['findFirst']>> & object) {
    const [file, lessons] = await Promise.all([
      this.db.fileAsset.findUnique({ where: { id: v.sourceFileId }, select: { fileName: true, sizeBytes: true, mimeType: true } }),
      this.db.courseLesson.findMany({ where: { videoAssetId: v.id }, select: { id: true, title: true, course: { select: { id: true, title: true } } } }),
    ]);
    return { ...v, file: file && { ...file, sizeBytes: Number(file.sizeBytes) }, usedIn: lessons };
  }

  async list() {
    const rows = await this.db.videoAsset.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 500 });
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async create(dto: { fileId: string; title: string; durationSeconds?: number }, actorUserId: string) {
    const file = await this.db.fileAsset.findUnique({ where: { id: dto.fileId } });
    if (!file || file.purpose !== 'VIDEO_SOURCE') throw AppException.validation([{ field: 'fileId', message: 'Upload a video file first' }]);
    if (file.status !== 'READY') throw AppException.validation([{ field: 'fileId', message: 'The upload has not finished or was rejected' }]);
    if (await this.db.videoAsset.findFirst({ where: { sourceFileId: file.id, deletedAt: null } })) throw AppException.conflict('This upload is already in your library.');
    // Storage delivery needs no transcoding, so the asset is playable as soon as the upload is verified.
    const v = await this.db.videoAsset.create({
      data: { title: dto.title, sourceFileId: file.id, provider: 'STORAGE', status: 'READY', protection: 'SIGNED', durationSeconds: dto.durationSeconds ?? null, createdById: actorUserId } as never,
    });
    await this.audit.record({ action: 'video.create', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'VideoAsset', targetId: v.id, after: { title: dto.title } });
    return this.view(v);
  }

  async get(id: string) {
    const v = await this.db.videoAsset.findFirst({ where: { id, deletedAt: null } });
    if (!v) throw AppException.notFound('Video not found');
    return v;
  }

  async update(id: string, dto: { title?: string; durationSeconds?: number | null }) {
    await this.get(id);
    return this.view(await this.db.videoAsset.update({ where: { id }, data: dto }));
  }

  async preview(id: string, apiOrigin: string) {
    const v = await this.get(id);
    const file = await this.db.fileAsset.findUniqueOrThrow({ where: { id: v.sourceFileId } });
    return { url: await this.storage.downloadUrl(file, file.fileName, apiOrigin, playbackTtlSeconds(v.durationSeconds)), durationSeconds: v.durationSeconds };
  }

  async remove(id: string, actorUserId: string) {
    const v = await this.get(id);
    const used = await this.db.courseLesson.count({ where: { videoAssetId: id } });
    if (used) throw AppException.conflict(`This video is used in ${used} lesson(s). Detach it first.`);
    await this.db.videoAsset.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.db.videoPlaybackSession.updateMany({ where: { videoAssetId: id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'video_deleted' } });
    await this.audit.record({ action: 'video.delete', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'VideoAsset', targetId: id, before: { title: v.title } });
    return { deleted: true };
  }

  async assertAttachable(id: string) {
    const v = await this.db.videoAsset.findFirst({ where: { id, deletedAt: null } });
    if (!v) throw AppException.validation([{ field: 'videoAssetId', message: 'Video not found' }]);
    if (v.status !== 'READY') throw AppException.validation([{ field: 'videoAssetId', message: 'This video is not ready yet' }]);
    return v;
  }

  // ── student playback ───────────────────────────────────────
  /** Authorises playback of a lesson's video and returns a short-lived signed stream URL. */
  async startPlayback(userId: string, lessonId: string, meta: { ip?: string; userAgent?: string }, apiOrigin: string) {
    const { lesson, enrollment } = await this.learning.accessibleLesson(userId, lessonId);
    if (lesson.type !== 'VIDEO' || !lesson.videoAssetId) throw AppException.notFound('No video in this lesson');
    const video = await this.db.videoAsset.findFirst({ where: { id: lesson.videoAssetId, deletedAt: null, status: 'READY' } });
    if (!video) throw AppException.notFound('This video is unavailable');

    const since = new Date(Date.now() - ACTIVE_WINDOW_MS);
    const active = await this.db.videoPlaybackSession.count({ where: { userId, revokedAt: null, lastSeenAt: { gte: since }, expiresAt: { gt: new Date() } } });
    if (active >= MAX_CONCURRENT_STREAMS) {
      throw new AppException(ERROR_CODES.RATE_LIMITED, `You're watching on too many devices. Close another player and try again.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const ttl = playbackTtlSeconds(video.durationSeconds ?? lesson.durationSeconds);
    const session = await this.db.videoPlaybackSession.create({
      data: {
        videoAssetId: video.id, lessonId: lesson.id, userId, enrollmentId: enrollment?.id ?? 'preview',
        ipHash: meta.ip ? createHash('sha256').update(meta.ip).digest('hex') : null, userAgent: meta.userAgent?.slice(0, 512),
        expiresAt: new Date(Date.now() + ttl * 1000),
      } as never,
    });
    const file = await this.db.fileAsset.findUniqueOrThrow({ where: { id: video.sourceFileId } });
    const progress = enrollment ? await this.db.lessonProgress.findFirst({ where: { enrollmentId: enrollment.id, lessonId: lesson.id } }) : null;
    return {
      sessionId: session.id,
      url: await this.storage.downloadUrl(file, file.fileName, apiOrigin, ttl),
      mimeType: file.mimeType,
      expiresAt: session.expiresAt,
      durationSeconds: video.durationSeconds ?? lesson.durationSeconds,
      resumeAt: progress?.completedAt ? 0 : (progress?.positionSeconds ?? 0),
      preview: !enrollment,
    };
  }

  /**
   * Called every ~15 s by the player: saves position, keeps the session counted as active,
   * and stops playback when access was revoked/expired. Auto-completes the lesson near the end.
   */
  async heartbeat(userId: string, sessionId: string, positionSeconds: number, durationSeconds?: number) {
    const s = await this.db.videoPlaybackSession.findFirst({ where: { id: sessionId, userId } });
    if (!s) throw AppException.notFound('Playback session not found');
    const stop = (reason: string) => new AppException(ERROR_CODES.FORBIDDEN, reason, HttpStatus.FORBIDDEN);
    if (s.revokedAt) throw stop('Playback was stopped.');
    if (s.expiresAt < new Date()) throw stop('Playback session expired. Reload the lesson.');
    if (s.enrollmentId !== 'preview') {
      const e = await this.db.enrollment.findFirst({ where: { id: s.enrollmentId } });
      if (!isEnrollmentUsable(e)) {
        await this.db.videoPlaybackSession.update({ where: { id: s.id }, data: { revokedAt: new Date(), revokeReason: 'access_ended' } });
        throw stop('Your access to this course has ended.');
      }
    }
    await this.db.videoPlaybackSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
    let completed = false;
    if (s.enrollmentId !== 'preview') {
      await this.learning.savePosition(userId, s.lessonId, Math.floor(positionSeconds));
      const video = await this.db.videoAsset.findFirst({ where: { id: s.videoAssetId } });
      const total = video?.durationSeconds ?? durationSeconds ?? null;
      if (total && positionSeconds >= total * COMPLETE_AT) {
        const done = await this.db.lessonProgress.findFirst({ where: { enrollmentId: s.enrollmentId, lessonId: s.lessonId, completedAt: { not: null } } });
        if (!done) {
          await this.learning.complete(userId, s.lessonId, { system: true });
          completed = true;
        }
      }
    }
    return { ok: true, completed };
  }

  async endPlayback(userId: string, sessionId: string) {
    await this.db.videoPlaybackSession.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'ended' } });
    return { ended: true };
  }
}
