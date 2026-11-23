import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { api, authed, createTestApp, parseSession, PNG, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail, uploadFile } from './helpers.js';
import { GoogleCalendarSim } from './meeting-sims.js';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const FREEBUSY = 'https://www.googleapis.com/auth/calendar.freebusy';

describe('Coaching settings: coach profile and Google Calendar (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let google: GoogleCalendarSim;

  beforeAll(async () => {
    google = await new GoogleCalendarSim('coach-client.apps.googleusercontent.com', 'coach-client-secret').start();
    Object.assign(process.env, { GOOGLE_MEET_CLIENT_ID: google.clientId, GOOGLE_MEET_CLIENT_SECRET: google.clientSecret, GOOGLE_API_ROOT_URL: google.url });
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(async () => {
    for (const k of ['GOOGLE_MEET_CLIENT_ID', 'GOOGLE_MEET_CLIENT_SECRET', 'GOOGLE_API_ROOT_URL']) delete process.env[k];
    await app?.close();
    await google?.stop();
  });

  async function connect(cs: Session) {
    const { url } = (await authed(app, cs).post('/api/v1/creator/coaching/availability/me/google/connect').expect(200)).body.data;
    const u = new URL(url);
    expect(u.searchParams.get('scope')).toContain(FREEBUSY);
    expect(u.searchParams.get('access_type')).toBe('offline');
    return api(app).get(`/api/v1/integrations/google-meet/callback?code=${google.issueCode()}&state=${u.searchParams.get('state')}`).expect(302);
  }

  it('coach edits their profile, connects Google Calendar; busy times hide slots; bookings get Meet events that cancelling removes; disconnect revokes', async () => {
    const c = await registerCreator(app);
    const cs = c.session;
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));

    // Profile: name shown to learners, about text (400 max), photo.
    const photo = (await uploadFile(app, cs, 'IMAGE', 'me.png', 'image/png', PNG)).body.data;
    await authed(app, cs).put('/api/v1/creator/coaching/availability/me').send({ bio: 'x'.repeat(401) }).expect(422);
    const prof = (await authed(app, cs).put('/api/v1/creator/coaching/availability/me').send({ displayName: 'Coach Asha', bio: 'Ten years in hiring.', photoFileId: photo.id, timezone: 'UTC', minNoticeHours: 0, hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 540, endMinute: 720 })) }).expect(200)).body.data;
    expect(prof).toMatchObject({ displayName: 'Coach Asha', bio: 'Ten years in hiring.', photoUrl: expect.any(String), google: { configured: true, connected: false } });

    // Google refused the free/busy permission → not connected, with a clear message.
    const denied = await connect(cs);
    expect(decodeURIComponent(denied.headers.location)).toMatch(/\/creator\/coaching\?settings=1&error=Allow access to your calendar/);
    // Granted → connected with the Google account email.
    google.scope = `${google.scope} ${FREEBUSY}`;
    const ok = await connect(cs);
    expect(ok.headers.location).toMatch(/\/creator\/coaching\?settings=1&connected=google$/);
    expect((await authed(app, cs).get('/api/v1/creator/coaching/availability/me')).body.data.google).toMatchObject({ connected: true, email: 'teacher@gmail.example', error: null });
    const stored = await prisma.coachProfile.findFirstOrThrow({ where: { tenantId: c.tenant.id } });
    expect(stored.googleRefreshTokenEnc).not.toMatch(/^gr_/); // encrypted at rest

    // A free program and a learner.
    const pr = (await authed(app, cs).post('/api/v1/creator/coaching/programs').send({ title: 'Interview prep', sessions: [{ title: 'Mock interview', durationMin: 60, agenda: doc('Practice') }] }).expect(201)).body.data;
    await authed(app, cs).post(`/api/v1/creator/coaching/programs/${pr.id}/status`).send({ status: 'PUBLISHED' }).expect(200);
    const host = tenantHost(c.tenant.slug);
    const pub = (await api(app).get('/api/v1/public/coaching/interview-prep').set('Host', host).expect(200)).body.data;
    expect(pub.coaches).toEqual([{ name: 'Coach Asha', bio: 'Ten years in hiring.', photoUrl: expect.any(String) }]);
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: 'Ravi Learner', email: uniqueEmail('gc'), password: 'student-password-1' }).expect(201);
    const s = parseSession(reg, host);
    await authed(app, s).post(`/api/v1/learn/coaching/${pr.id}/claim`).expect(200);

    // The coach is busy in Google on tomorrow 09:00–10:30 UTC: no slot overlaps it.
    const t = new Date(Date.now() + 86_400_000);
    const day = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
    google.busy = [{ start: `${day}T09:00:00Z`, end: `${day}T10:30:00Z` }];
    const slots: string[] = (await authed(app, s).get(`/api/v1/learn/coaching/${pr.id}/sessions/${pr.sessions[0].id}/slots`).expect(200)).body.data.slots;
    const tomorrow = slots.filter((x) => x.startsWith(day));
    expect(tomorrow[0]).toBe(`${day}T10:30:00.000Z`);
    expect(tomorrow).not.toContain(`${day}T09:00:00.000Z`);
    expect(tomorrow.at(-1)).toBe(`${day}T11:00:00.000Z`);
    expect(google.calls.some((x) => x.startsWith('POST /calendar/v3/freeBusy'))).toBe(true);

    // Booking creates a Google event with a Meet link, used as the join link.
    const b = (await authed(app, s).post(`/api/v1/learn/coaching/${pr.id}/bookings`).send({ sessionId: pr.sessions[0].id, startsAt: tomorrow[0] }).expect(201)).body.data;
    expect(b.meetingUrl).toMatch(/^https:\/\/meet\.google\.com\//);
    const ev = [...google.events.values()].find((e) => e.hangoutLink === b.meetingUrl);
    expect(ev).toMatchObject({ summary: 'Mock interview · Interview prep', start: { dateTime: tomorrow[0] }, sendUpdates: 'none' });
    expect((await prisma.coachingBooking.findUniqueOrThrow({ where: { id: b.id } })).googleEventId).toBe(ev.id);

    // Cancelling removes the event.
    await authed(app, s).post(`/api/v1/learn/coaching/bookings/${b.id}/cancel`).expect(200);
    expect(google.events.has(ev.id)).toBe(false);

    // Disconnect revokes the token; slots no longer consult Google.
    const after = (await authed(app, cs).post('/api/v1/creator/coaching/availability/me/google/disconnect').expect(200)).body.data;
    expect(after.google).toMatchObject({ connected: false, email: null });
    expect(google.calls.some((x) => x.startsWith('POST /revoke'))).toBe(true);
    google.busy = [];
    const calls = google.calls.length;
    await authed(app, s).get(`/api/v1/learn/coaching/${pr.id}/sessions/${pr.sessions[0].id}/slots`).expect(200);
    expect(google.calls.length).toBe(calls);
  });
});
