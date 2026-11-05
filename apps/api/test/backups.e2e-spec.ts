import type { NestExpressApplication } from '@nestjs/platform-express';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { QUEUES } from '../src/core/queue/queue.constants.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { BackupsService } from '../src/modules/backups/backups.service.js';
import { BackupRestoreService } from '../src/modules/backups/services/backup-restore.service.js';
import { GoogleDriveBackupProvider } from '../src/modules/backups/providers/google-drive/google-drive.service.js';
import { api, authed, createTestApp, registerCreator, resetDatabase, type Session, superAdmin, tenantHost } from './helpers.js';
import { bunnySim, type BunnySim } from './bunny-sim.js';
import { DriveSim } from './drive-sim.js';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const ORIGINAL = Buffer.concat([Buffer.from('ftypisom'), Buffer.alloc(300_000, 3), Buffer.from('end')]);

describe('Google Drive backups (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let sim: BunnySim;
  let drive: DriveSim;
  let admin: Session;
  let A: Awaited<ReturnType<typeof registerCreator>>;
  let course: { id: string };
  let backups: BackupsService;

  async function bunnyVideo(title: string, bytes = ORIGINAL, courseId: string | null = course.id) {
    const r = (await authed(app, A.session).post('/api/v1/videos/upload/initiate').send({ title, filename: `${title}.mp4`, size: bytes.length, mimeType: 'video/mp4', courseId }).expect(201)).body.data;
    sim.uploaded(r.upload.headers.VideoId, bytes);
    sim.finish(r.upload.headers.VideoId);
    await authed(app, A.session).post('/api/v1/videos/upload/complete').send({ videoId: r.videoId, uploadSessionId: r.uploadSessionId, outcome: 'success' }).expect(200);
    return { videoId: r.videoId as string, guid: r.upload.headers.VideoId as string };
  }

  beforeAll(async () => {
    drive = await new DriveSim().start();
    process.env.GOOGLE_API_ROOT_URL = drive.url;
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    await app.get<Queue>(getQueueToken(QUEUES.BACKUPS)).obliterate({ force: true });
    sim = bunnySim(app);
    backups = app.get(BackupsService);
    admin = (await superAdmin(app)).session;
    A = await registerCreator(app);
    await prisma.tenant.update({ where: { id: A.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(A.tenant.slug));
    course = (await authed(app, A.session).post('/api/v1/creator/courses').send({ title: 'Backed up course' }).expect(201)).body.data;
  });
  afterAll(async () => { await app?.close(); await drive?.stop(); });

  it('only platform admins reach backup endpoints; without a Drive connection backups wait', async () => {
    await authed(app, A.session).get('/api/v1/backups').expect((r) => expect([401, 403, 404]).toContain(r.status));
    await api(app).get('/api/v1/backups/drive/quota').expect(401);
    expect((await authed(app, admin).get('/api/v1/backups/drive/quota').expect(200)).body.data).toMatchObject({ configured: true, connected: false, quota: null });
    const { videoId } = await bunnyVideo('Before connect');
    const queued = await app.get<Queue>(getQueueToken(QUEUES.BACKUPS)).getJobs(['waiting', 'delayed']);
    expect(queued.find((j) => j.data.videoId === videoId)?.opts.attempts).toBe(5);
    expect((await backups.backupVideo(A.tenant.id, videoId, { attempt: 1, finalAttempt: false })).skipped).toBe('drive not connected');
    expect(await prisma.videoBackup.findFirstOrThrow({ where: { videoAssetId: videoId } })).toMatchObject({ status: 'PENDING', errorMessage: 'Waiting for Google Drive to be connected' });
  });

  it('OAuth connect: offline consent with drive.file scope, one-time state, refresh token stored encrypted', async () => {
    const { url } = (await authed(app, admin).post('/api/v1/backups/drive/oauth/start').expect(200)).body.data;
    const u = new URL(url);
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('redirect_uri')).toBe(process.env.GOOGLE_DRIVE_REDIRECT_URI);
    const state = u.searchParams.get('state')!;
    // Forged state is refused.
    const bad = await api(app).get(`/api/v1/backups/drive/oauth/callback?code=${drive.issueCode()}&state=forged`).expect(302);
    expect(bad.headers.location).toMatch(/drive=error/);
    const ok = await api(app).get(`/api/v1/backups/drive/oauth/callback?code=${drive.issueCode()}&state=${state}`).expect(302);
    expect(ok.headers.location).toBe('http://app.lvh.me:5173/super-admin/backups?drive=connected');
    // The same state cannot be replayed.
    expect((await api(app).get(`/api/v1/backups/drive/oauth/callback?code=${drive.issueCode()}&state=${state}`).expect(302)).headers.location).toMatch(/drive=error/);
    const stored = await prisma.platformSetting.findUniqueOrThrow({ where: { key: 'backups.googleDrive' } });
    const token = [...drive.refreshTokens][0];
    expect(JSON.stringify(stored.value)).not.toContain(token);
    expect(stored.isSecret).toBe(true);
    expect((await authed(app, admin).get('/api/v1/backups/drive/status').expect(200)).body.data).toMatchObject({ connected: true, email: 'owner@gmail.test' });
  });

  let backupId: string;
  let video: { videoId: string; guid: string };
  it('11. backup: original streamed from Bunny, encrypted, uploaded to the academy/course folder, verified', async () => {
    video = await bunnyVideo('Lecture 1');
    const r = await backups.backupVideo(A.tenant.id, video.videoId, { attempt: 1, finalAttempt: false });
    expect(r).toMatchObject({ completed: true, bytes: ORIGINAL.length });
    const b = await prisma.videoBackup.findFirstOrThrow({ where: { videoAssetId: video.videoId } });
    backupId = b.id;
    expect(b).toMatchObject({ status: 'COMPLETED', provider: 'GOOGLE_DRIVE', checksum: sha(ORIGINAL), errorMessage: null });
    expect(Number(b.originalSize)).toBe(ORIGINAL.length);
    const f = drive.files.get(b.driveFileId!)!;
    expect(drive.pathOf(f.id)).toEqual(['TechX-LMS-Backups', `Academy-${A.tenant.id}`, 'Courses', `Course-${course.id}`, 'Videos', `${video.videoId}.mp4.enc`]);
    // Encrypted: TXB1 header, never the plaintext, MD5 of the stored bytes recorded.
    expect(f.data!.subarray(0, 4).toString()).toBe('TXB1');
    expect(f.data!.includes(Buffer.from('ftypisom'))).toBe(false);
    expect(b.encryptedMd5).toBe(createHash('md5').update(f.data!).digest('hex'));
    expect(Number(b.backupSize)).toBe(f.data!.length);
    // Metadata file with the wrapped key only.
    const meta = JSON.parse(drive.files.get(b.metadataFileId!)!.data!.toString());
    expect(drive.pathOf(b.metadataFileId!).slice(-2)).toEqual(['Metadata', `${video.videoId}.json`]);
    expect(meta).toMatchObject({ videoId: video.videoId, originalSha256: sha(ORIGINAL), providerVideoId: video.guid, encryption: { alg: 'aes-256-gcm', format: 'TXB1' } });
    expect(JSON.stringify(meta)).not.toContain(process.env.BACKUP_ENCRYPTION_KEY);
    expect(drive.findByPath(['TechX-LMS-Backups', `Academy-${A.tenant.id}`, 'Database'])).toBeTruthy();
    // Admin views; video library shows the backup state; students never get Drive URLs.
    const list = (await authed(app, admin).get('/api/v1/backups?status=COMPLETED').expect(200)).body;
    expect(list.data[0]).toMatchObject({ id: backupId, status: 'COMPLETED', video: { title: 'Lecture 1' }, tenant: { id: A.tenant.id } });
    expect((await authed(app, A.session).get(`/api/v1/videos/${video.videoId}`).expect(200)).body.data.backup).toMatchObject({ status: 'COMPLETED' });
    expect(JSON.stringify((await authed(app, A.session).get(`/api/v1/videos/${video.videoId}`)).body)).not.toContain(b.driveFileId!);
  });

  it('12. failures: retryable errors → RETRYING then FAILED; admin retry succeeds; mismatched hash is never kept', async () => {
    const v = await bunnyVideo('Flaky');
    drive.fail(/POST \/upload\/drive\/v3\/files/, 503, 'backendError', 20);
    await expect(backups.backupVideo(A.tenant.id, v.videoId, { attempt: 1, finalAttempt: false })).rejects.toThrow(/busy/);
    const rec = await prisma.videoBackup.findFirstOrThrow({ where: { videoAssetId: v.videoId } });
    expect(rec.status).toBe('RETRYING');
    expect((await backups.backupVideo(A.tenant.id, v.videoId, { attempt: 5, finalAttempt: true })).failed).toMatch(/busy/);
    expect((await prisma.videoBackup.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe('FAILED');
    drive.failures = [];
    const retried = (await authed(app, admin).post(`/api/v1/backups/${rec.id}/retry`).expect(200)).body.data;
    expect(retried.status).toBe('PENDING');
    const jobs = await app.get<Queue>(getQueueToken(QUEUES.BACKUPS)).getJobs(['waiting', 'delayed']);
    expect(jobs.some((j) => j.name === 'backup-video' && j.data.videoId === v.videoId)).toBe(true);
    expect((await backups.backupVideo(A.tenant.id, v.videoId, { attempt: 1, finalAttempt: false })).completed).toBe(true);
    await authed(app, admin).post(`/api/v1/backups/${rec.id}/retry`).expect(409);
    // Provider's original hash disagrees with the bytes received: verification fails, nothing kept.
    const w = await bunnyVideo('Corrupt in transit');
    await prisma.videoAsset.update({ where: { id: w.videoId }, data: { originalHash: 'a'.repeat(64) } });
    const before = drive.files.size;
    expect((await backups.backupVideo(A.tenant.id, w.videoId, { attempt: 5, finalAttempt: true })).failed).toMatch(/SHA-256 differs/);
    expect(drive.files.size).toBe(before + 0);
  });

  it('13. Drive quota monitoring: usage, free space, low-space flag, refusal when full', async () => {
    const q = (await authed(app, admin).get('/api/v1/backups/drive/quota').expect(200)).body.data;
    expect(q.quota).toMatchObject({ limit: drive.limit, lowSpace: false, lowSpaceThresholdPercent: 10 });
    expect(q.quota.usage).toBe(drive.usage());
    expect(q.quota.free).toBe(drive.limit! - drive.usage());
    drive.limit = drive.usage() + 200_000; // nearly full
    await app.get(GoogleDriveBackupProvider).reset();
    const low = (await backups.quota(true)) as any;
    expect(low.quota.lowSpace).toBe(true);
    const v = await bunnyVideo('Too big for Drive');
    expect((await backups.backupVideo(A.tenant.id, v.videoId, { attempt: 1, finalAttempt: false })).failed).toMatch(/Not enough free space/);
    drive.limit = 5 * 1024 ** 4;
  });

  it('14. restore: verified, re-uploaded to a new Bunny entry with the exact original; tampered backups are refused', async () => {
    const restoreSvc = app.get(BackupRestoreService);
    const r = (await authed(app, admin).post(`/api/v1/backups/${backupId}/restore`).expect(200)).body.data;
    expect(r.restoreStatus).toBe('IN_PROGRESS');
    const out = await restoreSvc.restore(backupId, null, true);
    expect(out).toMatchObject({ restored: true, bytes: ORIGINAL.length });
    const v = await prisma.videoAsset.findUniqueOrThrow({ where: { id: video.videoId } });
    expect(v.providerAssetId).toBe((out as any).providerVideoId);
    expect(v.providerAssetId).not.toBe(video.guid);
    expect(v.status).toBe('PROCESSING');
    expect(sim.originals.get(v.providerAssetId!)!.equals(ORIGINAL)).toBe(true);
    expect(sim.videos.has(video.guid)).toBe(false); // old entry removed
    expect((await prisma.videoBackup.findUniqueOrThrow({ where: { id: backupId } })).restoreStatus).toBe('COMPLETED');
    // Tampered copy: integrity check fails before anything is uploaded.
    drive.tamper((await prisma.videoBackup.findUniqueOrThrow({ where: { id: backupId } })).driveFileId!);
    await authed(app, admin).post(`/api/v1/backups/${backupId}/restore`).expect(200);
    const videosBefore = sim.videos.size;
    expect((await restoreSvc.restore(backupId, null, true)).failed).toMatch(/integrity/);
    expect(sim.videos.size).toBe(videosBefore);
    expect((await prisma.videoBackup.findUniqueOrThrow({ where: { id: backupId } })).restoreStatus).toBe('FAILED');
  });

  it('document backups and disconnect', async () => {
    const { uploadFile, PDF } = await import('./helpers.js');
    const up = await uploadFile(app, A.session, 'LESSON_FILE', 'notes.pdf', 'application/pdf', PDF);
    const sec = (await authed(app, A.session).get(`/api/v1/creator/courses/${course.id}/curriculum`)).body.data[0].id;
    const lesson = (await authed(app, A.session).post(`/api/v1/creator/courses/${course.id}/lessons`).send({ sectionId: sec, title: 'Notes', type: 'PDF' }).expect(201)).body.data;
    await authed(app, A.session).patch(`/api/v1/creator/courses/${course.id}/lessons/${lesson.id}`).send({ fileAssetId: up.body.data.id }).expect(200);
    expect((await authed(app, admin).post('/api/v1/backups/documents').send({ courseId: course.id }).expect(200)).body.data).toEqual({ queued: 1 });
    expect((await backups.backupDocument(A.tenant.id, up.body.data.id, { finalAttempt: true })).completed).toBe(true);
    const d = await prisma.documentBackup.findFirstOrThrow({ where: { fileAssetId: up.body.data.id } });
    expect(drive.pathOf(d.driveFileId!).slice(-3)).toEqual([`Course-${course.id}`, 'Documents', `${up.body.data.id}.pdf.enc`]);
    expect(d.checksum).toBe(sha(PDF));
    expect((await authed(app, admin).get('/api/v1/backups?kind=document').expect(200)).body.data[0]).toMatchObject({ kind: 'document', fileName: 'notes.pdf', status: 'COMPLETED' });
    const token = [...drive.refreshTokens][0];
    await authed(app, admin).post('/api/v1/backups/drive/disconnect').expect(200);
    expect(drive.revoked).toContain(token);
    expect((await authed(app, admin).get('/api/v1/backups/drive/status').expect(200)).body.data.connected).toBe(false);
  });
});
