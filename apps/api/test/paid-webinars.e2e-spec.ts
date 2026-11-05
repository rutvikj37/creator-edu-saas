import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { api, authed, createTestApp, lastEmail, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';
import { RazorpaySim } from './razorpay-sim.js';

const KEY_ID = 'rzp_test_PaidWebinar99';
const KEY_SECRET = 'sim_webinar_key_secret';

describe('Paid webinars (e2e)', () => {
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

  async function student(slug: string, name: string) {
    const host = tenantHost(slug);
    const email = uniqueEmail('web');
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: name, email, password: 'student-password-1' }).expect(201);
    return { s: parseSession(reg, host), email };
  }
  async function pay(s: Session, orderId: string) {
    const p = (await authed(app, s).post(`/api/v1/learn/orders/${orderId}/pay`).expect(200)).body.data;
    return (await authed(app, s).post(`/api/v1/learn/orders/${orderId}/confirm`).send(sim.pay(p.checkout.orderId)).expect(200)).body.data;
  }

  it('ticket sale: price only for webinars, checkout → ticket email → join; no double purchase; seats; refund cancels the ticket', async () => {
    const c = await registerCreator(app);
    const cs = c.session;
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    await authed(app, cs).put('/api/v1/creator/payments/razorpay').send({ keyId: KEY_ID, keySecret: KEY_SECRET }).expect(200);
    const host = tenantHost(c.tenant.slug);
    const start = new Date(Date.now() + 10 * 60_000).toISOString();

    // Classes are not sold as tickets.
    const bad = await authed(app, cs).post('/api/v1/creator/live/classes').send({ title: 'Paid class', provider: 'EXTERNAL', externalUrl: 'https://meet.example.test/abc', startsAt: start, durationMinutes: 60, audience: 'ALL_STUDENTS', priceAmount: 99 }).expect(422);
    expect(bad.body.error.details[0].field).toBe('priceAmount');
    const web = (await authed(app, cs).post('/api/v1/creator/live/classes').send({ kind: 'WEBINAR', title: 'Tax Saving Masterclass', provider: 'EXTERNAL', externalUrl: 'https://meet.example.test/tax', startsAt: start, durationMinutes: 60, capacity: 2, priceAmount: 299 }).expect(201)).body.data;
    expect(web).toMatchObject({ priceAmount: '299', currency: 'INR', slug: 'tax-saving-masterclass' });

    const page = (await api(app).get('/api/v1/public/webinars/tax-saving-masterclass').set('Host', host).expect(200)).body.data;
    expect(page).toMatchObject({ id: web.id, priceAmount: '299', currency: 'INR', seatsLeft: 2, open: true });
    const free = await api(app).post('/api/v1/public/webinars/tax-saving-masterclass/register').set('Host', host).send({ name: 'Free Rider', email: 'free@example.test', consent: false }).expect(409);
    expect(free.body.error.message).toBe('This webinar needs a ticket. Buy one to register.');

    // Buyer pays through Razorpay (coupon applies); the ticket is issued and emailed.
    await authed(app, cs).post('/api/v1/creator/coupons').send({ code: 'EARLY50', type: 'FIXED', value: 50 }).expect(201);
    const a = await student(c.tenant.slug, 'Anita Buyer');
    const q = (await authed(app, a.s).post('/api/v1/learn/checkout/quote').send({ webinarId: web.id, couponCode: 'EARLY50' }).expect(200)).body.data;
    expect(q).toMatchObject({ kind: 'webinar', subtotal: '299.00', discount: '50.00', total: '249.00', items: [{ kind: 'webinar', title: 'Tax Saving Masterclass (webinar ticket)' }] });
    const order = (await authed(app, a.s).post('/api/v1/learn/checkout').send({ webinarId: web.id, couponCode: 'EARLY50', billing: { name: 'Anita Buyer' } }).expect(201)).body.data;
    expect(await prisma.webinarRegistration.count({ where: { liveClassId: web.id } })).toBe(0); // nothing before payment
    const paid = await pay(a.s, order.id);
    expect(paid).toMatchObject({ status: 'PAID', items: [expect.objectContaining({ liveClassId: web.id, totalAmount: '249' })] });
    const reg = await prisma.webinarRegistration.findFirstOrThrow({ where: { liveClassId: web.id } });
    expect(reg).toMatchObject({ orderId: order.id, email: a.email, name: 'Anita Buyer', cancelledAt: null });
    const mail = (await lastEmail(app, a.email))!;
    expect(mail).toMatchObject({ tag: 'webinar-ticket', subject: 'Your ticket: Tax Saving Masterclass' });
    const code = /\/live\/ticket\/([\w-]+)/.exec(mail.text)![1];
    expect(code).toBe(reg.ticketCode);
    const ticket = (await api(app).get(`/api/v1/public/live/tickets/${code}`).set('Host', host).expect(200)).body.data;
    const join = (await api(app).post(`/api/v1/public/live/tickets/${code}/join`).set('Host', host).send({ sessionId: ticket.sessions[0].id }).expect(200)).body.data;
    expect(join).toEqual({ provider: 'EXTERNAL', joinUrl: 'https://meet.example.test/tax' });
    expect((await authed(app, a.s).get('/api/v1/learn/live/upcoming').expect(200)).body.data.map((u: any) => u.liveClass.id)).toContain(web.id);
    expect((await authed(app, cs).get(`/api/v1/creator/live/classes/${web.id}`).expect(200)).body.data.registrations).toBe(1);

    // Same buyer cannot buy twice; seats are enforced at checkout.
    const again = await authed(app, a.s).post('/api/v1/learn/checkout').send({ webinarId: web.id, billing: { name: 'Anita Buyer' } }).expect(409);
    expect(again.body.error.message).toMatch(/already have a ticket/);
    const b = await student(c.tenant.slug, 'Bela Buyer');
    const ob = (await authed(app, b.s).post('/api/v1/learn/checkout').send({ webinarId: web.id, billing: { name: 'Bela Buyer' } }).expect(201)).body.data;
    await pay(b.s, ob.id);
    const cst = await student(c.tenant.slug, 'Chirag Late');
    const full = await authed(app, cst.s).post('/api/v1/learn/checkout').send({ webinarId: web.id, billing: { name: 'Chirag Late' } }).expect(409);
    expect(full.body.error.message).toBe('This webinar is full.');
    expect((await api(app).get('/api/v1/public/webinars/tax-saving-masterclass').set('Host', host)).body.data).toMatchObject({ seatsLeft: 0, open: false });

    // Full refund with revoke cancels the ticket: the link stops working and the seat frees up.
    await authed(app, cs).post(`/api/v1/creator/orders/${order.id}/refunds`).send({ revokeAccess: true, reason: 'Cannot attend' }).expect(201);
    expect((await prisma.webinarRegistration.findUniqueOrThrow({ where: { id: reg.id } })).cancelledAt).not.toBeNull();
    await api(app).get(`/api/v1/public/live/tickets/${code}`).set('Host', host).expect(404);
    await api(app).post(`/api/v1/public/live/tickets/${code}/join`).set('Host', host).send({ sessionId: ticket.sessions[0].id }).expect(404);
    expect((await authed(app, a.s).get('/api/v1/learn/live/upcoming').expect(200)).body.data.map((u: any) => u.liveClass.id)).not.toContain(web.id);
    expect((await api(app).get('/api/v1/public/webinars/tax-saving-masterclass').set('Host', host)).body.data.seatsLeft).toBe(1);

    // Buying again after a cancelled ticket issues a fresh link.
    const o2 = (await authed(app, a.s).post('/api/v1/learn/checkout').send({ webinarId: web.id, billing: { name: 'Anita Buyer' } }).expect(201)).body.data;
    await pay(a.s, o2.id);
    const again2 = await prisma.webinarRegistration.findUniqueOrThrow({ where: { id: reg.id } });
    expect(again2).toMatchObject({ cancelledAt: null, orderId: o2.id });
    expect(again2.ticketCode).not.toBe(code);

    // Making it free again re-opens free registration.
    await authed(app, cs).patch(`/api/v1/creator/live/classes/${web.id}`).send({ priceAmount: null, capacity: 10 }).expect(200);
    await api(app).post('/api/v1/public/webinars/tax-saving-masterclass/register').set('Host', host).send({ name: 'Free Now', email: 'free-now@example.test', consent: true }).expect(200);
    await authed(app, cst.s).post('/api/v1/learn/checkout/quote').send({ webinarId: web.id }).expect(409);
  });
});
