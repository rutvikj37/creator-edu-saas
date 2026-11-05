import type { NestExpressApplication } from '@nestjs/platform-express';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { QUEUES } from '../src/core/queue/queue.constants.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { TenantContext } from '../src/core/tenancy/tenant-context.service.js';
import { PasswordService } from '../src/modules/auth/services/password.service.js';
import { VideoProcessingService } from '../src/modules/videos/services/video-processing.service.js';
import { api, authed, createTestApp, login, parseSession, PLATFORM, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';
import { bunnySim, type BunnySim } from './bunny-sim.js';

const SECRET = process.env.BUNNY_STREAM_WEBHOOK_SECRET!;
const LIB = Number(process.env.BUNNY_STREAM_LIBRARY_ID);
const file = { filename: 'Lesson 1 — intro.mp4', size: 52_428_800, mimeType: 'video/mp4' };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('Bunny Stream videos: upload, processing, playback (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let sim: BunnySim;
  let A: Awaited<ReturnType<typeof registerCreator>>;
  let B: Awaited<ReturnType<typeof registerCreator>>;
  let course: { id: string };
  let lesson: { id: string };
  let videoId: string;
  let guid: string;

  const webhook = (body: unknown, secret = SECRET) => api(app).post(`/api/v1/videos/webhooks/bunny?secret=${encodeURIComponent(secret)}`).set('Content-Type', 'application/json').send(JSON.stringify(body));
  async function academy() {
    const c = await registerCreator(app);
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    return c;
  }
  async function student(c: { tenant: { slug: string } }, name = 'Sam Student') {
    const host = tenantHost(c.tenant.slug);
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: name, email: uniqueEmail('vs'), password: 'student-password-1' }).expect(201);
    return parseSession(reg, host);
  }
  async function staff(tenantId: string, roleKey: string) {
    const role = await prisma.role.findUniqueOrThrow({ where: { uniqueKey: `system:${roleKey}` } });
    const email = uniqueEmail(roleKey.toLowerCase());
    const user = await prisma.user.create({ data: { realm: 'PLATFORM', realmKey: 'platform', email, fullName: `${roleKey} user`, passwordHash: await app.get(PasswordService).hash('staff-password-1') } });
    await prisma.tenantMember.create({ data: { tenantId, userId: user.id, roleId: role.id } });
    return (await login(app, PLATFORM, email, 'staff-password-1')).session;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    await app.get<Queue>(getQueueToken(QUEUES.BACKUPS)).obliterate({ force: true });
    sim = bunnySim(app);
    A = await academy();
    B = await academy();
    course = (await authed(app, A.session).post('/api/v1/creator/courses').send({ title: 'Bunny course' }).expect(201)).body.data;
    const sec = (await authed(app, A.session).get(`/api/v1/creator/courses/${course.id}/curriculum`)).body.data[0].id;
    lesson = (await authed(app, A.session).post(`/api/v1/creator/courses/${course.id}/lessons`).send({ sectionId: sec, title: 'Intro video', type: 'VIDEO' }).expect(201)).body.data;
  });
  afterAll(async () => app?.close());

  it('1. creator upload: initiate → direct upload credentials → provider confirms → UPLOADED, backup queued', async () => {
    const res = (await authed(app, A.session).post('/api/v1/videos/upload/initiate').send({ title: 'Intro', ...file, courseId: course.id, lessonId: lesson.id }).expect(201)).body.data;
    videoId = res.videoId;
    const v = await prisma.videoAsset.findUniqueOrThrow({ where: { id: videoId } });
    guid = v.providerAssetId!;
    expect(v).toMatchObject({ tenantId: A.tenant.id, provider: 'BUNNY', status: 'UPLOAD_AUTHORIZED', protection: 'TOKEN', courseId: course.id, lessonId: lesson.id, originalFilename: 'Lesson 1 — intro.mp4', mimeType: 'video/mp4' });
    expect(Number(v.originalSize)).toBe(file.size);
    // Direct-upload credentials: signed, time-limited, bound to this video; never the API key.
    expect(res.upload).toMatchObject({ protocol: 'tus', headers: { VideoId: guid, LibraryId: String(LIB) }, metadata: { filetype: 'video/mp4', title: 'Intro' } });
    const exp = Number(res.upload.headers.AuthorizationExpire);
    expect(exp * 1000).toBeGreaterThan(Date.now() + 11 * 3600_000);
    expect(res.upload.headers.AuthorizationSignature).toBe(sha(`${LIB}${process.env.BUNNY_STREAM_API_KEY}${exp}${guid}`));
    expect(JSON.stringify(res)).not.toContain(process.env.BUNNY_STREAM_API_KEY);
    // Provider entry lives in the academy's own collection.
    expect(sim.collections.get(sim.videos.get(guid).collectionId)).toBe(`Academy-${A.tenant.id}`);

    await authed(app, A.session).post('/api/v1/videos/upload/complete').send({ videoId, uploadSessionId: res.uploadSessionId, outcome: 'started' }).expect(200);
    expect((await prisma.videoAsset.findUniqueOrThrow({ where: { id: videoId } })).status).toBe('UPLOADING');
    // The browser claims success before Bunny has the file: status must not advance.
    const early = (await authed(app, A.session).post('/api/v1/videos/upload/complete').send({ videoId, uploadSessionId: res.uploadSessionId, outcome: 'success' }).expect(200)).body.data;
    expect(early.status).toBe('UPLOADING');
    sim.uploaded(guid, Buffer.from('original video bytes '.repeat(1000)));
    const st = (await authed(app, A.session).get(`/api/v1/videos/${videoId}/processing-status`).expect(200)).body.data;
    expect(st.status).toBe('UPLOADED');
    const jobs = await app.get<Queue>(getQueueToken(QUEUES.BACKUPS)).getJobs(['waiting', 'delayed', 'active', 'completed']);
    expect(jobs.map((j) => [j.name, j.data.videoId])).toContainEqual(['backup-video', videoId]);
    const history = (await prisma.videoStatusHistory.findMany({ where: { videoAssetId: videoId }, orderBy: { createdAt: 'asc' } })).map((h) => h.toStatus);
    expect(history).toEqual(['CREATED', 'UPLOAD_AUTHORIZED', 'UPLOADING', 'UPLOADED']);
  });

  it('2–3. unauthorized and cross-tenant uploads are rejected; file validation', async () => {
    const s = await student(A);
    await authed(app, s).post('/api/v1/videos/upload/initiate').send({ title: 'x', ...file }).expect((r) => expect([401, 403, 404]).toContain(r.status));
    const sales = await staff(A.tenant.id, 'SALES_MANAGER');
    await authed(app, sales).post('/api/v1/videos/upload/initiate').send({ title: 'x', ...file }).expect(403);
    const instructor = await staff(A.tenant.id, 'INSTRUCTOR');
    expect((await authed(app, instructor).post('/api/v1/videos/upload/initiate').send({ title: 'x', ...file, courseId: course.id }).expect(403)).body.error.message).toMatch(/courses you teach/);
    // Validation.
    expect((await authed(app, A.session).post('/api/v1/videos/upload/initiate').send({ title: 'x', ...file, mimeType: 'application/pdf', filename: 'a.pdf' }).expect(422)).body.error.details[0].field).toBe('mimeType');
    await authed(app, A.session).post('/api/v1/videos/upload/initiate').send({ title: 'x', ...file, filename: 'a.mov' }).expect(422);
    await authed(app, A.session).post('/api/v1/videos/upload/initiate').send({ title: 'x', ...file, size: 30 * 1024 ** 3 }).expect(422);
    // Filenames are sanitised (no paths/control characters).
    const odd = (await authed(app, A.session).post('/api/v1/videos/upload/initiate').send({ title: 'Odd', ...file, filename: '../../etc/pa<ss>wd\u0007.mp4' }).expect(201)).body.data;
    expect((await prisma.videoAsset.findUniqueOrThrow({ where: { id: odd.videoId } })).originalFilename).toBe('pa_ss_wd.mp4');
    // Cross-tenant: B cannot target A's course, see A's video or complete A's upload.
    await authed(app, B.session).post('/api/v1/videos/upload/initiate').send({ title: 'x', ...file, courseId: course.id }).expect(404);
    await authed(app, B.session).get(`/api/v1/videos/${videoId}`).expect(404);
    await authed(app, B.session).get(`/api/v1/videos/${videoId}/processing-status`).expect(404);
    await authed(app, B.session).patch(`/api/v1/videos/${videoId}`).send({ title: 'hijack' }).expect(404);
    await authed(app, B.session).delete(`/api/v1/videos/${videoId}`).expect(404);
    await authed(app, B.session).post('/api/v1/videos/upload/complete').send({ videoId, uploadSessionId: 'ckxxxxxxxxxxxxxxxxxxxxxxx', outcome: 'success' }).expect(404);
    await authed(app, B.session).post('/api/v1/videos/upload/initiate').send({ title: 'x', ...file, videoId }).expect(404);
    expect((await authed(app, B.session).get('/api/v1/videos').expect(200)).body.data).toEqual([]);
  });

  it('4. upload retry: failed upload gets fresh credentials; failed provider entry is replaced', async () => {
    const first = (await authed(app, A.session).post('/api/v1/videos/upload/initiate').send({ title: 'Retry me', ...file }).expect(201)).body.data;
    await authed(app, A.session).post('/api/v1/videos/upload/complete').send({ videoId: first.videoId, uploadSessionId: first.uploadSessionId, outcome: 'failed', error: 'network lost' }).expect(200);
    expect(await prisma.videoAsset.findUniqueOrThrow({ where: { id: first.videoId } })).toMatchObject({ status: 'FAILED', errorMessage: 'Upload failed: network lost' });
    const oldGuid = first.upload.headers.VideoId;
    const second = (await authed(app, A.session).post('/api/v1/videos/upload/initiate').send({ title: 'Retry me', ...file, videoId: first.videoId }).expect(201)).body.data;
    expect(second.videoId).toBe(first.videoId);
    expect(second.upload.headers.VideoId).toBe(oldGuid); // empty provider entry reused
    expect(await prisma.videoUploadSession.findMany({ where: { videoAssetId: first.videoId }, orderBy: { attempt: 'asc' }, select: { attempt: true, uploadStatus: true } })).toEqual([{ attempt: 1, uploadStatus: 'FAILED' }, { attempt: 2, uploadStatus: 'AUTHORIZED' }]);
    expect((await prisma.videoAsset.findUniqueOrThrow({ where: { id: first.videoId } })).status).toBe('UPLOAD_AUTHORIZED');
    // Provider reports the upload failed (status 6): next retry starts a clean provider entry.
    sim.setStatus(oldGuid, 6);
    const third = (await authed(app, A.session).post('/api/v1/videos/upload/initiate').send({ title: 'Retry me', ...file, videoId: first.videoId }).expect(201)).body.data;
    expect(third.upload.headers.VideoId).not.toBe(oldGuid);
    expect(sim.videos.has(oldGuid)).toBe(false);
    // Already-uploaded videos cannot be "retried".
    await authed(app, A.session).post('/api/v1/videos/upload/initiate').send({ title: 'x', ...file, videoId }).expect(409);
  });

  it('5–6. webhooks: secret required, status read from the provider API, duplicates ignored', async () => {
    const body = { VideoLibraryId: LIB, VideoGuid: guid, Status: 3 };
    await webhook(body, 'wrong-secret').expect(401);
    await api(app).post('/api/v1/videos/webhooks/bunny').send(body).expect(401);
    // A forged "finished" event while Bunny is still transcoding: status follows the API, not the body.
    sim.setStatus(guid, 3);
    expect((await webhook({ ...body, Status: 4 }).expect(200)).body.data).toMatchObject({ status: 'PROCESSING' });
    sim.finish(guid);
    const done = { ...body, Status: 3, extra: 'finished' };
    expect((await webhook(done).expect(200)).body.data).toMatchObject({ status: 'READY' });
    expect((await webhook(done).expect(200)).body.data).toMatchObject({ duplicate: true });
    expect(await prisma.videoProcessingEvent.count({ where: { videoAssetId: videoId } })).toBe(2);
    const v = (await authed(app, A.session).get(`/api/v1/videos/${videoId}`).expect(200)).body.data;
    expect(v).toMatchObject({ status: 'READY', providerVideoId: guid, durationSeconds: 125, width: 1920, height: 1080, availableResolutions: ['360p', '720p', '1080p'], storageSize: 48_000_000, thumbnailUrl: `https://vz-test.b-cdn.net/${guid}/thumbnail.jpg`, course: { id: course.id } });
    expect(v.history.map((h: any) => `${h.toStatus}:${h.source}`).slice(-2)).toEqual(['PROCESSING:WEBHOOK', 'READY:WEBHOOK']);
    // Other library / unknown video are acknowledged and ignored.
    expect((await webhook({ VideoLibraryId: 1, VideoGuid: guid, Status: 5 }).expect(200)).body.data.ignored).toBe('other library');
    expect((await webhook({ VideoLibraryId: LIB, VideoGuid: '00000000-0000-0000-0000-000000000000', Status: 4 }).expect(200)).body.data.ignored).toBe('unknown video');
    await webhook({ VideoLibraryId: LIB }).expect(422);
    // Provider unreachable during a webhook: acknowledged and retried from the queue.
    sim.fail(/GET \/library\/\d+\/videos\/[^/]+$/, 503, 4);
    expect((await webhook({ ...body, Status: 4, n: 3 }).expect(200)).body.data).toMatchObject({ deferred: true });
    const sync = await app.get<Queue>(getQueueToken(QUEUES.VIDEO)).getJobs(['waiting', 'delayed']);
    expect(sync.some((j) => j.name === 'video-sync' && j.data.videoId === videoId)).toBe(true);
  });

  it('7. failed processing → FAILED; retry-processing re-encodes and later webhooks are processed again', async () => {
    const up = (await authed(app, A.session).post('/api/v1/videos/upload/initiate').send({ title: 'Broken', ...file }).expect(201)).body.data;
    const g = up.upload.headers.VideoId;
    sim.uploaded(g, Buffer.from('bytes'));
    sim.setStatus(g, 5);
    const body = { VideoLibraryId: LIB, VideoGuid: g, Status: 5 };
    expect((await webhook(body).expect(200)).body.data.status).toBe('FAILED');
    expect((await prisma.videoAsset.findUniqueOrThrow({ where: { id: up.videoId } })).errorMessage).toMatch(/could not process/);
    await authed(app, A.session).post(`/api/v1/courses-nope`).expect(404);
    // Cannot attach a failed video to a lesson.
    await authed(app, A.session).patch(`/api/v1/videos/${up.videoId}`).send({ lessonId: lesson.id }).expect(422);
    const r = (await authed(app, A.session).post(`/api/v1/videos/${up.videoId}/retry-processing`).expect(200)).body.data;
    expect(r.status).toBe('PROCESSING');
    expect(sim.calls).toContain(`POST /library/${LIB}/videos/${g}/reencode`);
    expect((await prisma.videoAsset.findUniqueOrThrow({ where: { id: up.videoId } })).processingRound).toBe(1);
    sim.finish(g);
    // Same webhook body as before, new processing round: not treated as a duplicate.
    expect((await webhook({ ...body, Status: 3 }).expect(200)).body.data.status).toBe('READY');
    await authed(app, A.session).post(`/api/v1/videos/${up.videoId}/retry-processing`).expect(409);
  });

  it('timeout detection, abandoned-upload cleanup, provider errors', async () => {
    const svc = app.get(VideoProcessingService);
    const up = (await authed(app, A.session).post('/api/v1/videos/upload/initiate').send({ title: 'Slow', ...file }).expect(201)).body.data;
    sim.uploaded(up.upload.headers.VideoId, Buffer.from('x'));
    sim.setStatus(up.upload.headers.VideoId, 3);
    await app.get(TenantContext).run(A.tenant.id, () => svc.sync(up.videoId, 'SYNC'));
    await prisma.videoAsset.update({ where: { id: up.videoId }, data: { processingStartedAt: new Date(Date.now() - 4 * 3600_000), lastSyncedAt: new Date(0) } });
    const r = await svc.maintain();
    expect(r.timedOut).toBeGreaterThanOrEqual(1);
    expect(await prisma.videoAsset.findUniqueOrThrow({ where: { id: up.videoId } })).toMatchObject({ status: 'FAILED', errorMessage: expect.stringMatching(/too long/) });
    // Upload authorisation that expired with no file: failed and cleaned.
    const ghost = (await authed(app, A.session).post('/api/v1/videos/upload/initiate').send({ title: 'Ghost', ...file }).expect(201)).body.data;
    await prisma.videoUploadSession.updateMany({ where: { videoAssetId: ghost.videoId }, data: { authorizationExpiresAt: new Date(Date.now() - 1000) } });
    await svc.maintain();
    expect((await prisma.videoAsset.findUniqueOrThrow({ where: { id: ghost.videoId } })).status).toBe('FAILED');
    // Provider rejects credentials → clear 503, no leak of provider details.
    sim.fail(/POST \/library\/\d+\/videos$/, 401);
    const bad = await authed(app, A.session).post('/api/v1/videos/upload/initiate').send({ title: 'x', ...file }).expect(503);
    expect(bad.body.error.message).toMatch(/rejected the platform credentials/);
    // Rate limited once, then fine: the client retries reads.
    sim.fail(/GET \/library\/\d+\/videos\/[^/]+$/, 429, 1);
    await app.get(TenantContext).run(A.tenant.id, () => svc.sync(videoId, 'SYNC'));
  });

  let student1: Session;
  it('8–10. playback: entitled student gets a short-lived token URL; others are refused; expiry and revocation', async () => {
    // A READY video can be assigned to its lesson and the lesson published.
    await authed(app, A.session).patch(`/api/v1/creator/courses/${course.id}/lessons/${lesson.id}`).send({ videoAssetId: videoId, isPublished: true }).expect(200);
    await authed(app, A.session).patch(`/api/v1/creator/courses/${course.id}`).send({ isFree: true }).expect(200);
    await authed(app, A.session).post(`/api/v1/creator/courses/${course.id}/publish`).send({}).expect(200);
    student1 = await student(A, 'Priya Viewer');
    // Not enrolled → refused.
    await authed(app, student1).post(`/api/v1/videos/${videoId}/playback-authorize`).send({ lessonId: lesson.id }).expect(403);
    await authed(app, student1).post(`/api/v1/learn/courses/${course.id}/enroll`).expect(201);
    const play = (await authed(app, student1).post(`/api/v1/videos/${videoId}/playback-authorize`).send({ lessonId: lesson.id }).expect(200)).body.data;
    const url = new URL(play.player.url);
    const expires = Number(url.searchParams.get('expires'));
    expect(url.origin + url.pathname).toBe(`https://iframe.mediadelivery.net/embed/${LIB}/${guid}`);
    expect(url.searchParams.get('token')).toBe(sha(`${process.env.BUNNY_STREAM_TOKEN_AUTH_KEY}${guid}${expires}`));
    expect(expires * 1000).toBeGreaterThan(Date.now());
    expect(expires * 1000).toBeLessThanOrEqual(Date.now() + 6 * 3600_000 + 5000);
    expect(play).toMatchObject({ protection: 'token', drm: false, durationSeconds: 125, resumeAt: 0 });
    expect(play.player.url).not.toContain(process.env.BUNNY_STREAM_API_KEY);
    const session = await prisma.videoPlaybackSession.findUniqueOrThrow({ where: { id: play.sessionId } });
    expect(session.sessionTokenHash).toBe(sha(url.searchParams.get('token')!));
    expect(session.expiresAt.getTime()).toBe(expires * 1000);
    // The lesson player route returns the same kind of authorisation.
    const viaLesson = (await authed(app, student1).post(`/api/v1/learn/lessons/${lesson.id}/video`).expect(200)).body.data;
    expect(viaLesson).toMatchObject({ kind: 'iframe', protection: 'token' });
    // Progress & completion through heartbeats.
    await authed(app, student1).put(`/api/v1/learn/video-sessions/${play.sessionId}/heartbeat`).send({ positionSeconds: 60 }).expect(200);
    expect((await authed(app, student1).put(`/api/v1/learn/video-sessions/${play.sessionId}/heartbeat`).send({ positionSeconds: 120 }).expect(200)).body.data.completed).toBe(true);

    // Wrong video for the lesson, other academy's student, unknown lesson → refused.
    await authed(app, student1).post(`/api/v1/videos/ckxxxxxxxxxxxxxxxxxxxxxxx/playback-authorize`).send({ lessonId: lesson.id }).expect(404);
    const outsider = await student(B, 'Other Academy');
    await authed(app, outsider).post(`/api/v1/videos/${videoId}/playback-authorize`).send({ lessonId: lesson.id }).expect(404);
    await authed(app, A.session).post(`/api/v1/videos/${videoId}/playback-authorize`).send({ lessonId: lesson.id }).expect((r) => expect([401, 403, 404]).toContain(r.status));

    // Expired session → refused; device limit; revocation when access ends.
    await prisma.videoPlaybackSession.update({ where: { id: play.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await authed(app, student1).put(`/api/v1/learn/video-sessions/${play.sessionId}/heartbeat`).send({ positionSeconds: 5 }).expect(403)).body.error.message).toMatch(/expired/);
    // Active now: the lesson-route session + 2 new ones = 3 (the limit); a 4th device is refused.
    await authed(app, student1).post(`/api/v1/videos/${videoId}/playback-authorize`).send({ lessonId: lesson.id }).expect(200);
    await authed(app, student1).post(`/api/v1/videos/${videoId}/playback-authorize`).send({ lessonId: lesson.id }).expect(200);
    await authed(app, student1).post(`/api/v1/videos/${videoId}/playback-authorize`).send({ lessonId: lesson.id }).expect(429);
    const last = await prisma.videoPlaybackSession.findFirstOrThrow({ where: { userId: (await prisma.user.findFirstOrThrow({ where: { fullName: 'Priya Viewer' } })).id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    await prisma.enrollment.updateMany({ where: { courseId: course.id }, data: { status: 'REVOKED' } });
    await authed(app, student1).put(`/api/v1/learn/video-sessions/${last.id}/heartbeat`).send({ positionSeconds: 5 }).expect(403);
    expect((await prisma.videoPlaybackSession.findUniqueOrThrow({ where: { id: last.id } })).revokeReason).toBe('access_ended');
  });

  it('deletion: blocked while used or backing up; provider entry removed; DELETING retried when unreachable', async () => {
    await authed(app, A.session).delete(`/api/v1/videos/${videoId}`).expect(409); // used in a lesson
    const up = (await authed(app, A.session).post('/api/v1/videos/upload/initiate').send({ title: 'Temp', ...file }).expect(201)).body.data;
    const g = up.upload.headers.VideoId;
    await prisma.videoBackup.create({ data: { tenantId: A.tenant.id, videoAssetId: up.videoId, provider: 'GOOGLE_DRIVE', status: 'IN_PROGRESS', backupFilename: 'x.enc' } });
    expect((await authed(app, A.session).delete(`/api/v1/videos/${up.videoId}`).expect(409)).body.error.message).toMatch(/backed up/);
    await prisma.videoBackup.updateMany({ where: { videoAssetId: up.videoId }, data: { status: 'COMPLETED' } });
    sim.fail(/DELETE /, 503, 4);
    await authed(app, A.session).delete(`/api/v1/videos/${up.videoId}`).expect(200);
    expect((await prisma.videoAsset.findUniqueOrThrow({ where: { id: up.videoId } })).status).toBe('DELETING');
    expect(sim.videos.has(g)).toBe(true);
    await app.get(VideoProcessingService).maintain();
    expect((await prisma.videoAsset.findUniqueOrThrow({ where: { id: up.videoId } })).status).toBe('DELETED');
    expect(sim.videos.has(g)).toBe(false);
    expect((await authed(app, A.session).get('/api/v1/videos').expect(200)).body.data.map((v: any) => v.id)).not.toContain(up.videoId);
  });
});
