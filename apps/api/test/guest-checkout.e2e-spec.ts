import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Queue } from 'bullmq';
import { QUEUES } from '../src/core/queue/queue.constants.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { api, authed, createTestApp, emailCount, lastEmail, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';
import { RazorpaySim } from './razorpay-sim.js';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const KEY_ID = 'rzp_test_GuestCo123456';
const KEY_SECRET = 'sim_guest_key_secret';

async function course(app: NestExpressApplication, cs: Session, title: string, price: number | null) {
  const c = (await authed(app, cs).post('/api/v1/creator/courses').send({ title }).expect(201)).body.data;
  const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${c.id}/curriculum`)).body.data[0].id;
  const l = (await authed(app, cs).post(`/api/v1/creator/courses/${c.id}/lessons`).send({ sectionId: sec, title: 'Welcome', type: 'TEXT' }).expect(201)).body.data;
  await authed(app, cs).patch(`/api/v1/creator/courses/${c.id}/lessons/${l.id}`).send({ content: doc('Hello'), isPublished: true }).expect(200);
  await authed(app, cs).patch(`/api/v1/creator/courses/${c.id}`).send(price === null ? { isFree: true } : { isFree: false, priceAmount: price }).expect(200);
  await authed(app, cs).post(`/api/v1/creator/courses/${c.id}/publish`).send({}).expect(200);
  return c as { id: string; slug: string };
}

const passwordIn = (text: string) => /Password:\s*\**([A-Za-z0-9]+)/.exec(text)?.[1];

describe('Guest checkout — account created at checkout, login details emailed (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let sim: RazorpaySim;
  let host: string;
  let paid: { id: string };
  let free: { id: string };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    sim = new RazorpaySim().install(app);
    sim.keys.set(KEY_ID, KEY_SECRET);
    const c = await registerCreator(app);
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    host = tenantHost(c.tenant.slug);
    await app.get(HostResolverService).invalidate(host);
    await authed(app, c.session).put('/api/v1/creator/payments/razorpay').send({ keyId: KEY_ID, keySecret: KEY_SECRET }).expect(200);
    paid = await course(app, c.session, 'Communication course', 999);
    free = await course(app, c.session, 'Free starter', null);
  });
  afterAll(async () => app?.close());

  const credentialsJob = async (to: string) => {
    const jobs = await app.get<Queue>(getQueueToken(QUEUES.NOTIFICATIONS)).getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
    return jobs.find((j) => j.data.to === to && j.data.tag === 'account-credentials');
  };

  it('a new buyer is signed in without a password, pays, and gets a working generated password by email', async () => {
    const email = uniqueEmail('guest');
    const res = await api(app).post('/api/v1/auth/register/checkout').set('Host', host).send({ fullName: 'Guest Buyer', email, phone: '+919812300001' }).expect(200);
    expect(res.body.data.accountExists).toBe(false);
    const s = parseSession(res, host);
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(user.passwordHash).toBeNull();
    expect(user.phone).toBe('+919812300001');

    const order = (await authed(app, s).post('/api/v1/learn/checkout').send({ courseId: paid.id, billing: { name: 'Guest Buyer', state: 'Gujarat' } }).expect(201)).body.data;
    expect(await lastEmail(app, email).then((e) => e?.tag)).not.toBe('account-credentials'); // nothing until paid
    const pay = (await authed(app, s).post(`/api/v1/learn/orders/${order.id}/pay`).expect(200)).body.data;
    await authed(app, s).post(`/api/v1/learn/orders/${order.id}/confirm`).send(sim.pay(pay.checkout.orderId)).expect(200);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBeTruthy();
    const creds = await credentialsJob(email);
    expect(creds).toBeDefined();
    expect(creds!.opts.removeOnComplete).toBe(true);
    expect(creds!.data.subject).toMatch(/login details/);
    const password = passwordIn(creds!.data.text)!;
    expect(password).toHaveLength(10);
    expect(await prisma.enrollment.count({ where: { userId: user.id, courseId: paid.id } })).toBe(1);

    // The emailed password signs in; a wrong one does not.
    await api(app).post('/api/v1/auth/login').set('Host', host).send({ email, password: 'not-the-password' }).expect(401);
    await api(app).post('/api/v1/auth/login').set('Host', host).send({ email, password }).expect(200);

    // From now on this email is a real account: checkout never signs anyone into it.
    const again = await api(app).post('/api/v1/auth/register/checkout').set('Host', host).send({ fullName: 'Someone Else', email }).expect(200);
    expect(again.body.data).toEqual({ accountExists: true });
    expect(again.headers['set-cookie']).toBeUndefined();
  });

  it('an existing registered student must log in instead', async () => {
    const email = uniqueEmail('member');
    await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: 'Member', email, password: 'student-password-1' }).expect(201);
    const res = await api(app).post('/api/v1/auth/register/checkout').set('Host', host).send({ fullName: 'Member', email }).expect(200);
    expect(res.body.data).toEqual({ accountExists: true });
    expect(res.body.data.accessToken).toBeUndefined();
  });

  it('an abandoned guest checkout can be resumed; a free course emails login details immediately', async () => {
    const email = uniqueEmail('comeback');
    await api(app).post('/api/v1/auth/register/checkout').set('Host', host).send({ fullName: 'Come Back', email }).expect(200);
    // Left without paying: the empty passwordless account is signed in again on the next try.
    const res = await api(app).post('/api/v1/auth/register/checkout').set('Host', host).send({ fullName: 'Come Back', email }).expect(200);
    expect(res.body.data.accountExists).toBe(false);
    const s = parseSession(res, host);
    expect(await prisma.user.count({ where: { email } })).toBe(1);

    // Free courses skip checkout: the page enrols directly, which also sends the login details.
    await authed(app, s).post(`/api/v1/learn/courses/${free.id}/enroll`).expect(201);
    expect(await emailCount(app, email)).toBe(1); // login details (no receipt for a free enrolment)
    const login = passwordIn((await credentialsJob(email))!.data.text)!;
    await api(app).post('/api/v1/auth/login').set('Host', host).send({ email, password: login }).expect(200);
    expect((await prisma.user.findFirstOrThrow({ where: { email } })).passwordHash).toBeTruthy();
  });

  it('guests can price the course before signing in, but not a cart', async () => {
    const q = (await api(app).post('/api/v1/public/checkout/quote').set('Host', host).send({ courseId: paid.id }).expect(200)).body.data;
    expect(q).toMatchObject({ subtotal: '999.00', total: '999.00', paymentsEnabled: true });
    await api(app).post('/api/v1/public/checkout/quote').set('Host', host).send({ fromCart: true }).expect(401);
    await api(app).get('/api/v1/public/checkout/offers').set('Host', host).query({ courseId: paid.id }).expect(200);
  });

  it('only works on an academy host', async () => {
    await api(app).post('/api/v1/auth/register/checkout').set('Host', 'app.lvh.me').send({ fullName: 'Nope', email: uniqueEmail('x') }).expect(404);
  });
});
