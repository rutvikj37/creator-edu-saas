import type { NestExpressApplication } from '@nestjs/platform-express';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { QUEUES } from '../src/core/queue/queue.constants.js';
import { StorageService } from '../src/core/storage/storage.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { TenantContext } from '../src/core/tenancy/tenant-context.service.js';
import { LiveRecordingsService } from '../src/modules/live/live-recordings.service.js';
import { LIVE_JOBS, PlugNmeetJobs } from '../src/modules/live/live.processor.js';
import { LiveService } from '../src/modules/live/live.service.js';
import { PlugNmeetService } from '../src/modules/live/plugnmeet.service.js';
import { VIDEO_PROVIDER, type VideoProvider } from '../src/modules/videos/providers/video-provider.interface.js';
import { VideosRepository } from '../src/modules/videos/videos.repository.js';
import { bunnySim, type BunnySim } from './bunny-sim.js';
import { api, authed, createTestApp, lastEmail, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';
import { PlugNmeetSim } from './plugnmeet-sim.js';

const KEY = 'plugnmeet';
const SECRET = 'pnm-test-secret-0123456789abcdefghijklmn';
const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

describe('plugNmeet live classes (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let pnm: PlugNmeetSim;
  let bunny: BunnySim;
  let jobs: PlugNmeetJobs;
  let recordings: LiveRecordingsService;
  let queue: Queue;

  beforeAll(async () => {
    pnm = await new PlugNmeetSim(KEY, SECRET).start();
    process.env.PLUGNMEET_URL = pnm.url;
    process.env.PLUGNMEET_API_KEY = KEY;
    process.env.PLUGNMEET_API_SECRET = SECRET;
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    queue = app.get<Queue>(getQueueToken(QUEUES.LIVE));
    await queue.obliterate({ force: true });
    bunny = bunnySim(app);
    // Worker-side services, built from the same providers the worker module uses.
    const ctx = app.get(TenantContext);
    recordings = new LiveRecordingsService(prisma, ctx, app.get(PlugNmeetService), app.get(StorageService), app.get(VideosRepository), app.get<VideoProvider>(VIDEO_PROVIDER));
    jobs = new PlugNmeetJobs(prisma, ctx, app.get(LiveService), app.get(PlugNmeetService), recordings, queue);
  });
  afterAll(async () => {
    delete process.env.PLUGNMEET_URL;
    delete process.env.PLUGNMEET_API_KEY;
    delete process.env.PLUGNMEET_API_SECRET;
    await app?.close();
    await pnm?.stop();
  });

  async function academy() {
    const c = await registerCreator(app);
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    return c;
  }
  async function freeCourse(cs: Session) {
    const co = (await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'Live Maths' }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
    const l = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Intro', type: 'TEXT' }).expect(201)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}/lessons/${l.id}`).send({ content: doc('Hi'), isPublished: true }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}`).send({ isFree: true }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/publish`).send({}).expect(200);
    return co;
  }
  async function student(slug: string, name = 'Asha Student') {
    const host = tenantHost(slug);
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: name, email: uniqueEmail('pnm'), password: 'student-password-1' }).expect(201);
    const s = parseSession(reg, host);
    return { s, id: (await authed(app, s).get('/api/v1/auth/me')).body.data.user.id as string };
  }
  const tokenOf = (joinUrl: string) => new URL(joinUrl).searchParams.get('access_token')!;
  const hook = (path: string, body: Record<string, unknown>) => api(app).post(path).set('Content-Type', 'application/json').send(JSON.stringify(body));

  it('class: room with the class settings, signed API calls, join tokens, attendance (webhooks + sync), end', async () => {
    const c = await academy();
    const cs = c.session;
    const course = await freeCourse(cs);
    expect((await authed(app, cs).get('/api/v1/creator/live/providers').expect(200)).body.data).toMatchObject({ plugnmeet: true, plugnmeetRecording: true, external: true });

    const start = new Date(Date.now() + 10 * 60_000);
    const cls = (await authed(app, cs).post('/api/v1/creator/live/classes').send({ title: 'Algebra live', provider: 'PLUGNMEET', startsAt: start.toISOString(), durationMinutes: 60, audience: 'COURSE', courseId: course.id, waitingRoom: true, recordSessions: true, capacity: 30 }).expect(201)).body.data;
    expect(cls).toMatchObject({ provider: 'PLUGNMEET', waitingRoom: true, recordSessions: true });
    const sid = cls.sessions[0].id;
    const roomId = (await prisma.liveSession.findUniqueOrThrow({ where: { id: sid } })).roomName;

    // Not enrolled → refused before plugNmeet is called.
    const st = await student(c.tenant.slug);
    await authed(app, st.s).post(`/api/v1/learn/live/sessions/${sid}/join`).expect(403);
    expect(pnm.calls.filter((x) => x.startsWith('POST'))).toEqual([]);

    // Host start creates the room with the class settings; the session goes live.
    const h = (await authed(app, cs).post(`/api/v1/creator/live/sessions/${sid}/host`).expect(200)).body.data;
    expect(h).toEqual({ provider: 'PLUGNMEET', joinUrl: expect.stringMatching(new RegExp(`^${pnm.url}/\\?access_token=`)), role: 'host' });
    expect(JSON.stringify(h)).not.toContain(SECRET);
    const room = pnm.rooms.get(roomId)!;
    expect(room.maxParticipants).toBe(35);
    expect(room.metadata).toMatchObject({
      roomTitle: 'Algebra live',
      webhookUrl: expect.stringMatching(new RegExp(`/api/v1/webhooks/plugnmeet/${sid}/[0-9a-f]{40}$`)),
      logoutUrl: expect.stringMatching(/\/learn\/live$/),
      roomFeatures: { waitingRoomFeatures: { isActive: true }, recordingFeatures: { isAllow: true, isAllowCloud: true, enableAutoCloudRecording: true }},
    });
    expect(room.metadata.roomFeatures.adminOnlyWebcams ?? false).toBe(false); // proto3 JSON omits false
    expect(pnm.joinTokens.get(tokenOf(h.joinUrl))!.userInfo).toMatchObject({ userId: expect.stringMatching(/^host_/), isAdmin: true, userMetadata: { isAdmin: true, isPresenter: true } });
    expect((await prisma.liveSession.findUniqueOrThrow({ where: { id: sid } })).status).toBe('LIVE');

    // Enrolled student joins as a non-admin who waits for approval in plugNmeet's waiting room.
    await authed(app, st.s).post(`/api/v1/learn/courses/${course.id}/enroll`).expect(201);
    const j = (await authed(app, st.s).post(`/api/v1/learn/live/sessions/${sid}/join`).expect(200)).body.data;
    expect(j).toMatchObject({ provider: 'PLUGNMEET', role: 'attendee' });
    const su = pnm.joinTokens.get(tokenOf(j.joinUrl))!.userInfo;
    expect(su).toMatchObject({ userId: `usr_${st.id}`, name: 'Asha Student', userMetadata: { waitForApproval: true, exUserId: `usr_${st.id}` } });
    expect([su.isAdmin ?? false, su.userMetadata.isAdmin ?? false]).toEqual([false, false]);
    expect(pnm.calls.filter((x) => x === 'POST /auth/room/create')).toHaveLength(1); // room reused

    // Webhooks: forged secret refused; joins/leaves recorded once.
    const path = room.metadata.webhookUrl.replace(/^https?:\/\/[^/]+/, '');
    await hook(path.replace(/[0-9a-f]{40}$/, '0'.repeat(40)), { event: 'participant_joined', id: 'x' }).expect(401);
    await hook(`/api/v1/webhooks/plugnmeet/${sid}/short`, { event: 'participant_joined' }).expect(401);
    const joinedAt = Math.floor(Date.now() / 1000) - 120;
    await hook(path, { event: 'participant_joined', id: 'EV1', room: { roomId }, participant: { identity: `usr_${st.id}`, joinedAt: String(joinedAt) } }).expect(200);
    expect((await hook(path, { event: 'participant_joined', id: 'EV1', room: { roomId }, participant: { identity: `usr_${st.id}` } }).expect(200)).body.data.duplicate).toBe(true);
    expect((await hook(path, { event: 'participant_joined', id: 'EV9', room: { roomId: 'someone-elses-room' }, participant: { identity: 'usr_x' } }).expect(200)).body.data.ignored).toBe(true);
    await hook(path, { event: 'participant_left', id: 'EV2', room: { roomId }, participant: { identity: `usr_${st.id}` } }).expect(200);
    let rows = await prisma.liveAttendance.findMany({ where: { sessionId: sid } });
    expect(rows).toEqual([expect.objectContaining({ identity: `usr_${st.id}`, source: 'plugnmeet', displayName: 'Asha Student', joinedAt: new Date(joinedAt * 1000), leftAt: expect.any(Date) })]);

    // Missed webhooks: the sync job reads the room's participants and fills the gaps.
    pnm.join(roomId, `usr_${st.id}`, 'Asha Student');
    pnm.join(roomId, pnm.joinTokens.get(tokenOf(h.joinUrl))!.userInfo.userId, 'Host');
    expect(await jobs.sync()).toMatchObject({ synced: 1 });
    rows = await prisma.liveAttendance.findMany({ where: { sessionId: sid, leftAt: null } });
    expect(rows.map((r) => r.role).sort()).toEqual(['attendee', 'host']);
    pnm.leave(roomId, `usr_${st.id}`);
    await jobs.sync();
    expect(await prisma.liveAttendance.count({ where: { sessionId: sid, leftAt: null } })).toBe(1);
    const att = (await authed(app, cs).get(`/api/v1/creator/live/sessions/${sid}/attendance`).expect(200)).body.data;
    expect(att.people.find((p: any) => p.identity === `usr_${st.id}`).seconds).toBeGreaterThanOrEqual(120);

    // Capacity counts people present.
    await prisma.liveClass.update({ where: { id: cls.id }, data: { capacity: 1 } });
    const st2 = await student(c.tenant.slug, 'Second Student');
    await authed(app, st2.s).post(`/api/v1/learn/courses/${course.id}/enroll`).expect(201);
    pnm.join(roomId, `usr_${st.id}`, 'Asha Student');
    await jobs.sync();
    await authed(app, st2.s).post(`/api/v1/learn/live/sessions/${sid}/join`).expect(409);
    await prisma.liveClass.update({ where: { id: cls.id }, data: { capacity: 30 } });

    // Host ends: plugNmeet room ended, attendance closed, recording awaited.
    await authed(app, cs).post(`/api/v1/creator/live/sessions/${sid}/end`).expect(200);
    expect(pnm.calls).toContain('POST /auth/room/endRoom');
    expect(pnm.rooms.get(roomId)!.active).toBe(false);
    expect(await prisma.liveSession.findUniqueOrThrow({ where: { id: sid } })).toMatchObject({ status: 'ENDED', recordingStatus: 'PROCESSING' });
    expect(await prisma.liveAttendance.count({ where: { sessionId: sid, leftAt: null } })).toBe(0);
    await authed(app, st.s).post(`/api/v1/learn/live/sessions/${sid}/join`).expect(409);

    // Recording: discovered through the API, uploaded to Bunny, playable once Bunny has encoded it.
    const bytes = Buffer.concat([Buffer.from('ftypmp42'), Buffer.alloc(4096, 3)]);
    const recId = pnm.addRecording(roomId, bytes);
    pnm.addRecording('another-room', Buffer.from('not ours'));
    expect(await jobs.sync()).toMatchObject({ queued: 1 });
    const queued = (await queue.getJobs(['waiting', 'delayed'])).find((x) => x.name === LIVE_JOBS.PNM_IMPORT)!;
    expect(queued.opts.attempts).toBe(5);
    const row = await prisma.liveRecording.findUniqueOrThrow({ where: { providerRecordingId: recId } });
    expect(await recordings.import(row.id, false)).toMatchObject({ imported: true });
    expect(await jobs.sync()).toMatchObject({ queued: 0 }); // imported once
    const done = await prisma.liveRecording.findUniqueOrThrow({ where: { id: row.id } });
    expect(done).toMatchObject({ status: 'READY', sizeBytes: BigInt(bytes.length) });
    const video = await prisma.videoAsset.findUniqueOrThrow({ where: { id: done.videoAssetId! } });
    expect(video).toMatchObject({ provider: 'BUNNY', status: 'UPLOADED', title: expect.stringMatching(/^Algebra live — \d{4}-\d{2}-\d{2}$/), originalSize: BigInt(bytes.length) });
    expect(bunny.originals.get(video.providerAssetId!)).toEqual(bytes);
    expect(await prisma.liveSession.findUniqueOrThrow({ where: { id: sid } })).toMatchObject({ recordingStatus: 'READY', videoAssetId: video.id });
    await authed(app, st.s).get(`/api/v1/learn/live/sessions/${sid}/recording`).expect(409); // still encoding
    await prisma.videoAsset.update({ where: { id: video.id }, data: { status: 'READY' } });
    const play = (await authed(app, st.s).get(`/api/v1/learn/live/sessions/${sid}/recording`).expect(200)).body.data;
    expect(play).toMatchObject({ kind: 'iframe', url: expect.stringContaining(video.providerAssetId!) });
    const outsider = await student(c.tenant.slug, 'Not Enrolled');
    await authed(app, outsider.s).get(`/api/v1/learn/live/sessions/${sid}/recording`).expect(403);
  });

  it('webinar: attendees locked, room closed by plugNmeet ends the session, failures and fallbacks', async () => {
    const c = await academy();
    const cs = c.session;
    const web = (await authed(app, cs).post('/api/v1/creator/live/classes').send({ kind: 'WEBINAR', title: 'Free Budgeting Webinar', provider: 'PLUGNMEET', startsAt: new Date(Date.now() + 5 * 60_000).toISOString(), durationMinutes: 45, recordSessions: true }).expect(201)).body.data;
    const sid = web.sessions[0].id;
    const roomId = (await prisma.liveSession.findUniqueOrThrow({ where: { id: sid } })).roomName;
    const host = tenantHost(c.tenant.slug);
    await api(app).post(`/api/v1/public/webinars/${web.slug}/register`).set('Host', host).send({ name: 'Guest Person', email: 'pnm-guest@example.test', consent: true }).expect(200);
    const code = /\/live\/ticket\/([\w-]+)/.exec((await lastEmail(app, 'pnm-guest@example.test'))!.text)![1];

    // plugNmeet unreachable → a clear 503, nothing stored as live.
    pnm.fail(/^\/auth\/room\/isRoomActive$/, 502);
    const down = await api(app).post(`/api/v1/public/live/tickets/${code}/join`).set('Host', host).send({ sessionId: sid });
    expect(down.status).toBe(503);
    expect(down.body.error.message).toMatch(/unavailable right now/);

    // A registrant joining first creates the room; attendees cannot unmute, share or turn on video.
    const tj = (await api(app).post(`/api/v1/public/live/tickets/${code}/join`).set('Host', host).send({ sessionId: sid }).expect(200)).body.data;
    const u = pnm.joinTokens.get(tokenOf(tj.joinUrl))!.userInfo;
    expect(u).toMatchObject({ userId: expect.stringMatching(/^reg_/), name: 'Guest Person' });
    expect([u.isAdmin ?? false, u.userMetadata?.waitForApproval ?? false]).toEqual([false, false]);
    expect(pnm.rooms.get(roomId)!.metadata).toMatchObject({ defaultLockSettings: { lockMicrophone: true, lockWebcam: true, lockScreenSharing: true }, roomFeatures: { adminOnlyWebcams: true, muteOnStart: true } });
    expect(pnm.rooms.get(roomId)!.metadata.roomFeatures.allowViewOtherUsersList ?? false).toBe(false);

    // Host starts; later plugNmeet closes the empty room → the session ends on the webhook.
    await authed(app, cs).post(`/api/v1/creator/live/sessions/${sid}/host`).expect(200);
    const path = pnm.rooms.get(roomId)!.metadata.webhookUrl.replace(/^https?:\/\/[^/]+/, '');
    await hook(path, { event: 'participant_joined', id: 'W1', room: { roomId }, participant: { identity: u.userId } }).expect(200);
    pnm.close(roomId);
    await hook(path, { event: 'room_finished', id: 'W2', room: { roomId }, createdAt: String(Math.floor(Date.now() / 1000)) }).expect(200);
    expect(await prisma.liveSession.findUniqueOrThrow({ where: { id: sid } })).toMatchObject({ status: 'ENDED', recordingStatus: 'PROCESSING' });
    expect(await prisma.liveAttendance.count({ where: { sessionId: sid, leftAt: null } })).toBe(0);

    // Recording download without Content-Length is spooled to learn its size; the first try fails and is retried.
    const bytes = Buffer.alloc(10_000, 7);
    pnm.addRecording(roomId, bytes);
    pnm.sendLength = false;
    await jobs.sync();
    const row = (await prisma.liveRecording.findFirstOrThrow({ where: { sessionId: sid } }));
    pnm.fail(/^\/auth\/recording\/getDownloadToken$/, 500);
    await expect(recordings.import(row.id, false)).rejects.toThrow();
    expect((await prisma.liveRecording.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('IMPORTING');
    expect(await recordings.import(row.id, false)).toMatchObject({ imported: true });
    pnm.sendLength = true;
    const v = await prisma.videoAsset.findUniqueOrThrow({ where: { id: (await prisma.liveRecording.findUniqueOrThrow({ where: { id: row.id } })).videoAssetId! } });
    expect(bunny.originals.get(v.providerAssetId!)).toEqual(bytes);

    // A recording that cannot be downloaded fails after the final attempt.
    const s2 = await prisma.liveSession.create({ data: { tenantId: c.tenant.id, liveClassId: web.id, startsAt: new Date(Date.now() - 7200_000), endsAt: new Date(Date.now() - 3600_000), status: 'ENDED', endedAt: new Date(Date.now() - 3600_000), recordingStatus: 'PROCESSING', roomName: `pnm-test-${Date.now()}` } });
    const lost = pnm.addRecording(s2.roomName, Buffer.from('x'));
    await jobs.sync();
    pnm.recordings.delete(lost);
    const lostRow = await prisma.liveRecording.findUniqueOrThrow({ where: { providerRecordingId: lost } });
    expect(await recordings.import(lostRow.id, true)).toMatchObject({ failed: expect.stringMatching(/recording not found/) });
    expect(await prisma.liveSession.findUniqueOrThrow({ where: { id: s2.id } })).toMatchObject({ recordingStatus: 'FAILED' });

    // Room gone without a webhook: the sync job ends the session after a grace period.
    const s3 = await prisma.liveSession.create({ data: { tenantId: c.tenant.id, liveClassId: web.id, startsAt: new Date(Date.now() - 1800_000), endsAt: new Date(Date.now() + 900_000), status: 'LIVE', startedAt: new Date(Date.now() - 1800_000), roomName: `pnm-gone-${Date.now()}` } });
    await jobs.sync();
    expect((await prisma.liveSession.findUniqueOrThrow({ where: { id: s3.id } })).status).toBe('ENDED');
  });

  it('validation and wrong credentials', async () => {
    const c = await academy();
    const r = await authed(app, c.session).post('/api/v1/creator/live/classes').send({ title: 'Bad', provider: 'ZOOMISH', startsAt: new Date(Date.now() + 3600_000).toISOString(), durationMinutes: 30, audience: 'ALL_STUDENTS' });
    expect(r.status).toBe(422);
    // The API secret must match the plugNmeet server's: a wrong one is refused there (signature), not silently accepted.
    const svc = app.get(PlugNmeetService) as unknown as { client: unknown; config: { get: (k: string) => string | undefined } };
    const real = svc.config.get.bind(svc.config);
    svc.client = null;
    svc.config.get = (k: string) => (k === 'PLUGNMEET_API_SECRET' ? 'wrong-secret' : real(k));
    await expect(app.get(PlugNmeetService).isRoomActive('any')).rejects.toThrow(/invalid signature/);
    svc.config.get = real;
    svc.client = null;
    expect(await app.get(PlugNmeetService).isRoomActive('any')).toBe(false);
  });
});
