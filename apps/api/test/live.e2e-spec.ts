import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { LiveJobs } from '../src/modules/live/live.processor.js';
import { LiveKitService } from '../src/modules/live/livekit.service.js';
import { EntitlementsService } from '../src/modules/subscriptions/entitlements.service.js';
import { api, authed, createTestApp, lastEmail, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';

const LK = { url: 'wss://live.example.test', key: 'APItestkey', secret: 'livekit-test-secret-at-least-32-chars-long' };
const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
const WEEKDAY = (d: Date) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getDay()];

describe('Live learning (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const calls: string[] = [];

  async function webhook(event: Record<string, unknown>) {
    const body = JSON.stringify({ createdAt: String(Math.floor(Date.now() / 1000)), ...event });
    const at = new AccessToken(LK.key, LK.secret);
    at.sha256 = createHash('sha256').update(body).digest('base64');
    return api(app).post('/api/v1/webhooks/livekit').set('Content-Type', 'application/webhook+json').set('Authorization', await at.toJwt()).send(body);
  }

  beforeAll(async () => {
    process.env.LIVEKIT_URL = LK.url;
    process.env.LIVEKIT_API_KEY = LK.key;
    process.env.LIVEKIT_API_SECRET = LK.secret;
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    const lk = app.get(LiveKitService);
    lk.ensureRoom = async (room) => { calls.push(`create:${room}`); };
    lk.deleteRoom = async (room) => { calls.push(`delete:${room}`); };
    lk.setPermissions = async (room, identity, grant) => { calls.push(`perm:${identity}:${grant.canPublish}`); };
    lk.removeParticipant = async (room, identity) => { calls.push(`remove:${identity}`); };
  });
  afterAll(async () => {
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    await app?.close();
  });

  async function academy() {
    const c = await registerCreator(app);
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    return c;
  }
  async function freeCourse(cs: Session) {
    const co = (await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'Live Python' }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
    const l = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Intro', type: 'TEXT' }).expect(201)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}/lessons/${l.id}`).send({ content: doc('Hi'), isPublished: true }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}`).send({ isFree: true }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/publish`).send({}).expect(200);
    return co;
  }
  async function student(slug: string, name = 'Riya Student') {
    const host = tenantHost(slug);
    const email = uniqueEmail('live');
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: name, email, password: 'student-password-1' }).expect(201);
    const s = parseSession(reg, host);
    const me = (await authed(app, s).get('/api/v1/auth/me')).body.data.user;
    return { s, email, id: me.id as string };
  }

  it('LiveKit class: recurring schedule, enrolment check, waiting room, host, attendance webhooks, polls, Q&A, end', async () => {
    const c = await academy();
    const cs = c.session;
    const course = await freeCourse(cs);
    expect((await authed(app, cs).get('/api/v1/creator/live/providers').expect(200)).body.data).toEqual({ livekit: true, plugnmeet: false, external: true, recording: false, livekitRecording: false, plugnmeetRecording: false, zoom: false, zoomAvailable: false, googleMeet: false, googleMeetAvailable: false });

    const start = new Date(Date.now() + 10 * 60_000);
    const bad = await authed(app, cs).post('/api/v1/creator/live/classes').send({ title: 'x', provider: 'LIVEKIT', startsAt: start.toISOString(), durationMinutes: 60, audience: 'COURSE', courseId: course.id, recordSessions: true, recurrence: { freq: 'WEEKLY', byDay: ['MO'] } }).expect(422);
    expect(bad.body.error.details.map((d: any) => d.field).sort()).toEqual(['recordSessions', 'recurrence']);
    const clsRes = await authed(app, cs).post('/api/v1/creator/live/classes').send({
      title: 'Weekly Python lab', provider: 'LIVEKIT', startsAt: start.toISOString(), durationMinutes: 60, audience: 'COURSE', courseId: course.id,
      waitingRoom: true, capacity: 30, timezone: 'Asia/Kolkata', recurrence: { freq: 'WEEKLY', byDay: [WEEKDAY(start)], count: 4 },
    });
    expect(clsRes.status).toBe(201);
    const cls = clsRes.body.data;
    expect(cls.sessions).toHaveLength(4);
    expect(Math.abs(new Date(cls.sessions[1].startsAt).getTime() - new Date(cls.sessions[0].startsAt).getTime() - 7 * 86_400_000)).toBeLessThan(60_000);
    const [s1, s2] = cls.sessions;

    // Only enrolled students may join; joining opens 15 minutes before.
    const st = await student(c.tenant.slug);
    await authed(app, st.s).post(`/api/v1/learn/live/sessions/${s1.id}/join`).expect(403);
    await authed(app, st.s).post(`/api/v1/learn/courses/${course.id}/enroll`).expect(201);
    expect((await authed(app, st.s).get('/api/v1/learn/live/upcoming')).body.data.map((u: any) => u.id)).toContain(s1.id);
    await authed(app, st.s).post(`/api/v1/learn/live/sessions/${s2.id}/join`).expect(409);

    // Waiting room: first join gets a token without publish/subscribe rights.
    const j1 = (await authed(app, st.s).post(`/api/v1/learn/live/sessions/${s1.id}/join`).expect(200)).body.data;
    expect(j1).toMatchObject({ provider: 'LIVEKIT', url: LK.url, waiting: true, identity: `usr_${st.id}` });
    const c1 = claims(j1.token);
    expect(c1.iss).toBe(LK.key);
    expect(c1.video).toMatchObject({ roomJoin: true, canPublish: false, canSubscribe: false });
    const room = c1.video.room;
    expect(calls).toContain(`create:${room}`);
    expect((await authed(app, st.s).get(`/api/v1/learn/live/sessions/${s1.id}/admission`)).body.data.status).toBe('WAITING');

    // Host starts the session and admits the student.
    const h = (await authed(app, cs).post(`/api/v1/creator/live/sessions/${s1.id}/host`).expect(200)).body.data;
    expect(claims(h.token).video).toMatchObject({ room, roomAdmin: true, canPublish: true });
    const adm = (await authed(app, cs).get(`/api/v1/creator/live/sessions/${s1.id}/admissions`)).body.data;
    expect(adm).toEqual([expect.objectContaining({ identity: `usr_${st.id}`, name: 'Riya Student', status: 'WAITING' })]);
    await authed(app, cs).post(`/api/v1/creator/live/sessions/${s1.id}/admissions/${adm[0].id}`).send({ admit: true }).expect(200);
    expect(calls).toContain(`perm:usr_${st.id}:true`);
    expect((await authed(app, st.s).get(`/api/v1/learn/live/sessions/${s1.id}/admission`)).body.data.status).toBe('ADMITTED');
    const j2 = (await authed(app, st.s).post(`/api/v1/learn/live/sessions/${s1.id}/join`).expect(200)).body.data;
    expect(j2.waiting).toBe(false);
    expect(claims(j2.token).video).toMatchObject({ canPublish: true, canSubscribe: true, canPublishData: true });

    // Attendance from signed LiveKit webhooks; forged and duplicate events are rejected/ignored.
    const forged = await api(app).post('/api/v1/webhooks/livekit').set('Content-Type', 'application/webhook+json').set('Authorization', 'not-a-jwt').send(JSON.stringify({ event: 'room_started', room: { name: room } }));
    expect(forged.status).toBe(401);
    expect((await webhook({ id: 'EV_1', event: 'participant_joined', room: { name: room }, participant: { identity: `usr_${st.id}` } })).status).toBe(200);
    expect((await webhook({ id: 'EV_1', event: 'participant_joined', room: { name: room }, participant: { identity: `usr_${st.id}` } })).body.data.duplicate).toBe(true);
    await webhook({ id: 'EV_2', event: 'participant_joined', room: { name: room }, participant: { identity: h.identity } });
    await webhook({ id: 'EV_3', event: 'participant_left', room: { name: room }, participant: { identity: `usr_${st.id}` } });
    const rows = await prisma.liveAttendance.findMany({ where: { sessionId: s1.id } });
    expect(rows.map((r) => [r.displayName, r.role, Boolean(r.leftAt)]).sort()).toEqual([['Asha Creator', 'host', false], ['Riya Student', 'attendee', true]]);

    // Polls and Q&A.
    const polls = (await authed(app, cs).post(`/api/v1/creator/live/sessions/${s1.id}/polls`).send({ question: 'Ready for loops?', options: ['Yes', 'Not yet'] }).expect(201)).body.data;
    await authed(app, st.s).post(`/api/v1/learn/live/sessions/${s1.id}/polls`).send({ question: 'x', options: ['a', 'b'] }).expect(404); // students cannot create
    const voted = (await authed(app, st.s).post(`/api/v1/learn/live/sessions/${s1.id}/polls/${polls[0].id}/vote`).send({ optionIndex: 0 }).expect(200)).body.data;
    expect(voted[0]).toMatchObject({ counts: [1, 0], total: 1, myVote: 0 });
    await authed(app, cs).post(`/api/v1/creator/live/sessions/${s1.id}/polls/${polls[0].id}/close`).expect(200);
    await authed(app, st.s).post(`/api/v1/learn/live/sessions/${s1.id}/polls/${polls[0].id}/vote`).send({ optionIndex: 1 }).expect(409);
    const qs = (await authed(app, st.s).post(`/api/v1/learn/live/sessions/${s1.id}/questions`).send({ text: 'Will this be recorded?' }).expect(201)).body.data;
    const up = (await authed(app, st.s).post(`/api/v1/learn/live/sessions/${s1.id}/questions/${qs[0].id}/upvote`).expect(200)).body.data;
    expect(up[0]).toMatchObject({ upvotes: 1, upvotedByMe: true, mine: true, answered: false });
    const answered = (await authed(app, cs).post(`/api/v1/creator/live/sessions/${s1.id}/questions/${qs[0].id}/answer`).expect(200)).body.data;
    expect(answered[0].answered).toBe(true);

    // End: room deleted, open attendance closed, joining refused, report available.
    await authed(app, cs).post(`/api/v1/creator/live/sessions/${s1.id}/end`).expect(200);
    expect(calls).toContain(`delete:${room}`);
    await authed(app, st.s).post(`/api/v1/learn/live/sessions/${s1.id}/join`).expect(409);
    const report = (await authed(app, cs).get(`/api/v1/creator/live/sessions/${s1.id}/attendance`).expect(200)).body.data;
    expect(report.people.map((p: any) => p.name).sort()).toEqual(['Asha Creator', 'Riya Student']);
    expect(report.people.every((p: any) => typeof p.percent === 'number')).toBe(true);
    const csv = await authed(app, cs).get(`/api/v1/creator/live/sessions/${s1.id}/attendance.csv`).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Riya Student');

    // Another academy cannot see this class.
    const other = await academy();
    await authed(app, other.session).get(`/api/v1/creator/live/classes/${cls.id}`).expect(404);
    await authed(app, other.session).post(`/api/v1/creator/live/sessions/${s2.id}/host`).expect(404);
  });

  it('meeting-link class for a batch, reminders, webinars with tickets, plan gate', async () => {
    const c = await academy();
    const cs = c.session;
    const course = await freeCourse(cs);
    const member = await student(c.tenant.slug, 'Batch Member');
    const outsider = await student(c.tenant.slug, 'Not In Batch');

    // Batches: add by email (unknown emails reported), batch course enrols members.
    const batch = (await authed(app, cs).post('/api/v1/creator/batches').send({ name: 'November cohort', courseId: course.id }).expect(201)).body.data;
    const added = (await authed(app, cs).post(`/api/v1/creator/batches/${batch.id}/members`).send({ emails: [member.email, 'nobody@example.test'] }).expect(200)).body.data;
    expect(added).toMatchObject({ added: 1, notFound: ['nobody@example.test'] });
    expect(await prisma.enrollment.findFirst({ where: { userId: member.id, courseId: course.id } })).toMatchObject({ source: 'BATCH', status: 'ACTIVE' });

    // Meeting-link class: link validation, batch-only access, click attendance.
    const start = new Date(Date.now() + 5 * 60_000);
    await authed(app, cs).post('/api/v1/creator/live/classes').send({ title: 'Office hours', provider: 'EXTERNAL', externalUrl: 'zoom.us/j/123', startsAt: start.toISOString(), durationMinutes: 30, audience: 'BATCH', batchId: batch.id }).expect(422);
    const ext = (await authed(app, cs).post('/api/v1/creator/live/classes').send({ title: 'Office hours', provider: 'EXTERNAL', externalUrl: 'https://zoom.us/j/1234567890', startsAt: start.toISOString(), durationMinutes: 30, audience: 'BATCH', batchId: batch.id }).expect(201)).body.data;
    const es = ext.sessions[0].id;
    await authed(app, outsider.s).post(`/api/v1/learn/live/sessions/${es}/join`).expect(403);
    expect((await authed(app, member.s).post(`/api/v1/learn/live/sessions/${es}/join`).expect(200)).body.data).toEqual({ provider: 'EXTERNAL', joinUrl: 'https://zoom.us/j/1234567890' });
    const att = (await authed(app, cs).get(`/api/v1/creator/live/sessions/${es}/attendance`)).body.data;
    expect(att.people).toEqual([expect.objectContaining({ name: 'Batch Member', source: 'click', seconds: null })]);

    // Reminders 1 hour ahead go to the audience once.
    const soon = (await authed(app, cs).post('/api/v1/creator/live/classes').send({ title: 'Doubt clearing', provider: 'LIVEKIT', startsAt: new Date(Date.now() + 60 * 60_000).toISOString(), durationMinutes: 45, audience: 'BATCH', batchId: batch.id }).expect(201)).body.data;
    const jobs = app.get(LiveJobs);
    const at = new Date(new Date(soon.sessions[0].startsAt).getTime() - 60 * 60_000 + 30_000);
    expect(await jobs.sendReminders(at)).toBe(1);
    expect(await jobs.sendReminders(at)).toBe(0);
    expect((await lastEmail(app, member.email))!).toMatchObject({ tag: 'notify-live', subject: 'Starting in 1 hour: Doubt clearing' });
    expect((await authed(app, member.s).get('/api/v1/notifications')).body.data.items[0]).toMatchObject({ category: 'live', title: 'Starting in 1 hour: Doubt clearing', link: '/learn/live' });
    expect((await lastEmail(app, outsider.email))?.tag).not.toMatch(/^(live-reminder|notify-live)/);

    // Webinar: public page, registration emails a personal link, ticket joins without an account.
    const web = (await authed(app, cs).post('/api/v1/creator/live/classes').send({ kind: 'WEBINAR', title: 'Free Python Masterclass', provider: 'LIVEKIT', startsAt: new Date(Date.now() + 10 * 60_000).toISOString(), durationMinutes: 60, capacity: 100 }).expect(201)).body.data;
    expect(web).toMatchObject({ kind: 'WEBINAR', audience: 'REGISTRANTS', slug: 'free-python-masterclass' });
    const host = tenantHost(c.tenant.slug);
    const pub = (await api(app).get('/api/v1/public/webinars/free-python-masterclass').set('Host', host).expect(200)).body.data;
    expect(pub).toMatchObject({ title: 'Free Python Masterclass', open: true, seatsLeft: 100 });
    await api(app).post('/api/v1/public/webinars/free-python-masterclass/register').set('Host', host).send({ name: 'Guest Person', email: 'Guest@Example.test', consent: true }).expect(200);
    await api(app).post('/api/v1/public/webinars/free-python-masterclass/register').set('Host', host).send({ name: 'Guest Person', email: 'guest@example.test' }).expect(200);
    expect(await prisma.webinarRegistration.count({ where: { liveClassId: web.id } })).toBe(1);
    const mail = (await lastEmail(app, 'guest@example.test'))!;
    expect(mail).toMatchObject({ tag: 'webinar-registration', subject: "You're registered: Free Python Masterclass" });
    const code = /\/live\/ticket\/([\w-]+)/.exec(mail.text)![1];
    const ticket = (await api(app).get(`/api/v1/public/live/tickets/${code}`).set('Host', host).expect(200)).body.data;
    expect(ticket).toMatchObject({ name: 'Guest Person', webinar: { title: 'Free Python Masterclass' } });
    const tj = (await api(app).post(`/api/v1/public/live/tickets/${code}/join`).set('Host', host).send({ sessionId: ticket.sessions[0].id }).expect(200)).body.data;
    expect(claims(tj.token).video).toMatchObject({ canPublish: false, canSubscribe: true, canPublishData: true });
    expect(tj.identity).toMatch(/^reg_/);
    await api(app).post('/api/v1/public/live/tickets/forgedcode/join').set('Host', host).send({ sessionId: ticket.sessions[0].id }).expect(404);
    await api(app).post(`/api/v1/public/live/tickets/${code}/sessions/${ticket.sessions[0].id}/questions`).set('Host', host).send({ text: 'Is there a certificate?' }).expect(201);
    // Students who did not register cannot join the webinar.
    await authed(app, member.s).post(`/api/v1/learn/live/sessions/${ticket.sessions[0].id}/join`).expect(403);

    // Plans without live classes cannot use them.
    await prisma.tenantLimitOverride.create({ data: { tenantId: c.tenant.id, featureKey: 'live_classes', enabled: false, reason: 'test' } });
    await app.get(EntitlementsService).invalidate(c.tenant.id);
    expect((await authed(app, cs).get('/api/v1/creator/live/classes').expect(403)).body.error.code).toBe('FEATURE_NOT_IN_PLAN');
  });
});
