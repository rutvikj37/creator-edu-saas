import { createHmac } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { QUEUES } from '../src/core/queue/queue.constants.js';
import { StorageService } from '../src/core/storage/storage.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { TenantContext } from '../src/core/tenancy/tenant-context.service.js';
import { LiveRecordingsService } from '../src/modules/live/live-recordings.service.js';
import { PlugNmeetService } from '../src/modules/live/plugnmeet.service.js';
import { ZoomService } from '../src/modules/live/zoom.service.js';
import { VIDEO_PROVIDER, type VideoProvider } from '../src/modules/videos/providers/video-provider.interface.js';
import { VideosRepository } from '../src/modules/videos/videos.repository.js';
import { bunnySim, type BunnySim } from './bunny-sim.js';
import { api, authed, createTestApp, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';
import { GoogleCalendarSim, ZoomSim } from './meeting-sims.js';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

describe('Zoom and Google Meet (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let zoom: ZoomSim;
  let google: GoogleCalendarSim;
  let bunny: BunnySim;
  let queue: Queue;

  beforeAll(async () => {
    zoom = await new ZoomSim('zoom-client-id', 'zoom-client-secret', 'zoom-webhook-secret-token').start();
    google = await new GoogleCalendarSim('meet-client.apps.googleusercontent.com', 'meet-client-secret').start();
    Object.assign(process.env, {
      ZOOM_CLIENT_ID: zoom.clientId, ZOOM_CLIENT_SECRET: zoom.clientSecret, ZOOM_WEBHOOK_SECRET_TOKEN: zoom.webhookSecret,       GOOGLE_MEET_CLIENT_ID: google.clientId, GOOGLE_MEET_CLIENT_SECRET: google.clientSecret, GOOGLE_API_ROOT_URL: google.url,
    });
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    queue = app.get<Queue>(getQueueToken(QUEUES.LIVE));
    await queue.obliterate({ force: true });
    bunny = bunnySim(app);
  });
  afterAll(async () => {
    for (const k of ['ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET', 'ZOOM_WEBHOOK_SECRET_TOKEN', 'GOOGLE_MEET_CLIENT_ID', 'GOOGLE_MEET_CLIENT_SECRET', 'GOOGLE_API_ROOT_URL']) delete process.env[k];
    await app?.close();
    await zoom?.stop();
    await google?.stop();
  });

  async function academy() {
    const c = await registerCreator(app);
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    return c;
  }
  async function freeCourse(cs: Session) {
    const co = (await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'Live Accounting' }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
    const l = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Intro', type: 'TEXT' }).expect(201)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}/lessons/${l.id}`).send({ content: doc('Hi'), isPublished: true }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}`).send({ isFree: true }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/publish`).send({}).expect(200);
    return co as { id: string };
  }
  async function student(slug: string, name: string) {
    const host = tenantHost(slug);
    const email = uniqueEmail('zm');
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: name, email, password: 'student-password-1' }).expect(201);
    const s = parseSession(reg, host);
    return { s, email, id: (await authed(app, s).get('/api/v1/auth/me')).body.data.user.id as string };
  }
  async function connect(cs: Session, provider: 'zoom' | 'google-meet', code: string) {
    const { url } = (await authed(app, cs).post(`/api/v1/creator/live/integrations/${provider}/connect`).expect(200)).body.data;
    const state = new URL(url).searchParams.get('state')!;
    return api(app).get(`/api/v1/integrations/${provider}/callback?code=${code}&state=${state}`).expect(302);
  }
  const zoomHook = (body: Record<string, unknown>) => {
    const w = zoom.webhook(body);
    return api(app).post('/api/v1/webhooks/zoom').set('Content-Type', 'application/json').set(w.headers).send(w.raw);
  };

  it('Zoom: connect → meetings per session with class settings → registrant links → host start → signed webhooks → attendance, end, recording import; updates, cancel, token rotation, deauthorisation', async () => {
    const c = await academy();
    const cs = c.session;
    const course = await freeCourse(cs);
    expect((await authed(app, cs).get('/api/v1/creator/live/integrations').expect(200)).body.data.zoom).toMatchObject({ available: true, connected: false });
    // Not connected → cannot schedule Zoom classes.
    const start = new Date(Date.now() + 10 * 60_000);
    const body = { title: 'GST Basics', provider: 'ZOOM', startsAt: start.toISOString(), durationMinutes: 45, audience: 'COURSE', courseId: course.id, waitingRoom: true, recordSessions: true, recurrence: { freq: 'WEEKLY', byDay: [['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(start.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getDay()]], count: 2 }, timezone: 'Asia/Kolkata' };
    expect((await authed(app, cs).post('/api/v1/creator/live/classes').send(body).expect(422)).body.error.details[0].message).toMatch(/Connect your Zoom account/);

    // OAuth: forged/expired state is refused; a real consent stores encrypted tokens.
    const bad = await api(app).get('/api/v1/integrations/zoom/callback?code=x&state=forged').expect(302);
    expect(bad.headers.location).toMatch(/\/creator\/integrations\?error=/);
    const ok = await connect(cs, 'zoom', zoom.issueCode());
    expect(decodeURIComponent(ok.headers.location)).toMatch(/\/creator\/integrations\?connected=zoom$/);
    const integ = await prisma.liveIntegration.findFirstOrThrow({ where: { tenantId: c.tenant.id, provider: 'ZOOM' } });
    expect(integ).toMatchObject({ status: 'CONNECTED', accountEmail: 'host@zoom.example', externalUserId: zoom.user.id, externalAccountId: zoom.user.account_id });
    expect(integ.refreshTokenEnc).not.toMatch(/^zr_/);
    expect(JSON.stringify((await authed(app, cs).get('/api/v1/creator/live/integrations')).body)).not.toMatch(/zr_|za_/);
    expect((await authed(app, cs).get('/api/v1/creator/live/providers')).body.data).toMatchObject({ zoom: true, zoomAvailable: true });

    // Class with two weekly sessions → two Zoom meetings carrying the class settings.
    const cls = (await authed(app, cs).post('/api/v1/creator/live/classes').send(body).expect(201)).body.data;
    expect(cls.sessions).toHaveLength(2);
    const sessions = await prisma.liveSession.findMany({ where: { liveClassId: cls.id }, orderBy: { startsAt: 'asc' } });
    expect(sessions.every((s) => s.providerMeetingId && s.providerJoinUrl && !s.providerSyncError)).toBe(true);
    const m1 = zoom.meetings.get(sessions[0].providerMeetingId!)!;
    expect(m1).toMatchObject({ topic: 'GST Basics', type: 2, duration: 45, timezone: 'Asia/Kolkata', settings: { waiting_room: true, auto_recording: 'cloud', approval_type: 0, join_before_host: false } });
    expect(new Date(m1.start_time).getTime()).toBe(Math.floor(sessions[0].startsAt.getTime() / 1000) * 1000); // Zoom times have whole seconds
    const sid = sessions[0].id;

    // Students: only enrolled ones; each gets a personal registrant link (created once).
    const st = await student(c.tenant.slug, 'Priya Shah');
    await authed(app, st.s).post(`/api/v1/learn/live/sessions/${sid}/join`).expect(403);
    await authed(app, st.s).post(`/api/v1/learn/courses/${course.id}/enroll`).expect(201);
    const j = (await authed(app, st.s).post(`/api/v1/learn/live/sessions/${sid}/join`).expect(200)).body.data;
    expect(j).toEqual({ provider: 'ZOOM', joinUrl: expect.stringMatching(/\/w\/\d+\?tk=/) });
    const reg = [...zoom.registrants.values()][0];
    expect(reg).toMatchObject({ email: st.email, first_name: 'Priya', last_name: 'Shah' });
    expect((await authed(app, st.s).post(`/api/v1/learn/live/sessions/${sid}/join`).expect(200)).body.data.joinUrl).toBe(j.joinUrl);
    expect(zoom.registrants.size).toBe(1);

    // Host start: fresh start link; session live.
    const h = (await authed(app, cs).post(`/api/v1/creator/live/sessions/${sid}/host`).expect(200)).body.data;
    expect(h).toMatchObject({ provider: 'ZOOM', role: 'host', joinUrl: expect.stringMatching(/\/s\/\d+\?zak=/) });
    expect((await prisma.liveSession.findUniqueOrThrow({ where: { id: sid } })).status).toBe('LIVE');

    // Webhooks: signature checked; URL validation answered; events deduplicated.
    await api(app).post('/api/v1/webhooks/zoom').set('Content-Type', 'application/json').set({ 'x-zm-signature': 'v0=bad', 'x-zm-request-timestamp': '1' }).send(JSON.stringify({ event: 'meeting.started' })).expect(401);
    const val = (await zoomHook({ event: 'endpoint.url_validation', payload: { plainToken: 'abc123' } }).expect(200)).body.data;
    expect(val).toEqual({ plainToken: 'abc123', encryptedToken: createHmac('sha256', zoom.webhookSecret).update('abc123').digest('hex') });
    const mid = sessions[0].providerMeetingId!;
    const regId = [...zoom.registrants.keys()][0];
    const joinedAt = new Date(Date.now() - 600_000).toISOString();
    const pj = { event: 'meeting.participant_joined', event_ts: 1, payload: { account_id: zoom.user.account_id, object: { id: mid, uuid: 'u1', host_id: zoom.user.id, participant: { user_id: '16778240', user_name: 'Priya Shah', email: '', registrant_id: regId, join_time: joinedAt, participant_uuid: 'pu-1' } } } };
    await zoomHook(pj).expect(200);
    expect((await zoomHook(pj).expect(200)).body.data.duplicate).toBe(true);
    await zoomHook({ event: 'meeting.participant_joined', event_ts: 2, payload: { object: { id: mid, host_id: zoom.user.id, participant: { id: zoom.user.id, user_id: '1', user_name: 'Host', email: 'host@zoom.example', join_time: joinedAt } } } }).expect(200);
    await zoomHook({ event: 'meeting.participant_joined', event_ts: 3, payload: { object: { id: mid, host_id: zoom.user.id, participant: { user_id: '99', user_name: 'Walk-in Guest', email: 'nobody@example.test', join_time: joinedAt, participant_uuid: 'pu-guest' } } } }).expect(200);
    await zoomHook({ event: 'meeting.participant_left', event_ts: 4, payload: { object: { id: mid, host_id: zoom.user.id, participant: { user_id: '16778240', user_name: 'Priya Shah', registrant_id: regId, leave_time: new Date().toISOString() } } } }).expect(200);
    expect((await zoomHook({ event: 'meeting.participant_joined', event_ts: 5, payload: { object: { id: '123', participant: {} } } }).expect(200)).body.data.ignored).toBe(true);
    const att = (await authed(app, cs).get(`/api/v1/creator/live/sessions/${sid}/attendance`).expect(200)).body.data;
    expect(att.people.map((p: any) => [p.identity.split('_')[0], p.name, p.source]).sort()).toEqual([['host', expect.any(String), 'zoom'], ['usr', 'Priya Shah', 'zoom'], ['zoom', 'Walk-in Guest', 'zoom']].sort());
    expect(att.people.find((p: any) => p.identity === `usr_${st.id}`).seconds).toBeGreaterThanOrEqual(590);

    // Meeting ends → session ended; cloud recording → imported into Bunny with exact bytes.
    await zoomHook({ event: 'meeting.ended', event_ts: 6, payload: { object: { id: mid, host_id: zoom.user.id, end_time: new Date().toISOString() } } }).expect(200);
    expect(await prisma.liveSession.findUniqueOrThrow({ where: { id: sid } })).toMatchObject({ status: 'ENDED', recordingStatus: 'PROCESSING' });
    const bytes = Buffer.concat([Buffer.from('ftypisom'), Buffer.alloc(5000, 9)]);
    const file = zoom.addRecordingFile(bytes);
    await zoomHook({ event: 'recording.completed', event_ts: 7, download_token: file.token, payload: { object: { id: Number(mid), host_id: zoom.user.id, recording_files: [{ id: file.id, file_type: 'MP4', status: 'completed', download_url: file.downloadUrl, recording_start: new Date().toISOString() }, { id: 'chat1', file_type: 'CHAT', status: 'completed', download_url: `${zoom.url}/x` }] } } }).expect(200);
    const job = (await queue.getJobs(['waiting', 'delayed'])).find((x) => x.name === 'live-zoom-import')!;
    expect(job.opts.attempts).toBe(5);
    const recordings = new LiveRecordingsService(prisma, app.get(TenantContext), app.get(PlugNmeetService), app.get(StorageService), app.get(VideosRepository), app.get<VideoProvider>(VIDEO_PROVIDER));
    expect(await recordings.import(job.data.id, false, () => app.get(ZoomService).downloadRecording(job.data.url, job.data.token))).toMatchObject({ imported: true });
    const rec = await prisma.liveRecording.findUniqueOrThrow({ where: { id: job.data.id } });
    const video = await prisma.videoAsset.findUniqueOrThrow({ where: { id: rec.videoAssetId! } });
    expect(bunny.originals.get(video.providerAssetId!)).toEqual(bytes);
    expect(await prisma.liveSession.findUniqueOrThrow({ where: { id: sid } })).toMatchObject({ recordingStatus: 'READY', videoAssetId: video.id });

    // Class edits reach the upcoming meeting; cancelling a session deletes its meeting.
    await authed(app, cs).patch(`/api/v1/creator/live/classes/${cls.id}`).send({ title: 'GST Basics — Part 2', waitingRoom: false }).expect(200);
    const m2 = zoom.meetings.get(sessions[1].providerMeetingId!)!;
    expect(m2).toMatchObject({ topic: 'GST Basics — Part 2', settings: { waiting_room: false } });
    await authed(app, cs).post(`/api/v1/creator/live/sessions/${sessions[1].id}/cancel`).expect((r) => expect([200, 201]).toContain(r.status));
    expect(zoom.meetings.has(sessions[1].providerMeetingId!)).toBe(false);

    // Expired access token → refreshed with rotation (old refresh token no longer valid).
    const before = await prisma.liveIntegration.findFirstOrThrow({ where: { tenantId: c.tenant.id, provider: 'ZOOM' } });
    await prisma.liveIntegration.update({ where: { id: before.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    const later = (await authed(app, cs).post('/api/v1/creator/live/classes').send({ ...body, title: 'Later class', recurrence: null }).expect(201)).body.data;
    const after = await prisma.liveIntegration.findFirstOrThrow({ where: { id: before.id } });
    expect(after.refreshTokenEnc).not.toBe(before.refreshTokenEnc);
    expect(after.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect((await prisma.liveSession.findFirstOrThrow({ where: { liveClassId: later.id } })).providerMeetingId).toBeTruthy();

    // Zoom app removed → connection revoked; new Zoom classes are refused.
    const deauth = (await zoomHook({ event: 'app_deauthorized', payload: { user_id: zoom.user.id, account_id: zoom.user.account_id, client_id: zoom.clientId, deauthorization_time: new Date().toISOString() } }).expect(200)).body.data;
    expect(deauth.deauthorized).toBe(1);
    expect((await authed(app, cs).get('/api/v1/creator/live/integrations')).body.data.zoom).toMatchObject({ connected: false, status: 'REVOKED' });
    await authed(app, cs).post('/api/v1/creator/live/classes').send({ ...body, recurrence: null }).expect(422);

    // Another academy sees nothing of this connection.
    const other = await academy();
    expect((await authed(app, other.session).get('/api/v1/creator/live/integrations')).body.data.zoom).toMatchObject({ connected: false, status: null });
  });

  it('Zoom basic account: no registration — everyone gets the meeting link; failures are kept on the session and retried', async () => {
    const c = await academy();
    zoom.basicAccount = true;
    try {
      await connect(c.session, 'zoom', zoom.issueCode());
      const web = (await authed(app, c.session).post('/api/v1/creator/live/classes').send({ kind: 'WEBINAR', title: 'Free tax webinar', provider: 'ZOOM', startsAt: new Date(Date.now() + 5 * 60_000).toISOString(), durationMinutes: 30 }).expect(201)).body.data;
      const s = await prisma.liveSession.findFirstOrThrow({ where: { liveClassId: web.id } });
      expect(zoom.meetings.get(s.providerMeetingId!)!.settings.approval_type).toBe(2);
      const host = tenantHost(c.tenant.slug);
      await api(app).post(`/api/v1/public/webinars/${web.slug}/register`).set('Host', host).send({ name: 'Guest One', email: 'guest-zoom@example.test', consent: false }).expect(200);
      const reg = await prisma.webinarRegistration.findFirstOrThrow({ where: { liveClassId: web.id } });
      const j = (await api(app).post(`/api/v1/public/live/tickets/${reg.ticketCode}/join`).set('Host', host).send({ sessionId: s.id }).expect(200)).body.data;
      expect(j).toEqual({ provider: 'ZOOM', joinUrl: s.providerJoinUrl });
      // Zoom unreachable while scheduling: error stored, the worker retry creates it later.
      await prisma.liveIntegration.updateMany({ where: { tenantId: c.tenant.id }, data: { accessTokenEnc: null, tokenExpiresAt: null } });
      const realRefresh = zoom.refreshTokens;
      zoom.refreshTokens = new Set();
      const cls2 = (await authed(app, c.session).post('/api/v1/creator/live/classes').send({ title: 'Retry me', provider: 'ZOOM', startsAt: new Date(Date.now() + 3600_000).toISOString(), durationMinutes: 30, audience: 'ALL_STUDENTS' }).expect(201)).body.data;
      const s2 = await prisma.liveSession.findFirstOrThrow({ where: { liveClassId: cls2.id } });
      expect(s2.providerMeetingId).toBeNull();
      expect(s2.providerSyncError).toMatch(/Zoom token request failed/);
      expect((await prisma.liveIntegration.findFirstOrThrow({ where: { tenantId: c.tenant.id } })).status).toBe('ERROR');
      zoom.refreshTokens = realRefresh;
    } finally {
      zoom.basicAccount = false;
    }
  });

  it('Google Meet: connect → Calendar event with a Meet link per session (no invitations) → join link with click attendance; edits, cancel and disconnect', async () => {
    const c = await academy();
    const cs = c.session;
    const ok = await connect(cs, 'google-meet', google.issueCode());
    expect(ok.headers.location).toMatch(/connected=google-meet$/);
    expect((await authed(app, cs).get('/api/v1/creator/live/integrations')).body.data.googleMeet).toMatchObject({ connected: true, accountEmail: 'teacher@gmail.example' });
    const start = new Date(Date.now() + 10 * 60_000).toISOString();
    const rec = await authed(app, cs).post('/api/v1/creator/live/classes').send({ title: 'Doubt clearing', provider: 'GOOGLE_MEET', startsAt: start, durationMinutes: 60, audience: 'ALL_STUDENTS', recordSessions: true }).expect(422);
    expect(rec.body.error.details[0].field).toBe('recordSessions');
    const cls = (await authed(app, cs).post('/api/v1/creator/live/classes').send({ title: 'Doubt clearing', provider: 'GOOGLE_MEET', startsAt: start, durationMinutes: 60, audience: 'ALL_STUDENTS', timezone: 'Asia/Kolkata' }).expect(201)).body.data;
    const s = await prisma.liveSession.findFirstOrThrow({ where: { liveClassId: cls.id } });
    expect(s.providerJoinUrl).toMatch(/^https:\/\/meet\.google\.com\/[\w-]+$/);
    const ev = google.events.get(s.providerMeetingId!)!;
    expect(ev).toMatchObject({ summary: 'Doubt clearing', sendUpdates: 'none', start: { timeZone: 'Asia/Kolkata' }, guestsCanInviteOthers: false });
    expect(google.calls.some((x) => x.includes('conferenceDataVersion=1'))).toBe(true);

    const st = await student(c.tenant.slug, 'Meet Student');
    const j = (await authed(app, st.s).post(`/api/v1/learn/live/sessions/${s.id}/join`).expect(200)).body.data;
    expect(j).toEqual({ provider: 'GOOGLE_MEET', joinUrl: s.providerJoinUrl });
    expect(await prisma.liveAttendance.findFirst({ where: { sessionId: s.id } })).toMatchObject({ identity: `usr_${st.id}`, source: 'click' });
    const h = (await authed(app, cs).post(`/api/v1/creator/live/sessions/${s.id}/host`).expect(200)).body.data;
    expect(h).toEqual({ provider: 'GOOGLE_MEET', joinUrl: s.providerJoinUrl, role: 'host' });

    // Edits patch the event; cancelling the class deletes it; disconnect revokes the grant.
    const cls2 = (await authed(app, cs).post('/api/v1/creator/live/classes').send({ title: 'Office hours', provider: 'GOOGLE_MEET', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, audience: 'ALL_STUDENTS' }).expect(201)).body.data;
    const s2 = await prisma.liveSession.findFirstOrThrow({ where: { liveClassId: cls2.id } });
    await authed(app, cs).patch(`/api/v1/creator/live/classes/${cls2.id}`).send({ title: 'Office hours (new time soon)' }).expect(200);
    expect(google.events.get(s2.providerMeetingId!)!.summary).toBe('Office hours (new time soon)');
    await authed(app, cs).post(`/api/v1/creator/live/classes/${cls2.id}/cancel`).expect((r) => expect([200, 201]).toContain(r.status));
    expect(google.events.has(s2.providerMeetingId!)).toBe(false);
    await authed(app, cs).delete('/api/v1/creator/live/integrations/google-meet').expect(200);
    expect(google.revoked).toHaveLength(1);
    expect((await authed(app, cs).get('/api/v1/creator/live/integrations')).body.data.googleMeet).toMatchObject({ connected: false });
  });
});
