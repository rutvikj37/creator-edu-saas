import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { api, authed, createTestApp, parseSession, registerCreator, resetDatabase, tenantHost, uniqueEmail, uploadFile } from './helpers.js';

// Minimal MP4-like payload: 'ftyp' box signature at bytes 4–8 followed by data.
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(4096, 7)]);

async function setup(app: NestExpressApplication) {
  const c = await registerCreator(app);
  const prisma = app.get(PrismaService);
  await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
  await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
  return c;
}

describe('Video (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(async () => app?.close());

  it('library → lesson → signed playback with seeking, progress, auto-complete, device limit and revocation', async () => {
    const c = await setup(app);
    const cs = c.session;
    // Non-video bytes declared as video are rejected by signature check.
    const fake = await uploadFile(app, cs, 'VIDEO_SOURCE', 'fake.mp4', 'video/mp4', Buffer.from('not a video at all, just text'));
    expect(fake.status).toBe(422);
    const up = await uploadFile(app, cs, 'VIDEO_SOURCE', 'intro.mp4', 'video/mp4', MP4);
    expect(up.status).toBe(200);
    await authed(app, cs).post('/api/v1/creator/videos').send({ fileId: up.body.data.id, title: 'Intro video', durationSeconds: 100 }).expect(201);
    await authed(app, cs).post('/api/v1/creator/videos').send({ fileId: up.body.data.id, title: 'Duplicate' }).expect(409);
    const lib = (await authed(app, cs).get('/api/v1/creator/videos').expect(200)).body.data;
    expect(lib).toHaveLength(1);
    expect(lib[0]).toMatchObject({ title: 'Intro video', status: 'READY', provider: 'STORAGE', protection: 'SIGNED', file: { fileName: 'intro.mp4' } });
    const videoId = lib[0].id;

    const course = (await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'Video course' }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${course.id}/curriculum`)).body.data[0].id;
    const lesson = (await authed(app, cs).post(`/api/v1/creator/courses/${course.id}/lessons`).send({ sectionId: sec, title: 'Watch me', type: 'VIDEO' }).expect(201)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}`).send({ isFree: true }).expect(200);
    const check = (await authed(app, cs).get(`/api/v1/creator/courses/${course.id}/publish-check`)).body.data;
    expect(check.ready).toBe(false); // video lesson unpublished & curriculum has no published lesson
    await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}/lessons/${lesson.id}`).send({ isPublished: true }).expect(422);
    const attached = (await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}/lessons/${lesson.id}`).send({ videoAssetId: videoId, isPublished: true }).expect(200)).body.data;
    expect(attached).toMatchObject({ videoAssetId: videoId, durationSeconds: 100, isPublished: true });
    await authed(app, cs).delete(`/api/v1/creator/videos/${videoId}`).expect(409); // in use
    await authed(app, cs).post(`/api/v1/creator/courses/${course.id}/publish`).send({}).expect(200);

    const host = tenantHost(c.tenant.slug);
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: 'Vid Student', email: uniqueEmail(), password: 'student-password-1' }).expect(201);
    const s = parseSession(reg, host);
    await authed(app, s).post(`/api/v1/learn/lessons/${lesson.id}/video`).expect(403); // not enrolled
    const enrollment = (await authed(app, s).post(`/api/v1/learn/courses/${course.id}/enroll`).expect(201)).body.data;
    const play = (await authed(app, s).post(`/api/v1/learn/lessons/${lesson.id}/video`).expect(200)).body.data;
    expect(play).toMatchObject({ mimeType: 'video/mp4', durationSeconds: 100, resumeAt: 0 });

    // Signed URL streams with Range support (seeking).
    const path = new URL(play.url).pathname;
    const bin = (r: request.Test) => r.buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (x: Buffer) => d.push(x)); res.on('end', () => cb(null, Buffer.concat(d))); });
    const full = await bin(request(app.getHttpServer()).get(path)).expect(200);
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers['content-type']).toBe('video/mp4');
    expect((full.body as Buffer).length).toBe(MP4.length);
    const part = await bin(request(app.getHttpServer()).get(path).set('Range', 'bytes=4-11')).expect(206);
    expect(part.headers['content-range']).toBe(`bytes 4-11/${MP4.length}`);
    expect((part.body as Buffer).toString()).toBe('ftypisom');
    await request(app.getHttpServer()).get(path).set('Range', `bytes=${MP4.length + 10}-`).expect(416);
    await request(app.getHttpServer()).get(path.slice(0, -4) + 'xxxx').expect(403);

    // Heartbeats save position; resume picks it up; 90% auto-completes the lesson.
    await authed(app, s).put(`/api/v1/learn/video-sessions/${play.sessionId}/heartbeat`).send({ positionSeconds: 42 }).expect(200);
    const again = (await authed(app, s).post(`/api/v1/learn/lessons/${lesson.id}/video`).expect(200)).body.data;
    expect(again.resumeAt).toBe(42);
    const hb = (await authed(app, s).put(`/api/v1/learn/video-sessions/${again.sessionId}/heartbeat`).send({ positionSeconds: 95 }).expect(200)).body.data;
    expect(hb.completed).toBe(true);
    const player = (await authed(app, s).get(`/api/v1/learn/courses/${course.id}/player`)).body.data;
    expect(player.sections[0].lessons[0].completed).toBe(true);
    expect(player.enrollment.progressPercent).toBe(100);

    // Device limit: two sessions active already; third allowed, fourth refused.
    await authed(app, s).post(`/api/v1/learn/lessons/${lesson.id}/video`).expect(200);
    const blocked = await authed(app, s).post(`/api/v1/learn/lessons/${lesson.id}/video`).expect(429);
    expect(blocked.body.error.message).toMatch(/too many devices/);
    await authed(app, s).delete(`/api/v1/learn/video-sessions/${play.sessionId}`).expect(200);
    const fresh = (await authed(app, s).post(`/api/v1/learn/lessons/${lesson.id}/video`).expect(200)).body.data;

    // Revoking access stops playback at the next heartbeat.
    await authed(app, cs).delete(`/api/v1/creator/enrollments/${enrollment.id}`).expect(200);
    const stopped = await authed(app, s).put(`/api/v1/learn/video-sessions/${fresh.sessionId}/heartbeat`).send({ positionSeconds: 10 }).expect(403);
    expect(stopped.body.error.message).toMatch(/access/);
    await authed(app, s).post(`/api/v1/learn/lessons/${lesson.id}/video`).expect(403);
    expect(await prisma.videoPlaybackSession.count({ where: { id: fresh.sessionId, revokedAt: { not: null } } })).toBe(1);
  });

  it('videos are isolated between academies', async () => {
    const a = await setup(app);
    const b = await setup(app);
    const up = await uploadFile(app, a.session, 'VIDEO_SOURCE', 'a.mp4', 'video/mp4', MP4);
    const v = (await authed(app, a.session).post('/api/v1/creator/videos').send({ fileId: up.body.data.id, title: 'A video' }).expect(201)).body.data;
    await authed(app, b.session).post('/api/v1/creator/videos').send({ fileId: up.body.data.id, title: 'Stolen' }).expect(422);
    await authed(app, b.session).get(`/api/v1/creator/videos/${v.id}/preview`).expect(404);
    await authed(app, b.session).delete(`/api/v1/creator/videos/${v.id}`).expect(404);
    expect((await authed(app, b.session).get('/api/v1/creator/videos')).body.data).toEqual([]);
    const course = (await authed(app, b.session).post('/api/v1/creator/courses').send({ title: 'B course' })).body.data;
    const sec = (await authed(app, b.session).get(`/api/v1/creator/courses/${course.id}/curriculum`)).body.data[0].id;
    const l = (await authed(app, b.session).post(`/api/v1/creator/courses/${course.id}/lessons`).send({ sectionId: sec, title: 'x', type: 'VIDEO' })).body.data;
    await authed(app, b.session).patch(`/api/v1/creator/courses/${course.id}/lessons/${l.id}`).send({ videoAssetId: v.id }).expect(422);
  });
});
