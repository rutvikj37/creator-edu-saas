import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppException } from '../../common/errors/app-exception.js';
import { Paginated } from '../../common/interceptors/response-envelope.interceptor.js';
import { AppConfig } from '../../config/app-config.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { QUEUES } from '../../core/queue/queue.constants.js';
import { REDIS_CLIENT } from '../../core/redis/redis.constants.js';
import { StorageService } from '../../core/storage/storage.service.js';
import type { BackupStatus } from '../../generated/prisma/client.js';
import { VIDEO_PROVIDER, type VideoProvider } from '../videos/providers/video-provider.interface.js';
import { BACKUP_JOBS } from '../videos/services/video-processing.service.js';
import { BACKUP_PROVIDER, type BackupProvider } from './providers/backup-provider.interface.js';
import { DriveError } from './providers/google-drive/google-drive.service.js';
import { EncryptStream, unwrapKey, wrapKey, type WrappedKey } from './services/backup-crypto.js';
import { BackupVerificationService } from './services/backup-verification.service.js';
import { BunnyApiError } from '../videos/providers/bunny/bunny.client.js';

export const BACKUP_JOB_OPTS = { attempts: 5, backoff: { type: 'exponential' as const, delay: 60_000 }, removeOnComplete: true, removeOnFail: 200 };
/** Free space we keep beyond the file itself before starting a backup. */
const SPACE_MARGIN = 1.05;

export class BackupFailure extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

export function isRetryable(e: unknown) {
  if (e instanceof BackupFailure || e instanceof DriveError || e instanceof BunnyApiError) return e.retryable;
  return /ECONNRESET|ETIMEDOUT|socket hang up|network/i.test(String((e as Error)?.message));
}

const folderFor = (tenantId: string, courseId: string | null | undefined, kind: 'Videos' | 'Documents' | 'Metadata') => [`Academy-${tenantId}`, 'Courses', `Course-${courseId ?? 'unassigned'}`, kind];

/**
 * Encrypted backups of original video uploads and selected documents in Google Drive.
 * Runs only in the worker; never blocks video processing. Students never see these files.
 */
@Injectable()
export class BackupsService {
  private readonly log = new Logger(BackupsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly verification: BackupVerificationService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue(QUEUES.BACKUPS) private readonly queue: Queue,
    @Inject(BACKUP_PROVIDER) private readonly store: BackupProvider,
    @Inject(VIDEO_PROVIDER) private readonly videos: VideoProvider,
  ) {}

  private masterKey() {
    const k = this.config.get('BACKUP_ENCRYPTION_KEY');
    if (!k) throw new BackupFailure('BACKUP_ENCRYPTION_KEY is not set', false);
    return Buffer.from(k, 'base64');
  }

  private async setStatus(model: 'videoBackup' | 'documentBackup', id: string, status: BackupStatus, data: Record<string, unknown> = {}) {
    await (this.prisma[model] as any).update({ where: { id }, data: { status, ...data } });
  }

  // ── video backup (worker) ────────────────────────────────
  async backupVideo(tenantId: string, videoId: string, ctx: { attempt: number; finalAttempt: boolean }) {
    const video = await this.prisma.videoAsset.findFirst({ where: { id: videoId, tenantId } });
    if (!video || video.provider !== 'BUNNY' || !video.providerAssetId) return { skipped: 'not a provider video' };
    const rec = await this.prisma.videoBackup.upsert({
      where: { tenantId_videoAssetId: { tenantId, videoAssetId: videoId } },
      create: { tenantId, videoAssetId: videoId, provider: 'GOOGLE_DRIVE', backupFilename: `${videoId}.enc` },
      update: {},
    });
    if (rec.status === 'COMPLETED') return { skipped: 'already backed up' };
    if (!(await this.store.isConnected())) {
      await this.setStatus('videoBackup', rec.id, 'PENDING', { errorMessage: 'Waiting for Google Drive to be connected' });
      return { skipped: 'drive not connected' };
    }
    await this.setStatus('videoBackup', rec.id, 'IN_PROGRESS', { attempts: { increment: 1 }, startedAt: new Date(), errorMessage: null });
    let uploadedId: string | null = null;
    try {
      const original = await this.videos.downloadOriginal(video.providerAssetId);
      if (!original) throw new BackupFailure('The provider has no original file for this video. Enable “Keep original files” in the Bunny library.', !['READY', 'FAILED'].includes(video.status));
      const expected = original.size ?? (video.originalSize ? Number(video.originalSize) : null);
      await this.assertSpace(expected);
      const dataKey = randomBytes(32);
      const wrapped = wrapKey(dataKey, this.masterKey());
      const enc = new EncryptStream(dataKey);
      const folder = await this.store.ensureFolder(folderFor(tenantId, video.courseId, 'Videos'));
      await this.store.ensureFolder([`Academy-${tenantId}`, 'Database']);
      const name = `${videoId}${extOf(video.originalFilename)}.enc`;
      const uploading = this.store.upload({ folderId: folder, name, body: original.stream.pipe(enc), mimeType: 'application/octet-stream', properties: { kind: 'video-original', videoId, tenantId, format: 'TXB1' } });
      original.stream.on('error', (e) => enc.destroy(e));
      const stored = await uploading;
      uploadedId = stored.fileId;
      const m = enc.result();
      const problems = this.verification.checkUpload(m, stored, { originalSize: video.originalSize ? Number(video.originalSize) : null, providerSha256: video.originalHash });
      if (problems.length) throw new BackupFailure(`Verification failed: ${problems.join('; ')}`, true);
      const meta = await this.writeMetadata(tenantId, video.courseId, `${videoId}.json`, {
        kind: 'video-original', format: 'TXB1', videoId, tenantId, courseId: video.courseId, lessonId: video.lessonId, title: video.title,
        originalFilename: video.originalFilename, mimeType: video.mimeType, provider: 'BUNNY', providerVideoId: video.providerAssetId,
        originalBytes: m.plainBytes, originalSha256: m.plainSha256, encryptedBytes: m.cipherBytes, encryptedMd5: m.cipherMd5,
        encryption: wrapped, backupFileId: stored.fileId, createdAt: new Date().toISOString(),
      });
      await this.setStatus('videoBackup', rec.id, 'COMPLETED', {
        driveFileId: stored.fileId, metadataFileId: meta, backupFilename: name, backupSize: BigInt(m.cipherBytes), originalSize: BigInt(m.plainBytes),
        checksum: m.plainSha256, encryptedMd5: m.cipherMd5, encryption: wrapped as never, completedAt: new Date(), errorMessage: null,
      });
      return { completed: true, bytes: m.plainBytes };
    } catch (e) {
      if (uploadedId) await this.store.remove(uploadedId).catch(() => null); // never keep an unverified copy
      const retry = isRetryable(e) && !ctx.finalAttempt;
      await this.setStatus('videoBackup', rec.id, retry ? 'RETRYING' : 'FAILED', { errorMessage: String((e as Error).message).slice(0, 500) });
      if (retry) throw e; // BullMQ retries with backoff
      this.log.warn(`Video backup ${videoId} failed: ${(e as Error).message}`);
      return { failed: (e as Error).message };
    }
  }

  private async assertSpace(bytes: number | null) {
    const q = await this.store.quota();
    if (q.limit === null || !bytes) return;
    if (q.limit - q.usage < bytes * SPACE_MARGIN) throw new BackupFailure('Not enough free space in Google Drive for this backup', false);
  }

  private async writeMetadata(tenantId: string, courseId: string | null, name: string, data: Record<string, unknown>) {
    const folder = await this.store.ensureFolder(folderFor(tenantId, courseId, 'Metadata'));
    const f = await this.store.upload({ folderId: folder, name, body: Readable.from([Buffer.from(JSON.stringify(data, null, 2))]), mimeType: 'application/json', properties: { kind: 'backup-metadata', tenantId } });
    return f.fileId;
  }

  // ── document backup (worker) ─────────────────────────────
  async backupDocument(tenantId: string, fileAssetId: string, ctx: { finalAttempt: boolean }) {
    const file = await this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId } });
    if (!file || file.status !== 'READY') return { skipped: 'file not ready' };
    const rec = await this.prisma.documentBackup.findFirst({ where: { tenantId, fileAssetId } });
    if (!rec || rec.status === 'COMPLETED') return { skipped: 'nothing to do' };
    if (!(await this.store.isConnected())) {
      await this.setStatus('documentBackup', rec.id, 'PENDING', { errorMessage: 'Waiting for Google Drive to be connected' });
      return { skipped: 'drive not connected' };
    }
    await this.setStatus('documentBackup', rec.id, 'IN_PROGRESS', { attempts: { increment: 1 }, startedAt: new Date(), errorMessage: null });
    let uploadedId: string | null = null;
    try {
      await this.assertSpace(Number(file.sizeBytes));
      const dataKey = randomBytes(32);
      const wrapped = wrapKey(dataKey, this.masterKey());
      const enc = new EncryptStream(dataKey);
      const src = await this.storage.readStream(file);
      src.on('error', (e) => enc.destroy(e));
      const folder = await this.store.ensureFolder(folderFor(tenantId, rec.courseId, 'Documents'));
      const name = `${file.id}${extOf(file.fileName)}.enc`;
      const stored = await this.store.upload({ folderId: folder, name, body: src.pipe(enc), mimeType: 'application/octet-stream', properties: { kind: 'document', fileAssetId: file.id, tenantId, format: 'TXB1' } });
      uploadedId = stored.fileId;
      const m = enc.result();
      const problems = this.verification.checkUpload(m, stored, { originalSize: Number(file.sizeBytes) });
      if (problems.length) throw new BackupFailure(`Verification failed: ${problems.join('; ')}`, true);
      await this.writeMetadata(tenantId, rec.courseId, `${file.id}.json`, { kind: 'document', format: 'TXB1', fileAssetId: file.id, tenantId, courseId: rec.courseId, fileName: file.fileName, mimeType: file.mimeType, originalBytes: m.plainBytes, originalSha256: m.plainSha256, encryption: wrapped, backupFileId: stored.fileId });
      await this.setStatus('documentBackup', rec.id, 'COMPLETED', { driveFileId: stored.fileId, backupFilename: name, backupSize: BigInt(m.cipherBytes), originalSize: BigInt(m.plainBytes), checksum: m.plainSha256, encryptedMd5: m.cipherMd5, encryption: wrapped as never, completedAt: new Date() });
      return { completed: true };
    } catch (e) {
      if (uploadedId) await this.store.remove(uploadedId).catch(() => null);
      const retry = isRetryable(e) && !ctx.finalAttempt;
      await this.setStatus('documentBackup', rec.id, retry ? 'RETRYING' : 'FAILED', { errorMessage: String((e as Error).message).slice(0, 500) });
      if (retry) throw e;
      return { failed: (e as Error).message };
    }
  }

  /** Queues every lesson file of a course for backup. */
  async backupCourseDocuments(courseId: string, actorUserId: string) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId }, select: { id: true, tenantId: true, title: true } });
    if (!course) throw AppException.notFound('Course not found');
    const lessons = await this.prisma.courseLesson.findMany({ where: { tenantId: course.tenantId, courseId, fileAssetId: { not: null } }, select: { fileAssetId: true } });
    const ids = [...new Set(lessons.map((l) => l.fileAssetId!))];
    for (const fileAssetId of ids) {
      const file = await this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId: course.tenantId }, select: { fileName: true } });
      if (!file) continue;
      const rec = await this.prisma.documentBackup.upsert({
        where: { tenantId_fileAssetId: { tenantId: course.tenantId, fileAssetId } },
        create: { tenantId: course.tenantId, fileAssetId, courseId, provider: 'GOOGLE_DRIVE', backupFilename: `${fileAssetId}.enc` },
        update: {},
      });
      if (rec.status !== 'COMPLETED') await this.queue.add(BACKUP_JOBS.DOCUMENT, { tenantId: course.tenantId, fileAssetId }, { ...BACKUP_JOB_OPTS, jobId: `backup-document-${rec.id}-${Date.now()}` });
    }
    await this.audit.record({ action: 'backup.documents_queued', tenantId: course.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Course', targetId: courseId, after: { files: ids.length } });
    return { queued: ids.length };
  }

  // ── administration ───────────────────────────────────────
  async list(q: { status?: BackupStatus; tenantId?: string; kind?: 'video' | 'document'; page: number; pageSize: number }) {
    const where = { ...(q.status ? { status: q.status } : {}), ...(q.tenantId ? { tenantId: q.tenantId } : {}) };
    const skip = (q.page - 1) * q.pageSize;
    if (q.kind === 'document') {
      const [rows, total] = await Promise.all([this.prisma.documentBackup.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take: q.pageSize }), this.prisma.documentBackup.count({ where })]);
      const files = await this.prisma.fileAsset.findMany({ where: { id: { in: rows.map((r) => r.fileAssetId) } }, select: { id: true, fileName: true } });
      const tenants = await this.tenants(rows.map((r) => r.tenantId));
      return new Paginated(rows.map((r) => ({ ...this.viewDoc(r), fileName: files.find((f) => f.id === r.fileAssetId)?.fileName ?? null, tenant: tenants.get(r.tenantId) ?? null })), { page: q.page, pageSize: q.pageSize, total });
    }
    const [rows, total] = await Promise.all([this.prisma.videoBackup.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take: q.pageSize, include: { video: { select: { id: true, title: true, originalFilename: true, status: true } } } }), this.prisma.videoBackup.count({ where })]);
    const tenants = await this.tenants(rows.map((r) => r.tenantId));
    return new Paginated(rows.map((r) => ({ ...this.view(r), video: r.video, tenant: tenants.get(r.tenantId) ?? null })), { page: q.page, pageSize: q.pageSize, total });
  }

  private async tenants(ids: string[]) {
    const rows = await this.prisma.tenant.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, slug: true } });
    return new Map(rows.map((t) => [t.id, t]));
  }

  private view(r: Record<string, any>) {
    return {
      id: r.id, kind: 'video', tenantId: r.tenantId, videoId: r.videoAssetId, provider: r.provider, status: r.status, driveFileId: r.driveFileId, metadataFileId: r.metadataFileId,
      backupFilename: r.backupFilename, backupSize: r.backupSize !== null ? Number(r.backupSize) : null, originalSize: r.originalSize !== null ? Number(r.originalSize) : null,
      checksum: r.checksum, encryptedMd5: r.encryptedMd5, encrypted: Boolean(r.encryption), attempts: r.attempts, startedAt: r.startedAt, completedAt: r.completedAt,
      errorMessage: r.errorMessage, restoreStatus: r.restoreStatus, restoredAt: r.restoredAt, restoreError: r.restoreError, updatedAt: r.updatedAt,
    };
  }

  private viewDoc(r: Record<string, any>) {
    return { ...this.view({ ...r, videoAssetId: null, metadataFileId: null, restoreStatus: null, restoredAt: null, restoreError: null }), kind: 'document', fileAssetId: r.fileAssetId, courseId: r.courseId };
  }

  async get(id: string) {
    const v = await this.prisma.videoBackup.findUnique({ where: { id }, include: { video: { select: { id: true, title: true, originalFilename: true, status: true, providerAssetId: true } } } });
    if (v) return { ...this.view(v), video: v.video, tenant: (await this.tenants([v.tenantId])).get(v.tenantId) ?? null };
    const d = await this.prisma.documentBackup.findUnique({ where: { id } });
    if (d) return { ...this.viewDoc(d), tenant: (await this.tenants([d.tenantId])).get(d.tenantId) ?? null };
    throw AppException.notFound('Backup not found');
  }

  async retry(id: string, actorUserId: string) {
    const v = await this.prisma.videoBackup.findUnique({ where: { id } });
    const d = v ? null : await this.prisma.documentBackup.findUnique({ where: { id } });
    const rec = v ?? d;
    if (!rec) throw AppException.notFound('Backup not found');
    if (rec.status === 'COMPLETED') throw AppException.conflict('This backup already completed.');
    if (rec.status === 'IN_PROGRESS') throw AppException.conflict('This backup is running.');
    if (v) {
      await this.prisma.videoBackup.update({ where: { id }, data: { status: 'PENDING', errorMessage: null } });
      await this.queue.add(BACKUP_JOBS.VIDEO, { tenantId: v.tenantId, videoId: v.videoAssetId }, { ...BACKUP_JOB_OPTS, jobId: `backup-video-${v.videoAssetId}-${Date.now()}` });
    } else {
      await this.prisma.documentBackup.update({ where: { id }, data: { status: 'PENDING', errorMessage: null } });
      await this.queue.add(BACKUP_JOBS.DOCUMENT, { tenantId: d!.tenantId, fileAssetId: d!.fileAssetId }, { ...BACKUP_JOB_OPTS, jobId: `backup-document-${id}-${Date.now()}` });
    }
    await this.audit.record({ action: 'backup.retry', tenantId: rec.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: v ? 'VideoBackup' : 'DocumentBackup', targetId: id });
    return this.get(id);
  }

  async requestRestore(id: string, actorUserId: string) {
    const b = await this.prisma.videoBackup.findUnique({ where: { id }, include: { video: true } });
    if (!b) throw AppException.notFound('Backup not found (only video backups can be restored to the video host)');
    if (b.status !== 'COMPLETED' || !b.driveFileId) throw AppException.conflict('Only completed backups can be restored.');
    if (b.restoreStatus === 'IN_PROGRESS') throw AppException.conflict('A restore is already running.');
    if (['DELETING', 'DELETED'].includes(b.video.status)) throw AppException.conflict('The video was deleted; restore is not available.');
    await this.prisma.videoBackup.update({ where: { id }, data: { restoreStatus: 'IN_PROGRESS', restoreError: null } });
    await this.queue.add(BACKUP_JOBS.RESTORE, { backupId: id, actorUserId }, { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: true, removeOnFail: 200, jobId: `restore-${id}-${Date.now()}` });
    await this.audit.record({ action: 'backup.restore_requested', tenantId: b.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'VideoBackup', targetId: id });
    return this.get(id);
  }

  dataKey(encryption: unknown) {
    return unwrapKey(encryption as WrappedKey, this.masterKey());
  }

  /** Drive quota with a low-space flag (cached 5 minutes). */
  async quota(force = false) {
    const status = await (this.store as unknown as { status(): Promise<Record<string, unknown>> }).status();
    if (!status.connected) return { ...status, quota: null };
    const cached = !force && (await this.redis.get('drive:quota'));
    const q = cached ? JSON.parse(cached) : await this.store.quota();
    if (!cached) await this.redis.set('drive:quota', JSON.stringify(q), 'EX', 300);
    const row = await this.prisma.platformSetting.findUnique({ where: { key: 'backups.driveLowSpacePercent' } });
    const threshold = typeof row?.value === 'number' ? row.value : 10;
    const free = q.limit === null ? null : Math.max(0, q.limit - q.usage);
    const freePercent = q.limit ? Math.round((free! / q.limit) * 1000) / 10 : null;
    return { ...status, quota: { ...q, free, freePercent, lowSpace: freePercent !== null && freePercent < threshold, lowSpaceThresholdPercent: threshold } };
  }

  /** Hourly: pick up backups that waited for a Drive connection; warn when space is low. */
  async sweep() {
    if (!(await this.store.isConnected())) return { queued: 0 };
    const pending = await this.prisma.videoBackup.findMany({ where: { status: 'PENDING', updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } }, take: 200 });
    for (const b of pending) await this.queue.add(BACKUP_JOBS.VIDEO, { tenantId: b.tenantId, videoId: b.videoAssetId }, { ...BACKUP_JOB_OPTS, jobId: `backup-video-${b.videoAssetId}-${Date.now()}` });
    const docs = await this.prisma.documentBackup.findMany({ where: { status: 'PENDING', updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } }, take: 200 });
    for (const d of docs) await this.queue.add(BACKUP_JOBS.DOCUMENT, { tenantId: d.tenantId, fileAssetId: d.fileAssetId }, { ...BACKUP_JOB_OPTS, jobId: `backup-document-${d.id}-${Date.now()}` });
    const q = await this.quota(true).catch(() => null);
    const quota = (q as { quota?: { lowSpace?: boolean; freePercent?: number } } | null)?.quota;
    if (quota?.lowSpace) this.log.warn(`Google Drive backup space is low: ${quota.freePercent}% free`);
    return { queued: pending.length + docs.length, lowSpace: Boolean(quota?.lowSpace) };
  }

}

function extOf(name: string | null | undefined) {
  const m = name?.match(/\.[A-Za-z0-9]{1,8}$/);
  return m ? m[0].toLowerCase() : '';
}
