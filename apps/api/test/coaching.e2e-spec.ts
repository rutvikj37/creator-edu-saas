import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { EntitlementsService } from '../src/modules/subscriptions/entitlements.service.js';
import { api, authed, createTestApp, lastEmail, parseSession, PLATFORM, registerCreator, resetDatabase, type Session, tenantHost, tokenFromEmail, uniqueEmail } from './helpers.js';
import { RazorpaySim } from './razorpay-sim.js';

const KEY_ID = 'rzp_test_Coaching9911';
const KEY_SECRET = 'sim_coaching_key_secret';
const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 12 * 60 }));

describe('1:1 coaching (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let sim: RazorpaySim;
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    sim = new RazorpaySim().install(app);
    sim.keys.set(KEY_ID, KEY_SECRET);
  });
  afterAll(async () => app?.close());

  async function academy() {
    const c = await registerCreator(app);
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    await prisma.tenantLimitOverride.create({ data: { tenantId: c.tenant.id, featureKey: 'staff.max', enabled: true, limitValue: 10n } });
    await app.get(EntitlementsService).invalidate(c.tenant.id);
    await authed(app, c.session).put('/api/v1/creator/payments/razorpay').send({ keyId: KEY_ID, keySecret: KEY_SECRET }).expect(200);
    return c;
  }
  async function teammate(inviter: Session, name: string) {
    const email = uniqueEmail('coach');
    await authed(app, inviter).post('/api/v1/creator/staff/invitations').send({ email, roleKey: 'SUPPORT_AGENT' }).expect(201);
    const token = tokenFromEmail((await lastEmail(app, email))!.text);
    const reg = await api(app).post('/api/v1/invitations/register').set('Host', PLATFORM).send({ token, fullName: name, password: 'coach-password-123' }).expect(201);
    const s = parseSession(reg, PLATFORM);
    return { s, id: (await authed(app, s).get('/api/v1/auth/me')).body.data.user.id as string, email };
  }
  async function student(slug: string, name: string) {
    const host = tenantHost(slug);
    const email = uniqueEmail('learner');
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: name, email, password: 'student-password-1' }).expect(201);
    return { s: parseSession(reg, host), email };
  }
  async function buy(s: Session, programId: string, name: string) {
    const order = (await authed(app, s).post('/api/v1/learn/checkout').send({ coachingProgramId: programId, billing: { name } }).expect(201)).body.data;
    const p = (await authed(app, s).post(`/api/v1/learn/orders/${order.id}/pay`).expect(200)).body.data;
    await authed(app, s).post(`/api/v1/learn/orders/${order.id}/confirm`).send(sim.pay(p.checkout.orderId)).expect(200);
    return order;
  }

  it('creator builds a program with weighted coaches; buyers pay, book free slots, get coaches by weight; clashes, cancels, refunds and isolation are handled', async () => {
    const c = await academy();
    const cs = c.session;
    const ownerId = (await authed(app, cs).get('/api/v1/auth/me')).body.data.user.id as string;
    const coach2 = await teammate(cs, 'Second Coach');

    // Coaches set their hours (UTC, 09:00–12:00 every day, no notice) and a meeting room.
    await authed(app, cs).put('/api/v1/creator/coaching/availability/me').send({ timezone: 'Mars/Base' }).expect(422);
    await authed(app, cs).put('/api/v1/creator/coaching/availability/me').send({ hours: [{ weekday: 1, startMinute: 600, endMinute: 540 }] }).expect(422);
    await authed(app, cs).put('/api/v1/creator/coaching/availability/me').send({ hours: [{ weekday: 1, startMinute: 540, endMinute: 700 }, { weekday: 1, startMinute: 650, endMinute: 800 }] }).expect(422);
    await authed(app, cs).put('/api/v1/creator/coaching/availability/me').send({ meetingUrl: 'javascript:alert(1)' }).expect(422);
    const mine = (await authed(app, cs).put('/api/v1/creator/coaching/availability/me').send({ timezone: 'UTC', hours: ALL_WEEK, minNoticeHours: 0, meetingUrl: 'https://meet.example.com/owner-room' }).expect(200)).body.data;
    expect(mine).toMatchObject({ timezone: 'UTC', minNoticeHours: 0, configured: true });
    expect(mine.hours).toHaveLength(7);
    // A team member without program permissions can still set their own hours; the owner can set them on their behalf too.
    await authed(app, coach2.s).put('/api/v1/creator/coaching/availability/me').send({ timezone: 'UTC', hours: ALL_WEEK, minNoticeHours: 0 }).expect(200);
    await authed(app, cs).put(`/api/v1/creator/coaching/availability/${coach2.id}`).send({ meetingUrl: 'https://meet.example.com/coach-two' }).expect(200);
    expect((await authed(app, cs).get('/api/v1/creator/coaching/team')).body.data.map((m: any) => m.userId)).toEqual(expect.arrayContaining([ownerId, coach2.id]));

    // Program validation, then a valid program with two sessions and two weighted coaches.
    await authed(app, cs).post('/api/v1/creator/coaching/programs').send({ title: 'x', coaches: [{ userId: ownerId, weight: 0 }] }).expect(422);
    await authed(app, cs).post('/api/v1/creator/coaching/programs').send({ title: 'x', coaches: [{ userId: 'c'.repeat(25), weight: 1 }] }).expect(422);
    await authed(app, cs).post('/api/v1/creator/coaching/programs').send({ title: 'x', priceAmount: 500, compareAtAmount: 400 }).expect(422);
    const draft = (await authed(app, cs).post('/api/v1/creator/coaching/programs').send({ title: 'Career Mentorship', description: doc('Two calls to plan your next role.'), faqs: [{ question: 'Is it online?', answer: 'Yes, on a video call.' }] }).expect(201)).body.data;
    expect(draft).toMatchObject({ status: 'DRAFT', slug: 'career-mentorship', isFree: true, coaches: [{ userId: ownerId, weight: 1 }], sessions: [] });
    await authed(app, cs).post(`/api/v1/creator/coaching/programs/${draft.id}/status`).send({ status: 'PUBLISHED' }).expect(422); // no sessions yet
    const program = (await authed(app, cs).patch(`/api/v1/creator/coaching/programs/${draft.id}`).send({
      planName: 'Mentorship pack', priceAmount: 999, compareAtAmount: 1499,
      coaches: [{ userId: ownerId, weight: 1 }, { userId: coach2.id, weight: 2 }],
      sessions: [{ title: 'Kick-off', durationMin: 30, agenda: doc('Goals'), notes: 'Bring your CV' }, { title: 'Review', durationMin: 60, agenda: doc('Progress') }],
    }).expect(200)).body.data;
    expect(program.sessions.map((s: any) => [s.title, s.durationMin])).toEqual([['Kick-off', 30], ['Review', 60]]);
    await authed(app, cs).post(`/api/v1/creator/coaching/programs/${program.id}/status`).send({ status: 'PUBLISHED' }).expect(200);
    const [kickoff, review] = program.sessions;

    // Public page: sessions and coach names, never emails or meeting links.
    const host = tenantHost(c.tenant.slug);
    const pub = (await api(app).get('/api/v1/public/coaching/career-mentorship').set('Host', host).expect(200)).body.data;
    expect(pub).toMatchObject({ title: 'Career Mentorship', planName: 'Mentorship pack', faqs: [{ question: 'Is it online?' }] });
    expect(pub.coaches.map((x: any) => x.name).sort()).toEqual(['Asha Creator', 'Second Coach']);
    expect([Number(pub.priceAmount), Number(pub.compareAtAmount)]).toEqual([999, 1499]);
    expect(JSON.stringify(pub)).not.toMatch(/@|meet\.example/);

    // A student needs access before booking; then buys through checkout.
    const a = await student(c.tenant.slug, 'Asha Learner');
    await authed(app, a.s).get(`/api/v1/learn/coaching/${program.id}/sessions/${kickoff.id}/slots`).expect(403);
    await authed(app, a.s).post(`/api/v1/learn/coaching/${program.id}/claim`).expect(409); // paid
    const order = await buy(a.s, program.id, 'Asha Learner');
    await authed(app, a.s).post('/api/v1/learn/checkout').send({ coachingProgramId: program.id, billing: { name: 'Asha Learner' } }).expect(409); // owned
    expect((await authed(app, a.s).get('/api/v1/learn/coaching')).body.data).toEqual([expect.objectContaining({ id: program.id, sessions: [expect.objectContaining({ title: 'Kick-off', booking: null }), expect.objectContaining({ title: 'Review', booking: null })] })]);

    // Slots fall inside the coaches' hours (UTC 09:00–12:00) and leave room for the session.
    const slots = (await authed(app, a.s).get(`/api/v1/learn/coaching/${program.id}/sessions/${review.id}/slots`).expect(200)).body.data;
    expect(slots.durationMin).toBe(60);
    expect(slots.slots.length).toBeGreaterThan(20);
    for (const t of slots.slots.slice(0, 50)) {
      const d = new Date(t);
      const m = d.getUTCHours() * 60 + d.getUTCMinutes();
      expect(m >= 540 && m + 60 <= 720).toBe(true);
      expect(d.getTime()).toBeGreaterThan(Date.now());
    }
    await authed(app, a.s).post(`/api/v1/learn/coaching/${program.id}/bookings`).send({ sessionId: review.id, startsAt: '2020-01-01T09:00:00.000Z' }).expect(409);
    const at = slots.slots[0];

    // First booking: both coaches free, both at zero bookings → the weighted round-robin picks one.
    const b1 = (await authed(app, a.s).post(`/api/v1/learn/coaching/${program.id}/bookings`).send({ sessionId: review.id, startsAt: at }).expect(201)).body.data;
    expect(b1).toMatchObject({ status: 'BOOKED', sessionTitle: 'Review', startsAt: at });
    expect([ownerId, coach2.id]).toContain(b1.coachId);
    expect(b1.meetingUrl).toMatch(/^https:\/\/meet\.example\.com\//);
    await authed(app, a.s).post(`/api/v1/learn/coaching/${program.id}/bookings`).send({ sessionId: review.id, startsAt: slots.slots[8] }).expect(409); // already booked
    expect((await lastEmail(app, a.email))!.subject).toMatch(/^Booked: Review · Career Mentorship/);

    // Same time, another buyer: only the other coach is free, so they get that coach.
    const bStudent = await student(c.tenant.slug, 'Bala Learner');
    await buy(bStudent.s, program.id, 'Bala Learner');
    const b2 = (await authed(app, bStudent.s).post(`/api/v1/learn/coaching/${program.id}/bookings`).send({ sessionId: review.id, startsAt: at }).expect(201)).body.data;
    expect(b2.coachId).not.toBe(b1.coachId);
    // Both coaches are now busy at that time: the slot disappears and booking it is refused.
    const cStudent = await student(c.tenant.slug, 'Chitra Learner');
    await buy(cStudent.s, program.id, 'Chitra Learner');
    const cSlots = (await authed(app, cStudent.s).get(`/api/v1/learn/coaching/${program.id}/sessions/${kickoff.id}/slots`)).body.data.slots;
    expect(cSlots).not.toContain(at);
    await authed(app, cStudent.s).post(`/api/v1/learn/coaching/${program.id}/bookings`).send({ sessionId: kickoff.id, startsAt: at }).expect(409);

    // Weights: with three more bookings at a time both are free, the weight-2 coach takes the larger share.
    const free = cSlots.filter((t: string) => Math.abs(new Date(t).getTime() - new Date(at).getTime()) >= 2 * 3_600_000);
    const later: string[] = [];
    for (const [i, name] of ['D', 'E', 'F'].entries()) {
      const st = await student(c.tenant.slug, `${name} Learner`);
      await buy(st.s, program.id, `${name} Learner`);
      later.push((await authed(app, st.s).post(`/api/v1/learn/coaching/${program.id}/bookings`).send({ sessionId: kickoff.id, startsAt: free[i * 20] }).expect(201)).body.data.coachId);
    }
    const all = [b1.coachId, b2.coachId, ...later];
    expect(all.filter((x) => x === coach2.id).length).toBe(3); // 5 bookings split 2:1 by weight → 3 for weight 2
    expect(all.filter((x) => x === ownerId).length).toBe(2);

    // Student cancel frees the slot; the academy sees bookings, stats and a calendar range.
    await authed(app, a.s).post(`/api/v1/learn/coaching/bookings/${b1.id}/cancel`).expect(200);
    await authed(app, a.s).post(`/api/v1/learn/coaching/bookings/${b1.id}/cancel`).expect(409);
    expect((await authed(app, cStudent.s).get(`/api/v1/learn/coaching/${program.id}/sessions/${kickoff.id}/slots`)).body.data.slots).toContain(at);
    const list = (await authed(app, cs).get('/api/v1/creator/coaching/bookings?when=upcoming').expect(200)).body.data;
    expect(list.meta.total).toBe(5);
    expect(list.items[0]).toMatchObject({ program: { title: 'Career Mentorship' }, student: { name: expect.any(String) }, coach: { name: expect.any(String) } });
    expect((await authed(app, cs).get('/api/v1/creator/coaching/bookings?status=CANCELLED')).body.data.items[0]).toMatchObject({ id: b1.id, cancelledBy: 'STUDENT' });
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 40 * 86_400_000).toISOString();
    expect((await authed(app, cs).get(`/api/v1/creator/coaching/bookings?from=${from}&to=${to}`)).body.data.items).toHaveLength(5);
    const stats = (await authed(app, cs).get('/api/v1/creator/coaching/stats').expect(200)).body.data;
    expect(stats).toMatchObject({ totalBookings: 4, upcomingBookings: 4, currency: 'INR' });
    expect(Number(stats.totalRevenue)).toBe(999 * 6);
    await authed(app, cs).post(`/api/v1/creator/coaching/bookings/${b2.id}/status`).send({ status: 'COMPLETED' }).expect(409); // not started yet

    // Removing a session with upcoming bookings is refused.
    await authed(app, cs).patch(`/api/v1/creator/coaching/programs/${program.id}`).send({ sessions: [{ id: review.id, title: 'Review', durationMin: 60, agenda: doc('Progress') }] }).expect(409);

    // Full refund with revoke: access ends and the buyer's future bookings are cancelled.
    const bOrder = await prisma.order.findFirstOrThrow({ where: { tenantId: c.tenant.id, items: { some: { coachingProgramId: program.id } }, billing: { path: '$.name', equals: 'Bala Learner' } } });
    await authed(app, cs).post(`/api/v1/creator/orders/${bOrder.id}/refunds`).send({ revokeAccess: true }).expect(201);
    expect((await authed(app, bStudent.s).get('/api/v1/learn/coaching')).body.data).toEqual([]);
    expect((await prisma.coachingBooking.findUniqueOrThrow({ where: { id: b2.id } })).status).toBe('CANCELLED');
    expect(order.id).toBeTruthy();

    // Free programs are claimed without checkout.
    const freebie = (await authed(app, cs).post('/api/v1/creator/coaching/programs').send({ title: 'Intro call', sessions: [{ title: 'Hello', durationMin: 15, agenda: doc('Meet') }] }).expect(201)).body.data;
    await authed(app, cs).post(`/api/v1/creator/coaching/programs/${freebie.id}/status`).send({ status: 'PUBLISHED' }).expect(200);
    await authed(app, cStudent.s).post('/api/v1/learn/checkout').send({ coachingProgramId: freebie.id, billing: { name: 'Chitra Learner' } }).expect(409);
    await authed(app, cStudent.s).post(`/api/v1/learn/coaching/${freebie.id}/claim`).expect(200);
    expect((await authed(app, cStudent.s).get('/api/v1/learn/coaching')).body.data.map((p: any) => p.id)).toContain(freebie.id);

    // Isolation: another academy and students can't reach any of this.
    const other = await academy();
    await authed(app, other.session).get(`/api/v1/creator/coaching/programs/${program.id}`).expect(404);
    await authed(app, other.session).patch(`/api/v1/creator/coaching/programs/${program.id}`).send({ title: 'Hijack' }).expect(404);
    expect((await authed(app, other.session).get('/api/v1/creator/coaching/bookings')).body.data.meta.total).toBe(0);
    await authed(app, other.session).put(`/api/v1/creator/coaching/availability/${coach2.id}`).send({ minNoticeHours: 1 }).expect(404);
    await api(app).get('/api/v1/public/coaching/career-mentorship').set('Host', tenantHost(other.tenant.slug)).expect(404);
    await authed(app, a.s).get('/api/v1/creator/coaching/programs').expect((r) => expect([401, 403, 404]).toContain(r.status));
    await authed(app, coach2.s).post('/api/v1/creator/coaching/programs').send({ title: 'Mine' }).expect(403); // support agents can't manage programs
  });
});
