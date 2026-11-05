import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@ce/shared';
import { AppException } from '../../../common/errors/app-exception.js';
import { AppConfig } from '../../../config/app-config.service.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.service.js';
import { VIDEO_PROVIDER, type VideoProvider } from '../providers/video-provider.interface.js';
import { VideosRepository } from '../videos.repository.js';
import { VideoProcessingService } from './video-processing.service.js';
import { providerError } from './provider-error.js';

/** Containers Bunny Stream accepts that browsers report reliably. */
export const VIDEO_MIME_TYPES: Record<string, string[]> = {
  'video/mp4': ['mp4', 'm4v'],
  'video/x-m4v': ['m4v'],
  'video/quicktime': ['mov'],
  'video/webm': ['webm'],
  'video/x-matroska': ['mkv'],
  'video/x-msvideo': ['avi'],
  'video/mpeg': ['mpeg', 'mpg'],
  'video/x-ms-wmv': ['wmv'],
  'video/3gpp': ['3gp'],
};

/** Upload credentials last long enough for a large file on a slow connection. */
export const UPLOAD_AUTH_TTL_SECONDS = 12 * 3600;
const TENANT_GROUP_KEY = 'video.bunnyCollectionId';

/** Strips paths, control characters and anything outside a safe set; keeps the extension. */
export function sanitizeFilename(name: string) {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[^\p{L}\p{M}\p{N}\p{Pd} ._()]/gu, '_').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim();
  return (cleaned || 'video').slice(-200);
}

export interface InitiateInput {
  title: string;
  filename: string;
  size: number;
  mimeType: string;
  courseId?: string | null;
  lessonId?: string | null;
  /** Retry the upload of an existing video instead of creating a new one. */
  videoId?: string | null;
}

@Injectable()
export class VideoUploadService {
  private readonly log = new Logger(VideoUploadService.name);
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly config: AppConfig,
    private readonly repo: VideosRepository,
    private readonly audit: AuditService,
    private readonly processing: VideoProcessingService,
    @Inject(VIDEO_PROVIDER) private readonly provider: VideoProvider,
  ) {}

  private assertProvider() {
    if (!this.provider.isConfigured()) throw new AppException(ERROR_CODES.INTEGRATION_NOT_CONFIGURED, 'Video hosting is not configured on this platform yet.', HttpStatus.SERVICE_UNAVAILABLE);
  }

  validateFile(input: Pick<InitiateInput, 'filename' | 'size' | 'mimeType'>) {
    const errors: { field: string; message: string }[] = [];
    const ext = input.filename.split('.').pop()?.toLowerCase() ?? '';
    const allowed = VIDEO_MIME_TYPES[input.mimeType.toLowerCase()];
    if (!allowed) errors.push({ field: 'mimeType', message: 'Unsupported video format. Use MP4, MOV, WebM, MKV, AVI, MPEG, WMV or 3GP.' });
    else if (!allowed.includes(ext)) errors.push({ field: 'filename', message: `The file extension .${ext || '?'} does not match ${input.mimeType}` });
    const max = this.config.get('VIDEO_MAX_UPLOAD_BYTES');
    if (!(input.size > 0)) errors.push({ field: 'size', message: 'The file is empty' });
    else if (input.size > max) errors.push({ field: 'size', message: `The file is larger than the ${Math.floor(max / 1024 ** 3)} GB limit` });
    if (errors.length) throw AppException.validation(errors);
  }

  /** Course/lesson must belong to this academy; instructors may only use courses they teach. */
  private async assertTargets(userId: string, courseId?: string | null, lessonId?: string | null) {
    if (lessonId && !courseId) throw AppException.validation([{ field: 'courseId', message: 'Choose the course of this lesson' }]);
    if (!courseId) return;
    const course = await this.db.course.findFirst({ where: { id: courseId, deletedAt: null }, select: { id: true } });
    if (!course) throw AppException.notFound('Course not found');
    const member = await this.prisma.tenantMember.findUnique({ where: { tenantId_userId: { tenantId: this.ctx.requireTenantId(), userId } }, include: { role: { select: { key: true } } } });
    if (member?.role.key === 'INSTRUCTOR' && !(await this.db.courseInstructor.findFirst({ where: { courseId, userId } }))) {
      throw AppException.forbidden('You can only upload videos to courses you teach.');
    }
    if (lessonId) {
      const lesson = await this.db.courseLesson.findFirst({ where: { id: lessonId, courseId }, select: { type: true } });
      if (!lesson) throw AppException.notFound('Lesson not found in this course');
      if (lesson.type !== 'VIDEO') throw AppException.validation([{ field: 'lessonId', message: 'Only video lessons take a video' }]);
    }
  }

  /** One provider collection per academy keeps provider-side listings separated. */
  private async tenantGroup() {
    const row = await this.db.tenantSetting.findFirst({ where: { key: TENANT_GROUP_KEY } });
    if (row && typeof (row.value as { id?: string })?.id === 'string') return (row.value as { id: string }).id;
    const tenantId = this.ctx.requireTenantId();
    const id = await this.provider.createGroup(`Academy-${tenantId}`);
    await this.prisma.tenantSetting.upsert({ where: { tenantId_key: { tenantId, key: TENANT_GROUP_KEY } }, create: { tenantId, key: TENANT_GROUP_KEY, value: { id } }, update: { value: { id } } });
    return id;
  }

  async initiate(input: InitiateInput, userId: string) {
    this.assertProvider();
    const filename = sanitizeFilename(input.filename);
    this.validateFile({ ...input, filename });
    if (input.videoId) return this.retryUpload(input.videoId, { ...input, filename }, userId);
    await this.assertTargets(userId, input.courseId, input.lessonId);
    const tenantId = this.ctx.requireTenantId();

    const video = await this.db.videoAsset.create({
      data: {
        title: input.title.trim().slice(0, 200), provider: 'BUNNY', status: 'CREATED', protection: 'TOKEN',
        courseId: input.courseId ?? null, lessonId: input.lessonId ?? null, originalFilename: filename,
        mimeType: input.mimeType.toLowerCase(), originalSize: BigInt(input.size), createdById: userId,
      } as never,
    });
    await this.repo.recordCreated(tenantId, video.id, 'USER');
    let providerVideoId: string;
    try {
      const groupId = await this.tenantGroup();
      ({ providerVideoId } = await this.provider.createVideo({ title: video.title, groupId }));
    } catch (e) {
      await this.repo.transition(video.id, 'FAILED', 'API', 'Provider rejected video creation', { errorMessage: 'Could not create the video at the provider' });
      throw providerError(e, 'Could not create the video at the provider');
    }
    await this.db.videoAsset.update({ where: { id: video.id }, data: { providerAssetId: providerVideoId } });
    const session = await this.authorize(video.id, providerVideoId, video.title, video.mimeType!, userId, 1);
    await this.audit.record({ action: 'video.upload_initiated', tenantId, actorUserId: userId, actorRealm: 'PLATFORM', targetType: 'VideoAsset', targetId: video.id, after: { filename, size: input.size, courseId: input.courseId ?? null } });
    return session;
  }

  private async authorize(videoId: string, providerVideoId: string, title: string, mimeType: string, userId: string, attempt: number) {
    const auth = this.provider.authorizeUpload(providerVideoId, UPLOAD_AUTH_TTL_SECONDS, { title, mimeType });
    const session = await this.db.videoUploadSession.create({ data: { videoAssetId: videoId, attempt, authorizationExpiresAt: auth.expiresAt, createdById: userId } as never });
    await this.repo.transition(videoId, 'UPLOAD_AUTHORIZED', 'API', attempt > 1 ? `Upload re-authorised (attempt ${attempt})` : 'Upload authorised');
    return {
      videoId,
      uploadSessionId: session.id,
      upload: { protocol: auth.protocol, endpoint: auth.endpoint, headers: auth.headers, metadata: auth.metadata, expiresAt: auth.expiresAt },
    };
  }

  /** New credentials for a video whose upload failed, expired or was cancelled. */
  private async retryUpload(videoId: string, input: InitiateInput, userId: string) {
    const video = await this.repo.find(videoId);
    if (!video || video.provider !== 'BUNNY') throw AppException.notFound('Video not found');
    if (!['UPLOAD_AUTHORIZED', 'UPLOADING', 'FAILED', 'CREATED'].includes(video.status)) throw AppException.conflict('This video has already been uploaded.');
    let providerVideoId = video.providerAssetId;
    if (providerVideoId) {
      // Reuse the provider entry only while it has no (failed) file; otherwise start a clean entry.
      const remote = await this.provider.getVideo(providerVideoId).catch(() => null);
      if (remote && remote.state !== 'CREATED') {
        if (remote.state !== 'FAILED') throw AppException.conflict('The provider already has this file. Refresh the processing status instead.');
        await this.provider.deleteVideo(providerVideoId).catch((e) => this.log.warn(`Could not delete failed provider entry: ${e}`));
        providerVideoId = null;
      }
    }
    if (!providerVideoId) {
      try {
        ({ providerVideoId } = await this.provider.createVideo({ title: video.title, groupId: await this.tenantGroup() }));
      } catch (e) {
        throw providerError(e, 'Could not create the video at the provider');
      }
    }
    await this.db.videoUploadSession.updateMany({ where: { videoAssetId: videoId, uploadStatus: { in: ['AUTHORIZED', 'UPLOADING'] } }, data: { uploadStatus: 'EXPIRED' } });
    const attempt = (await this.db.videoUploadSession.count({ where: { videoAssetId: videoId } })) + 1;
    await this.db.videoAsset.update({ where: { id: videoId }, data: { providerAssetId: providerVideoId, originalFilename: input.filename, mimeType: input.mimeType.toLowerCase(), originalSize: BigInt(input.size), errorMessage: null } });
    return this.authorize(videoId, providerVideoId!, video.title, input.mimeType.toLowerCase(), userId, attempt);
  }

  /** Browser marks the TUS upload as started (progress began). */
  async started(videoId: string, uploadSessionId: string) {
    const s = await this.session(videoId, uploadSessionId);
    if (s.uploadStatus !== 'AUTHORIZED') return { status: (await this.repo.find(videoId))!.status };
    await this.db.videoUploadSession.update({ where: { id: s.id }, data: { uploadStatus: 'UPLOADING', uploadStartedAt: new Date() } });
    await this.repo.transition(videoId, 'UPLOADING', 'USER', 'Browser started the upload').catch(() => null);
    return { status: (await this.repo.find(videoId))!.status };
  }

  private async session(videoId: string, uploadSessionId: string) {
    const s = await this.db.videoUploadSession.findFirst({ where: { id: uploadSessionId, videoAssetId: videoId } });
    if (!s) throw AppException.notFound('Upload session not found');
    return s;
  }

  /**
   * The browser reports the outcome. Success is only a hint: the status advances after the provider
   * confirms it has the file (now, or later via webhook/sync). Failure/cancel is recorded as reported.
   */
  async complete(input: { videoId: string; uploadSessionId: string; outcome: 'success' | 'failed' | 'cancelled'; error?: string }, userId: string) {
    const video = await this.repo.find(input.videoId);
    if (!video || video.provider !== 'BUNNY') throw AppException.notFound('Video not found');
    const s = await this.session(video.id, input.uploadSessionId);
    if (['COMPLETED', 'EXPIRED'].includes(s.uploadStatus) && input.outcome !== 'success') return this.processing.view(video.id);
    if (input.outcome === 'cancelled') {
      await this.db.videoUploadSession.update({ where: { id: s.id }, data: { uploadStatus: 'CANCELLED' } });
      return this.processing.view(video.id);
    }
    if (input.outcome === 'failed') {
      const msg = `Upload failed: ${(input.error ?? 'unknown error').slice(0, 300)}`;
      await this.db.videoUploadSession.update({ where: { id: s.id }, data: { uploadStatus: 'FAILED', errorMessage: msg } });
      await this.repo.transition(video.id, 'FAILED', 'USER', msg, { errorMessage: msg }).catch(() => null);
      return this.processing.view(video.id);
    }
    await this.db.videoUploadSession.update({ where: { id: s.id }, data: { uploadStatus: 'COMPLETED', uploadCompletedAt: new Date() } });
    await this.audit.record({ action: 'video.upload_completed', tenantId: this.ctx.tenantId, actorUserId: userId, actorRealm: 'PLATFORM', targetType: 'VideoAsset', targetId: video.id });
    // Confirm with the provider; if it cannot be reached now, the webhook or the sync job will.
    await this.processing.sync(video.id, 'API').catch((e) => this.log.warn(`Provider confirmation deferred for ${video.id}: ${e}`));
    return this.processing.view(video.id);
  }
}
