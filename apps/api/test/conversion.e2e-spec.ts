import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { api, authed, createTestApp, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';
import { RazorpaySim } from './razorpay-sim.js';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const KEY_ID = 'rzp_test_Conversion55';
const KEY_SECRET = 'sim_conversion_secret';

describe('Conversion tracking (e2e)', () => {
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

  it('records page views and checkout starts, attributes paid orders to source and landing page, and reports funnel, items, pages, sources and days', async () => {
    const c = await registerCreator(app);
    const cs = c.session;
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    await authed(app, cs).put('/api/v1/creator/payments/razorpay').send({ keyId: KEY_ID, keySecret: KEY_SECRET }).expect(200);
    const co = (await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'Stock Market Basics' }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
    const l = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Intro', type: 'TEXT' }).expect(201)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}/lessons/${l.id}`).send({ content: doc('Hi'), isPublished: true }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}`).send({ isFree: false, priceAmount: 999 }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/publish`).send({}).expect(200);
    const host = tenantHost(c.tenant.slug);
    const track = (body: Record<string, unknown>, ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130') => api(app).post('/api/v1/public/track').set('Host', host).set('User-Agent', ua).send(body);

    // Visitor A: Instagram campaign → course page → checkout → pays.
    const vA = 'v-aaaaaaaaaaaa';
    await track({ type: 'page_view', path: '/', visitorId: vA, source: 'Instagram', medium: 'social', campaign: 'diwali-sale' }).expect(202);
    await track({ type: 'page_view', path: `/courses/${co.slug}?utm_source=instagram`, visitorId: vA, source: 'instagram', medium: 'social', campaign: 'diwali-sale' }).expect(202);
    expect((await track({ type: 'page_view', path: `/courses/${co.slug}`, visitorId: vA }).expect(202)).body.data.duplicate).toBe(true); // refresh within 10 s
    await track({ type: 'checkout_started', path: `/checkout/${co.slug}`, visitorId: vA, item: { kind: 'course', id: co.id } }).expect(202);
    // Visitor B: from Google (referral) → course page → checkout, abandons.
    const vB = 'v-bbbbbbbbbbbb';
    await track({ type: 'page_view', path: `/courses/${co.slug}`, visitorId: vB, referrer: 'https://www.google.com/search?q=stocks' }).expect(202);
    await track({ type: 'checkout_started', path: `/checkout/${co.slug}`, visitorId: vB, item: { kind: 'course', id: co.id } }).expect(202);
    // Visitor C: direct, home only. Bot and Do Not Track are ignored.
    await track({ type: 'page_view', path: '/', visitorId: 'v-cccccccccccc' }).expect(202);
    expect((await track({ type: 'page_view', path: '/', visitorId: 'v-bot-0000001' }, 'Googlebot/2.1 (+http://www.google.com/bot.html)').expect(202)).body.data.recorded).toBe(false);
    expect((await api(app).post('/api/v1/public/track').set('Host', host).set('DNT', '1').send({ type: 'page_view', path: '/', visitorId: 'v-dnt-0000001' }).expect(202)).body.data.recorded).toBe(false);
    await track({ type: 'page_view', path: '/', visitorId: 'bad id!' }).expect(202);
    await track({ type: 'nonsense', path: '/', visitorId: vA }).expect(422);
    const stored = await prisma.analyticsEvent.findMany({ where: { tenantId: c.tenant.id } });
    expect(stored).toHaveLength(6);
    expect(stored.find((e) => e.path === `/courses/${co.slug}` && e.visitorId === vA)).toMatchObject({ itemType: 'course', itemId: co.id, utmSource: 'instagram', utmCampaign: 'diwali-sale' });
    expect(stored.find((e) => e.visitorId === vB && e.type === 'page_view')).toMatchObject({ referrerHost: 'www.google.com' });

    // Visitor A buys, with first-touch attribution sent by the site.
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: 'Anil Buyer', email: uniqueEmail('cv'), password: 'student-password-1' }).expect(201);
    const s: Session = parseSession(reg, host);
    const order = (await authed(app, s).post('/api/v1/learn/checkout').send({ courseId: co.id, billing: { name: 'Anil Buyer' }, attribution: { visitorId: vA, source: 'Instagram', medium: 'social', campaign: 'diwali-sale', landingPath: '/', referrerHost: null, evil: 'x' } }).expect(201)).body.data;
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).attribution).toEqual({ visitorId: vA, source: 'instagram', medium: 'social', campaign: 'diwali-sale', landingPath: '/' });
    const p = (await authed(app, s).post(`/api/v1/learn/orders/${order.id}/pay`).expect(200)).body.data;
    await authed(app, s).post(`/api/v1/learn/orders/${order.id}/confirm`).send(sim.pay(p.checkout.orderId)).expect(200);

    const ins = (await authed(app, cs).get('/api/v1/creator/analytics/conversions').expect(200)).body.data;
    expect(ins.funnel).toMatchObject({ visitors: 3, pageViews: 4, itemViewers: 2, checkoutStarted: 2, paidOrders: 1, attributedOrders: 1, revenue: '999.00', viewToCheckout: 100, checkoutToPaid: 50, conversionRate: 33.3 });
    expect(ins.items).toEqual([expect.objectContaining({ type: 'course', id: co.id, title: 'Stock Market Basics', views: 2, visitors: 2, checkouts: 2, sales: 1, revenue: '999.00', conversionRate: 50 })]);
    expect(ins.pages.find((x: any) => x.path === '/')).toMatchObject({ views: 2, visitors: 2, sales: 1, revenue: '999.00' });
    expect(ins.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'instagram / social', visitors: 1, checkouts: 1, sales: 1, revenue: '999.00', campaigns: ['diwali-sale'] }),
      expect.objectContaining({ source: 'www.google.com (referral)', visitors: 1, checkouts: 1, sales: 0 }),
      expect.objectContaining({ source: 'Direct', visitors: 1, sales: 0 }),
    ]));
    expect(ins.daily.reduce((a: number, d: any) => a + d.sales, 0)).toBe(1);
    expect(ins.daily.at(-1)).toMatchObject({ visitors: 3, checkouts: 2 });

    // Permissions and isolation.
    const other = await registerCreator(app);
    expect((await authed(app, other.session).get('/api/v1/creator/analytics/conversions').expect(200)).body.data.funnel.visitors).toBe(0);
    await authed(app, s).get('/api/v1/creator/analytics/conversions').expect((r) => expect([401, 403, 404]).toContain(r.status));
  });
});
