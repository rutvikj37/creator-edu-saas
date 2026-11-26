import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ERROR_CODES } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { LearningService } from '../learning/learning.service.js';
import { isEnrollmentUsable } from '../learning/access.js';
import { VIDEO_PROVIDER, type VideoProvider } from './providers/video-provider.interface.js';
import { fetchYouTubeMeta, isExternalProvider, parseExternalVideoUrl, probeDriveThumbnail } from './external-video.js';
import { VideosRepository } from './videos.repository.js';
import { VideoPlaybackService, MAX_CONCURRENT_STREAMS, playbackTtlSeconds } from './services/video-playback.service.js';
import { VideoProcessingService, serializeVideo } from './services/video-processing.service.js';
import { providerError } from './services/provider-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';

export { MAX_CONCURRENT_STREAMS, playbackTtlSeconds };
/** Lesson is auto-completed once this share of the video has been watched. */
export const COMPLETE_AT = 0.9;
const ACTIVE_BACKUP = ['PENDING', 'IN_PROGRESS', 'RETRYING'] as const;

/**
 * Video library and student playback:
 * - STORAGE (Phase 6): private storage, short-lived signed URLs, no transcoding.
 * - BUNNY: Bunny Stream encoding/HLS/CDN with token-authenticated embeds.
 * - YOUTUBE / GOOGLE_DRIVE: external links played via embed (no hosting/transcoding).
 * Bunny/storage are not DRM: a determined viewer can still capture the stream.
 */
@Injectable()
export class VideosService {
  private readonly log = new Logger(VideosService.name);
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly storage: StorageService,
    private readonly learning: LearningService,
    private readonly audit: AuditService,
    private readonly repo: VideosRepository,
    private readonly processing: VideoProcessingService,
    private readonly playback: VideoPlaybackService,
    @Inject(VIDEO_PROVIDER) private readonly provider: VideoProvider,
  ) {}

  private async view(v: NonNullable<Awaited<ReturnType<TenantPrismaClient['videoAsset']['findFirst']>>>) {
    const [file, lessons, backup, course, session] = await Promise.all([
      v.sourceFileId ? this.db.fileAsset.findFirst({ where: { id: v.sourceFileId }, select: { fileName: true, sizeBytes: true, mimeType: true } }) : null,
      this.db.courseLesson.findMany({ where: { videoAssetId: v.id }, select: { id: true, title: true, course: { select: { id: true, title: true } } } }),
      this.db.videoBackup.findFirst({ where: { videoAssetId: v.id }, select: { status: true, completedAt: true, errorMessage: true } }),
      v.courseId ? this.db.course.findFirst({ where: { id: v.courseId }, select: { id: true, title: true } }) : null,
      // A recording of a live class or webinar session (asset library "Webinar" / "Live recording" filters).
      this.db.liveSession.findFirst({ where: { videoAssetId: v.id }, select: { startsAt: true, liveClassId: true } }),
    ]);
    const live = session ? await this.db.liveClass.findFirst({ where: { id: session.liveClassId }, select: { id: true, title: true, kind: true } }) : null;
    return serializeVideo(v, { file: file && { ...file, sizeBytes: Number(file.sizeBytes) }, usedIn: lessons, backup, course, liveRecording: live && { liveClassId: live.id, title: live.title, kind: live.kind, startsAt: session!.startsAt } });
  }

  async list(q: { status?: string; courseId?: string; q?: string } = {}) {
    const rows = await this.db.videoAsset.findMany({
      where: {
        deletedAt: null, status: q.status ? (q.status as never) : { not: 'DELETED' },
        ...(q.courseId ? { courseId: q.courseId } : {}),
        ...(q.q ? { title: { contains: q.q } } : {}),
      },
      orderBy: { createdAt: 'desc' }, take: 500,
    });
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async create(dto: { fileId: string; title: string; durationSeconds?: number }, actorUserId: string) {
    const file = await this.db.fileAsset.findUnique({ where: { id: dto.fileId } });
    if (!file || file.purpose !== 'VIDEO_SOURCE') throw AppException.validation([{ field: 'fileId', message: 'Upload a video file first' }]);
    if (file.status !== 'READY') throw AppException.validation([{ field: 'fileId', message: 'The upload has not finished or was rejected' }]);
    if (await this.db.videoAsset.findFirst({ where: { sourceFileId: file.id, deletedAt: null } })) throw AppException.conflict('This upload is already in your library.');
    // Storage delivery needs no transcoding, so the asset is playable as soon as the upload is verified.
    const v = await this.db.videoAsset.create({
      data: { title: dto.title, sourceFileId: file.id, provider: 'STORAGE', status: 'READY', protection: 'SIGNED', durationSeconds: dto.durationSeconds ?? null, originalFilename: file.fileName, mimeType: file.mimeType, originalSize: file.sizeBytes, readyAt: new Date(), createdById: actorUserId } as never,
    });
    await this.audit.record({ action: 'video.create', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'VideoAsset', targetId: v.id, after: { title: dto.title } });
    return this.view(v);
  }

  /**
   * Adds a YouTube or Google Drive link to the library as a READY asset (no Bunny upload).
   * Fetches a title/thumbnail when the remote host allows it.
   */
  async createFromLink(
    dto: { url: string; title?: string; courseId?: string | null; lessonId?: string | null },
    actorUserId: string,
  ) {
    const parsed = parseExternalVideoUrl(dto.url);
    if (!parsed) {
      throw AppException.validation([{ field: 'url', message: 'Paste a YouTube or Google Drive link (https://…)' }]);
    }
    await this.assertLinkTargets(actorUserId, dto.courseId, dto.lessonId);

    const existing = await this.db.videoAsset.findFirst({
      where: { provider: parsed.provider, providerAssetId: parsed.providerAssetId, deletedAt: null },
    });
    if (existing) throw AppException.conflict('This video is already in your library.');

    let title = dto.title?.trim() || null;
    let thumbnailUrl = parsed.thumbnailUrl;
    if (parsed.provider === 'YOUTUBE') {
      const meta = await fetchYouTubeMeta(parsed.externalUrl);
      if (!title && meta.title) title = meta.title;
      if (meta.thumbnailUrl) thumbnailUrl = meta.thumbnailUrl;
    } else if (parsed.provider === 'GOOGLE_DRIVE' && thumbnailUrl) {
      thumbnailUrl = await probeDriveThumbnail(thumbnailUrl);
    }
    if (!title) title = parsed.provider === 'YOUTUBE' ? `YouTube ${parsed.providerAssetId}` : `Drive video ${parsed.providerAssetId.slice(0, 8)}`;

    const v = await this.db.videoAsset.create({
      data: {
        title: title.slice(0, 200),
        provider: parsed.provider,
        providerAssetId: parsed.providerAssetId,
        externalUrl: parsed.externalUrl,
        status: 'READY',
        protection: 'SIGNED',
        thumbnailUrl: thumbnailUrl?.slice(0, 1024) ?? null,
        courseId: dto.courseId ?? null,
        lessonId: dto.lessonId ?? null,
        readyAt: new Date(),
        createdById: actorUserId,
      } as never,
    });

    if (dto.lessonId) {
      await this.db.courseLesson.update({
        where: { id: dto.lessonId },
        data: { videoAssetId: v.id, isPublished: true },
      });
    }

    await this.audit.record({
      action: 'video.create', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM',
      targetType: 'VideoAsset', targetId: v.id,
      after: { title: v.title, provider: parsed.provider, externalUrl: parsed.externalUrl },
    });
    return this.view(v);
  }

  /** Course/lesson must belong to this academy; instructors may only use courses they teach. */
  private async assertLinkTargets(userId: string, courseId?: string | null, lessonId?: string | null) {
    if (lessonId && !courseId) throw AppException.validation([{ field: 'courseId', message: 'Choose the course of this lesson' }]);
    if (!courseId) return;
    const course = await this.db.course.findFirst({ where: { id: courseId, deletedAt: null }, select: { id: true } });
    if (!course) throw AppException.notFound('Course not found');
    const member = await this.prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId: this.ctx.requireTenantId(), userId } },
      include: { role: { select: { key: true } } },
    });
    if (member?.role.key === 'INSTRUCTOR' && !(await this.db.courseInstructor.findFirst({ where: { courseId, userId } }))) {
      throw AppException.forbidden('You can only add videos to courses you teach.');
    }
    if (lessonId) {
      const lesson = await this.db.courseLesson.findFirst({ where: { id: lessonId, courseId }, select: { type: true } });
      if (!lesson) throw AppException.notFound('Lesson not found in this course');
      if (lesson.type !== 'VIDEO') throw AppException.validation([{ field: 'lessonId', message: 'Only video lessons take a video' }]);
    }
  }

  private externalEmbed(v: { provider: string; providerAssetId: string | null; externalUrl: string | null; durationSeconds: number | null }) {
    if (!isExternalProvider(v.provider) || !v.providerAssetId) return null;
    const parsed = parseExternalVideoUrl(v.externalUrl ?? (v.provider === 'YOUTUBE'
      ? `https://www.youtube.com/watch?v=${v.providerAssetId}`
      : `https://drive.google.com/file/d/${v.providerAssetId}/view`));
    if (!parsed) return null;
    return {
      kind: 'iframe' as const,
      url: parsed.embedUrl,
      external: true as const,
      provider: v.provider,
      durationSeconds: v.durationSeconds,
      expiresAt: null as Date | null,
      drm: false,
      drmTier: null as string | null,
      drmLabel: null as string | null,
    };
  }

  async get(id: string) {
    const v = await this.repo.find(id);
    if (!v || v.status === 'DELETED') throw AppException.notFound('Video not found');
    return v;
  }

  async details(id: string) {
    await this.get(id);
    return this.processing.view(id);
  }

  /** Title, duration (storage videos) and lesson assignment. Assigning requires a READY video. */
  async update(id: string, dto: { title?: string; durationSeconds?: number | null; courseId?: string | null; lessonId?: string | null; tags?: string[] }, actorUserId?: string) {
    const v = await this.get(id);
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.tags !== undefined) data.tags = [...new Set(dto.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
    if (dto.durationSeconds !== undefined && v.provider === 'STORAGE') data.durationSeconds = dto.durationSeconds;
    if (dto.lessonId !== undefined || dto.courseId !== undefined) {
      if (dto.lessonId) {
        const lesson = await this.db.courseLesson.findFirst({ where: { id: dto.lessonId, ...(dto.courseId ? { courseId: dto.courseId } : {}) }, select: { id: true, type: true, courseId: true } });
        if (!lesson) throw AppException.notFound('Lesson not found');
        if (lesson.type !== 'VIDEO') throw AppException.validation([{ field: 'lessonId', message: 'Only video lessons take a video' }]);
        if (v.status !== 'READY') throw AppException.validation([{ field: 'lessonId', message: 'Only READY videos can be added to a lesson' }]);
        await this.db.courseLesson.update({ where: { id: lesson.id }, data: { videoAssetId: v.id, ...(v.durationSeconds ? { durationSeconds: v.durationSeconds } : {}) } });
        Object.assign(data, { lessonId: lesson.id, courseId: lesson.courseId });
      } else if (dto.courseId) {
        if (!(await this.db.course.findFirst({ where: { id: dto.courseId, deletedAt: null }, select: { id: true } }))) throw AppException.notFound('Course not found');
        Object.assign(data, { courseId: dto.courseId, lessonId: null });
      } else {
        Object.assign(data, { courseId: null, lessonId: null });
      }
    }
    const updated = await this.db.videoAsset.update({ where: { id }, data });
    if (actorUserId) await this.audit.record({ action: 'video.update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'VideoAsset', targetId: id, after: data });
    return this.view(updated);
  }

  /** Creator preview: storage → signed URL; Bunny → short-lived token embed; YT/Drive → public embed. */
  async preview(id: string, apiOrigin: string) {
    const v = await this.get(id);
    if (isExternalProvider(v.provider)) {
      if (v.status !== 'READY') throw AppException.conflict('The video is not ready yet.');
      const embed = this.externalEmbed(v);
      if (!embed) throw AppException.conflict('This external video link is invalid.');
      return embed;
    }
    if (v.provider === 'BUNNY') {
      if (v.status !== 'READY' || !v.providerAssetId) throw AppException.conflict('The video is not ready yet.');
      try {
        const auth = await this.provider.authorizePlayback(v.providerAssetId, 3600);
        return {
          kind: 'iframe', url: auth.url, expiresAt: auth.expiresAt, durationSeconds: v.durationSeconds,
          protection: auth.protection, drm: auth.protection === 'mediacage_basic', drmTier: auth.drmTier ?? null,
        };
      } catch (e) {
        throw providerError(e, 'Preview is not available right now');
      }
    }
    const file = await this.db.fileAsset.findUniqueOrThrow({ where: { id: v.sourceFileId! } });
    return { kind: 'file', url: await this.storage.downloadUrl(file, file.fileName, apiOrigin, playbackTtlSeconds(v.durationSeconds)), durationSeconds: v.durationSeconds };
  }

  /**
   * Deletes a video. Blocked while it is used in lessons, or while its original is still being
   * backed up (the original stays at the provider until the backup is verified).
   */
  async remove(id: string, actorUserId: string) {
    const v = await this.get(id);
    const used = await this.db.courseLesson.count({ where: { videoAssetId: id } });
    if (used) throw AppException.conflict(`This video is used in ${used} lesson(s). Detach it first.`);
    const backup = await this.db.videoBackup.findFirst({ where: { videoAssetId: id }, select: { status: true } });
    if (backup && (ACTIVE_BACKUP as readonly string[]).includes(backup.status)) throw AppException.conflict('The original is still being backed up. Try again when the backup has finished.');
    await this.db.videoPlaybackSession.updateMany({ where: { videoAssetId: id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'video_deleted' } });
    if (v.provider === 'STORAGE' || isExternalProvider(v.provider)) {
      // No remote host entry to delete for storage or linked YouTube/Drive assets.
      await this.db.videoAsset.update({ where: { id }, data: { deletedAt: new Date(), status: 'DELETED' } });
    } else {
      if (v.status !== 'DELETING') await this.repo.transition(id, 'DELETING', 'USER', 'Deleted by user', { deletedAt: new Date() });
      // If the provider cannot be reached, the worker finishes the deletion later.
      await this.processing.finishDeletion(id).catch((e) => this.log.warn(`Provider deletion deferred for ${id}: ${e.message}`));
    }
    await this.audit.record({ action: 'video.delete', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'VideoAsset', targetId: id, before: { title: v.title, provider: v.provider } });
    return { deleted: true };
  }

  async assertAttachable(id: string) {
    const v = await this.db.videoAsset.findFirst({ where: { id, deletedAt: null } });
    if (!v) throw AppException.validation([{ field: 'videoAssetId', message: 'Video not found' }]);
    if (v.status !== 'READY') throw AppException.validation([{ field: 'videoAssetId', message: 'This video is not ready yet' }]);
    return v;
  }

  // ── student playback ───────────────────────────────────────
  /** Authorises playback of a lesson's video: signed storage URL, provider token embed, or YT/Drive embed. */
  async startPlayback(userId: string, lessonId: string, meta: { ip?: string; userAgent?: string }, apiOrigin: string) {
    const { lesson, enrollment } = await this.learning.accessibleLesson(userId, lessonId);
    if (lesson.type !== 'VIDEO' || !lesson.videoAssetId) throw AppException.notFound('No video in this lesson');
    const video = await this.db.videoAsset.findFirst({ where: { id: lesson.videoAssetId, deletedAt: null, status: 'READY' } });
    if (!video) throw AppException.notFound('This video is unavailable');
    if (video.provider === 'BUNNY') {
      const r = await this.playback.authorize(userId, lessonId, video.id, meta);
      return { ...r, kind: 'iframe', url: r.player.url, mimeType: null };
    }
    if (isExternalProvider(video.provider)) {
      const embed = this.externalEmbed(video);
      if (!embed) throw AppException.notFound('This video is unavailable');
      await this.playback.assertConcurrency(userId);
      const ttl = playbackTtlSeconds(video.durationSeconds ?? lesson.durationSeconds);
      const session = await this.db.videoPlaybackSession.create({
        data: {
          videoAssetId: video.id, lessonId: lesson.id, userId, enrollmentId: enrollment?.id ?? 'preview',
          ipHash: meta.ip ? createHash('sha256').update(meta.ip).digest('hex') : null, userAgent: meta.userAgent?.slice(0, 512),
          expiresAt: new Date(Date.now() + ttl * 1000),
        } as never,
      });
      const progress = enrollment ? await this.db.lessonProgress.findFirst({ where: { enrollmentId: enrollment.id, lessonId: lesson.id } }) : null;
      return {
        ...embed,
        sessionId: session.id,
        mimeType: null,
        expiresAt: session.expiresAt,
        durationSeconds: video.durationSeconds ?? lesson.durationSeconds,
        resumeAt: progress?.completedAt ? 0 : (progress?.positionSeconds ?? 0),
        preview: !enrollment,
      };
    }
    await this.playback.assertConcurrency(userId);
    const ttl = playbackTtlSeconds(video.durationSeconds ?? lesson.durationSeconds);
    const session = await this.db.videoPlaybackSession.create({
      data: {
        videoAssetId: video.id, lessonId: lesson.id, userId, enrollmentId: enrollment?.id ?? 'preview',
        ipHash: meta.ip ? createHash('sha256').update(meta.ip).digest('hex') : null, userAgent: meta.userAgent?.slice(0, 512),
        expiresAt: new Date(Date.now() + ttl * 1000),
      } as never,
    });
    const file = await this.db.fileAsset.findUniqueOrThrow({ where: { id: video.sourceFileId! } });
    const progress = enrollment ? await this.db.lessonProgress.findFirst({ where: { enrollmentId: enrollment.id, lessonId: lesson.id } }) : null;
    return {
      kind: 'file',
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
