import { Inject, Injectable, Logger } from '@nestjs/common';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { VIDEO_PROVIDER, type VideoProvider } from '../videos/providers/video-provider.interface.js';
import { VideosRepository } from '../videos/videos.repository.js';
import { PlugNmeetError, PlugNmeetService } from './plugnmeet.service.js';
import { ZoomError } from './zoom.service.js';

/** Writes a stream to a temporary file to learn its size; returns a fresh stream of the file. */
async function spool(body: Readable) {
  const dir = await mkdtemp(join(tmpdir(), 'pnm-rec-'));
  const path = join(dir, 'recording.mp4');
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    await pipeline(body, createWriteStream(path));
    return { stream: createReadStream(path), size: (await stat(path)).size, cleanup };
  } catch (e) {
    await cleanup();
    throw new PlugNmeetError(`download: ${(e as Error).message}`, true);
  }
}

const TENANT_GROUP_KEY = 'video.bunnyCollectionId';
/** How long after a session ends we keep looking for its recordings. */
const DISCOVERY_WINDOW_MS = 48 * 3600_000;
/** No recording found this long after the end: nothing was recorded. */
const NOTHING_RECORDED_MS = 24 * 3600_000;

/**
 * Brings plugNmeet recordings into the academy's video library: Bunny Stream when it is configured
 * (the primary video host), otherwise private storage. Each plugNmeet record id is imported once.
 */
@Injectable()
export class LiveRecordingsService {
  private readonly log = new Logger(LiveRecordingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly pnm: PlugNmeetService,
    private readonly storage: StorageService,
    private readonly repo: VideosRepository,
    @Inject(VIDEO_PROVIDER) private readonly videos: VideoProvider,
  ) {}

  /** Lists recordings of recently ended sessions and registers new ones. Returns rows to import. */
  async discover(now = new Date()) {
    if (!this.pnm.isConfigured()) return [];
    const sessions = await this.prisma.liveSession.findMany({
      where: { status: 'ENDED', recordingStatus: { in: ['RECORDING', 'PROCESSING'] }, endedAt: { gt: new Date(now.getTime() - DISCOVERY_WINDOW_MS) }, liveClass: { provider: 'PLUGNMEET', recordSessions: true } },
      select: { id: true, tenantId: true, roomName: true, endedAt: true }, take: 100,
    });
    const toImport: string[] = [];
    for (const s of sessions) {
      let found;
      try {
        found = await this.pnm.recordings(s.roomName);
      } catch (e) {
        this.log.warn(`fetchRecordings ${s.id}: ${(e as Error).message}`);
        continue;
      }
      for (const r of found.filter((x) => x.roomId === s.roomName)) {
        const existing = await this.prisma.liveRecording.findUnique({ where: { providerRecordingId: r.recordId } });
        if (existing) continue;
        const row = await this.prisma.liveRecording.create({ data: { tenantId: s.tenantId, sessionId: s.id, providerRecordingId: r.recordId, recordedAt: r.createdAt } });
        toImport.push(row.id);
      }
      const rows = await this.prisma.liveRecording.count({ where: { sessionId: s.id } });
      if (!rows && s.endedAt && s.endedAt.getTime() < now.getTime() - NOTHING_RECORDED_MS) await this.prisma.liveSession.update({ where: { id: s.id }, data: { recordingStatus: 'NONE' } });
    }
    // Rows left IMPORTING by a crashed worker are picked up again.
    const stuck = await this.prisma.liveRecording.findMany({ where: { status: 'IMPORTING', updatedAt: { lt: new Date(now.getTime() - 3 * 3600_000) }, NOT: { providerRecordingId: { startsWith: 'zoom:' } } }, select: { id: true }, take: 50 });
    return [...toImport, ...stuck.map((r) => r.id)];
  }

  /** Downloads one plugNmeet recording into the library. Throws on retryable failures. */
  async import(rowId: string, finalAttempt: boolean, source?: () => Promise<{ stream: Readable; size: number | null }>) {
    const row = await this.prisma.liveRecording.findUnique({ where: { id: rowId }, include: { session: { include: { liveClass: true } } } });
    if (!row || row.status === 'READY') return { skipped: true };
    await this.prisma.liveRecording.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, status: 'IMPORTING' } });
    const s = row.session;
    const day = (row.recordedAt ?? s.startsAt).toISOString().slice(0, 10);
    const title = `${s.liveClass.title} — ${day}`.slice(0, 200);
    try {
      const video = await this.ctx.run(row.tenantId, async () => {
        const dl = source ? await source() : await this.pnm.downloadRecording(row.providerRecordingId);
        // Uploads need the exact size. plugNmeet's listing reports an approximate float, so use the
        // download's Content-Length, or spool to a temporary file when the server does not send it.
        const { stream, size, cleanup } = dl.size ? { stream: dl.stream, size: dl.size, cleanup: async () => {} } : await spool(dl.stream);
        try {
          if (!size) throw new PlugNmeetError('The recording file is empty', false);
          await this.prisma.liveRecording.update({ where: { id: row.id }, data: { sizeBytes: BigInt(size) } });
          return await (this.videos.isConfigured() ? this.toBunny(row.tenantId, s.liveClass.hostUserId, title, stream, size) : this.toStorage(row.tenantId, s.id, row.providerRecordingId, s.liveClass.hostUserId, title, stream, size));
        } finally {
          await cleanup();
        }
      });
      await this.prisma.liveRecording.update({ where: { id: row.id }, data: { status: 'READY', videoAssetId: video.id, error: null } });
      const first = await this.prisma.liveSession.findUnique({ where: { id: s.id }, select: { videoAssetId: true } });
      await this.prisma.liveSession.update({ where: { id: s.id }, data: { recordingStatus: 'READY', ...(first?.videoAssetId ? {} : { videoAssetId: video.id }) } });
      return { imported: true, videoAssetId: video.id };
    } catch (e) {
      const retry = (e instanceof PlugNmeetError || e instanceof ZoomError ? e.retryable : true) && !finalAttempt;
      await this.prisma.liveRecording.update({ where: { id: row.id }, data: { status: retry ? 'IMPORTING' : 'FAILED', error: String((e as Error).message).slice(0, 500) } });
      if (retry) throw e;
      const pending = await this.prisma.liveRecording.count({ where: { sessionId: s.id, status: { in: ['IMPORTING', 'READY'] } } });
      if (!pending) await this.prisma.liveSession.update({ where: { id: s.id }, data: { recordingStatus: 'FAILED' } });
      this.log.error(`recording import ${row.id} failed: ${(e as Error).message}`);
      return { failed: (e as Error).message };
    }
  }

  /** Server-side upload to Bunny; Bunny then encodes it and the video sync marks it ready. */
  private async toBunny(tenantId: string, ownerId: string, title: string, body: NodeJS.ReadableStream, size: number) {
    const video = await this.prisma.videoAsset.create({
      data: { tenantId, title, provider: 'BUNNY', status: 'CREATED', protection: 'TOKEN', originalFilename: `${title.replace(/[^\p{L}\p{N}\p{M}\p{Pd} _.-]/gu, '').slice(0, 150)}.mp4`, mimeType: 'video/mp4', originalSize: BigInt(size), createdById: ownerId },
    });
    await this.repo.recordCreated(tenantId, video.id, 'WORKER');
    const group = await this.prisma.tenantSetting.findFirst({ where: { tenantId, key: TENANT_GROUP_KEY } });
    let groupId = (group?.value as { id?: string } | null)?.id ?? null;
    if (!groupId) {
      groupId = await this.videos.createGroup(`Academy-${tenantId}`);
      await this.prisma.tenantSetting.upsert({ where: { tenantId_key: { tenantId, key: TENANT_GROUP_KEY } }, create: { tenantId, key: TENANT_GROUP_KEY, value: { id: groupId } }, update: { value: { id: groupId } } });
    }
    const { providerVideoId } = await this.videos.createVideo({ title, groupId });
    await this.prisma.videoAsset.update({ where: { id: video.id }, data: { providerAssetId: providerVideoId } });
    // An upload session marks the server-side transfer as in progress for the video maintenance job.
    const up = await this.prisma.videoUploadSession.create({ data: { tenantId, videoAssetId: video.id, uploadStatus: 'UPLOADING', authorizationExpiresAt: new Date(Date.now() + 12 * 3600_000), uploadStartedAt: new Date(), createdById: ownerId } });
    await this.repo.transition(video.id, 'UPLOAD_AUTHORIZED', 'WORKER', 'Importing a live class recording');
    await this.repo.transition(video.id, 'UPLOADING', 'WORKER', 'Uploading the recording to the video host');
    try {
      await this.videos.uploadFile(providerVideoId, body as never, size);
    } catch (e) {
      await this.prisma.videoUploadSession.update({ where: { id: up.id }, data: { uploadStatus: 'FAILED', errorMessage: String((e as Error).message).slice(0, 500) } });
      await this.repo.transition(video.id, 'FAILED', 'WORKER', 'Recording upload failed', { errorMessage: 'The recording could not be uploaded' }).catch(() => null);
      await this.videos.deleteVideo(providerVideoId).catch(() => null);
      throw e;
    }
    await this.prisma.videoUploadSession.update({ where: { id: up.id }, data: { uploadStatus: 'COMPLETED', uploadCompletedAt: new Date() } });
    await this.repo.transition(video.id, 'UPLOADED', 'WORKER', 'Recording uploaded');
    return video;
  }

  private async toStorage(tenantId: string, sessionId: string, recordId: string, ownerId: string, title: string, body: NodeJS.ReadableStream, size: number) {
    const key = `tenants/${tenantId}/live_recording/${sessionId}/${recordId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)}.mp4`;
    await this.storage.putStream(key, body as never, size, 'video/mp4');
    const file = await this.prisma.fileAsset.create({
      data: { tenantId, ownerUserId: ownerId, purpose: 'VIDEO_SOURCE', fileName: `${title.slice(0, 150)}.mp4`, mimeType: 'video/mp4', sizeBytes: BigInt(size), driver: this.storage.driver, bucket: this.storage.bucketFor(false), key, status: 'READY' } as never,
    });
    return this.prisma.videoAsset.create({ data: { tenantId, title, sourceFileId: file.id, provider: 'STORAGE', status: 'READY', mimeType: 'video/mp4', originalSize: BigInt(size), createdById: ownerId } as never });
  }
}
