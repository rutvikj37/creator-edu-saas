import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { RecoveryService } from '../src/modules/commerce/recovery.service.js';
import { api, authed, createTestApp, emailCount, lastEmail, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';
import { RazorpaySim } from './razorpay-sim.js';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const KEY_ID = 'rzp_test_FunNel123456';
const KEY_SECRET = 'sim_funnel_secret_value';

async function academy(app: NestExpressApplication, sim: RazorpaySim) {
  const c = await registerCreator(app);
  await app.get(PrismaService).tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
  await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
  sim.keys.set(KEY_ID, KEY_SECRET);
  await authed(app, c.session).put('/api/v1/creator/payments/razorpay').send({ keyId: KEY_ID, keySecret: KEY_SECRET }).expect(200);
  return c;
}

async function paidCourse(app: NestExpressApplication, cs: Session, title: string, price: number) {
  const course = (await authed(app, cs).post('/api/v1/creator/courses').send({ title }).expect(201)).body.data;
  const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${course.id}/curriculum`)).body.data[0].id;
  const l = (await authed(app, cs).post(`/api/v1/creator/courses/${course.id}/lessons`).send({ sectionId: sec, title: 'Welcome', type: 'TEXT' }).expect(201)).body.data;
  await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}/lessons/${l.id}`).send({ content: doc('Hello'), isPublished: true }).expect(200);
  await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}`).send({ isFree: false, priceAmount: price }).expect(200);
  await authed(app, cs).post(`/api/v1/creator/courses/${course.id}/publish`).send({}).expect(200);
  return course as { id: string; slug: string };
}

async function student(app: NestExpressApplication, slug: string, name = 'Priya Buyer') {
  const host = tenantHost(slug);
  const email = uniqueEmail('buyer');
  const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: name, email, password: 'student-password-1' }).expect(201);
  return { s: parseSession(reg, host), email };
}

/** Pays an order through the simulated Razorpay Checkout and returns the paid order. */
async function payOrder(app: NestExpressApplication, sim: RazorpaySim, s: Session, orderId: string) {
  const pay = (await authed(app, s).post(`/api/v1/learn/orders/${orderId}/pay`).expect(200)).body.data;
  return (await authed(app, s).post(`/api/v1/learn/orders/${orderId}/confirm`).send(sim.pay(pay.checkout.orderId)).expect(200)).body.data;
}

const billing = { name: 'Priya Buyer', phone: '+919812345678' };

describe('Sales funnels — bumps, upsells, payment links, cart recovery, tracking (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let sim: RazorpaySim;
  let A: Awaited<ReturnType<typeof academy>>;
  let main: { id: string; slug: string };
  let addon: { id: string; slug: string };
  let premium: { id: string; slug: string };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    sim = new RazorpaySim().install(app);
    A = await academy(app, sim);
    main = await paidCourse(app, A.session, 'Python Basics', 1000);
    addon = await paidCourse(app, A.session, 'Python Cheat Sheets', 500);
    premium = await paidCourse(app, A.session, 'Python Mastery', 3000);
    await authed(app, A.session).post('/api/v1/creator/coupons').send({ code: 'SAVE10', type: 'PERCENT', value: 10 }).expect(201);
  });
  afterAll(async () => app?.close());

  it('order bump: offered with its trigger, priced by the academy, excluded from coupons, fulfilled with the order', async () => {
    const cs = A.session;
    const items = (await authed(app, cs).get('/api/v1/creator/sales/items').expect(200)).body.data;
    expect(items.map((i: any) => i.title)).toEqual(expect.arrayContaining(['Python Basics', 'Python Cheat Sheets', 'Python Mastery']));

    const base = { type: 'BUMP', name: 'Cheat sheets bump', headline: 'Add the cheat sheets for just ₹199', itemKind: 'course', itemId: addon.id, triggers: [`course:${main.id}`] };
    const tooHigh = await authed(app, cs).post('/api/v1/creator/sales/offers').send({ ...base, priceAmount: 600 }).expect(422);
    expect(tooHigh.body.error.details[0].field).toBe('priceAmount');
    await authed(app, cs).post('/api/v1/creator/sales/offers').send({ ...base, itemKind: 'webinar', priceAmount: 199 }).expect(422);
    await authed(app, cs).post('/api/v1/creator/sales/offers').send({ ...base, triggers: [`course:${addon.id}`], priceAmount: 199 }).expect(422);
    const bump = (await authed(app, cs).post('/api/v1/creator/sales/offers').send({ ...base, priceAmount: 199 }).expect(201)).body.data;

    const buyer = await student(app, A.tenant.slug);
    const q = (await authed(app, buyer.s).post('/api/v1/learn/checkout/quote').send({ courseId: main.id }).expect(200)).body.data;
    expect(q.bumps).toEqual([expect.objectContaining({ offerId: bump.id, title: 'Python Cheat Sheets', price: '199.00', regularPrice: '500.00', selected: false })]);
    expect(q.total).toBe('1000.00');
    // Not offered with an unrelated purchase.
    expect((await authed(app, buyer.s).post('/api/v1/learn/checkout/quote').send({ courseId: premium.id }).expect(200)).body.data.bumps).toEqual([]);

    // Ticked + 10% coupon: the coupon only discounts the main course.
    const withBump = (await authed(app, buyer.s).post('/api/v1/learn/checkout/quote').send({ courseId: main.id, bumpOfferIds: [bump.id], couponCode: 'SAVE10' }).expect(200)).body.data;
    expect(withBump).toMatchObject({ subtotal: '1199.00', discount: '100.00', total: '1099.00' });
    expect(withBump.items.map((i: any) => [i.title, i.source, i.total])).toEqual([['Python Basics', null, '900.00'], ['Python Cheat Sheets', 'BUMP', '199.00']]);
    await authed(app, buyer.s).post('/api/v1/learn/checkout/quote').send({ courseId: main.id, bumpOfferIds: ['c'.repeat(25)] }).expect(422);

    const order = (await authed(app, buyer.s).post('/api/v1/learn/checkout').send({ courseId: main.id, bumpOfferIds: [bump.id], couponCode: 'SAVE10', billing }).expect(201)).body.data;
    expect(order).toMatchObject({ totalAmount: '1099' });
    const paid = await payOrder(app, sim, buyer.s, order.id);
    expect(paid.status).toBe('PAID');
    expect(paid.items.find((i: any) => i.source === 'BUMP')).toMatchObject({ offerId: bump.id, totalAmount: '199' });
    const user = await prisma.user.findFirstOrThrow({ where: { email: buyer.email } });
    expect(await prisma.enrollment.count({ where: { userId: user.id, courseId: { in: [main.id, addon.id] } } })).toBe(2);

    const listed = (await authed(app, cs).get('/api/v1/creator/sales/offers').expect(200)).body.data;
    expect(listed[0]).toMatchObject({ id: bump.id, accepted: 1, revenue: '199.00', itemTitle: 'Python Cheat Sheets', triggerTitles: ['Python Basics'] });
    // An offer that sold is archived, not deleted.
    expect((await authed(app, cs).delete(`/api/v1/creator/sales/offers/${bump.id}`).expect(200)).body.data).toMatchObject({ archived: true });
    expect((await authed(app, cs).get('/api/v1/creator/sales/offers').expect(200)).body.data).toEqual([]);
  });

  it('post-purchase upsell: shown once after payment within the window, bought at the offer price, or declined', async () => {
    const cs = A.session;
    const upsell = (await authed(app, cs).post('/api/v1/creator/sales/offers').send({
      type: 'UPSELL', name: 'Mastery upsell', headline: 'Go further with Python Mastery — 50% off, today only', itemKind: 'course', itemId: premium.id, priceAmount: 1500, windowMinutes: 30,
    }).expect(201)).body.data;

    const buyer = await student(app, A.tenant.slug, 'Upsell Buyer');
    const first = (await authed(app, buyer.s).post('/api/v1/learn/checkout').send({ courseId: addon.id, billing }).expect(201)).body.data;
    // Nothing to offer before payment.
    expect((await authed(app, buyer.s).get(`/api/v1/learn/orders/${first.id}/upsell`).expect(200)).body.data.offer).toBeNull();
    await payOrder(app, sim, buyer.s, first.id);
    const offer = (await authed(app, buyer.s).get(`/api/v1/learn/orders/${first.id}/upsell`).expect(200)).body.data.offer;
    expect(offer).toMatchObject({ offerId: upsell.id, title: 'Python Mastery', price: '1500', regularPrice: '3000.00', sourceOrderId: first.id });

    // Another student can't use this order's offer.
    const other = await student(app, A.tenant.slug, 'Other Student');
    await authed(app, other.s).post('/api/v1/learn/checkout/quote').send({ upsellOfferId: upsell.id, sourceOrderId: first.id }).expect(404);

    await authed(app, buyer.s).post('/api/v1/learn/checkout/quote').send({ upsellOfferId: upsell.id, sourceOrderId: first.id, couponCode: 'SAVE10' }).expect(422);
    const order = (await authed(app, buyer.s).post('/api/v1/learn/checkout').send({ upsellOfferId: upsell.id, sourceOrderId: first.id, billing }).expect(201)).body.data;
    expect(order).toMatchObject({ totalAmount: '1500' });
    expect(order.items[0]).toMatchObject({ source: 'UPSELL', offerId: upsell.id });
    await payOrder(app, sim, buyer.s, order.id);
    expect((await prisma.salesOfferResponse.findFirstOrThrow({ where: { offerId: upsell.id, sourceOrderId: first.id } })).decision).toBe('ACCEPTED');
    expect((await authed(app, buyer.s).get(`/api/v1/learn/orders/${first.id}/upsell`).expect(200)).body.data.offer).toBeNull();

    // A second buyer says no thanks; the offer is gone for that order and can't be bought anymore.
    const b2 = await student(app, A.tenant.slug, 'Declining Buyer');
    const o2 = (await authed(app, b2.s).post('/api/v1/learn/checkout').send({ courseId: addon.id, billing }).expect(201)).body.data;
    await payOrder(app, sim, b2.s, o2.id);
    expect((await authed(app, b2.s).get(`/api/v1/learn/orders/${o2.id}/upsell`)).body.data.offer).not.toBeNull();
    await authed(app, b2.s).post(`/api/v1/learn/orders/${o2.id}/upsell/${upsell.id}/decline`).expect(200);
    expect((await authed(app, b2.s).get(`/api/v1/learn/orders/${o2.id}/upsell`)).body.data.offer).toBeNull();
    await authed(app, b2.s).post('/api/v1/learn/checkout').send({ upsellOfferId: upsell.id, sourceOrderId: o2.id, billing }).expect(409);

    // The window closes.
    const b3 = await student(app, A.tenant.slug, 'Late Buyer');
    const o3 = (await authed(app, b3.s).post('/api/v1/learn/checkout').send({ courseId: addon.id, billing }).expect(201)).body.data;
    await payOrder(app, sim, b3.s, o3.id);
    await prisma.order.update({ where: { id: o3.id }, data: { paidAt: new Date(Date.now() - 31 * 60_000) } });
    expect((await authed(app, b3.s).get(`/api/v1/learn/orders/${o3.id}/upsell`)).body.data.offer).toBeNull();
    await authed(app, cs).post(`/api/v1/creator/sales/offers/${upsell.id}/status`).send({ status: 'PAUSED' }).expect(200);
  });

  it('payment link: custom price, locked coupon, usage limit, public page', async () => {
    const cs = A.session;
    await authed(app, cs).post('/api/v1/creator/sales/links').send({ title: 'VIP price', itemKind: 'membership', itemId: main.id, priceAmount: 10 }).expect(422);
    await authed(app, cs).post('/api/v1/creator/sales/links').send({ title: 'Bad coupon', itemKind: 'course', itemId: main.id, couponCode: 'NOPE' }).expect(422);
    const link = (await authed(app, cs).post('/api/v1/creator/sales/links').send({ code: 'vip99', title: 'Webinar attendees offer', itemKind: 'course', itemId: main.id, priceAmount: 99, maxUses: 1, note: 'Only for webinar attendees' }).expect(201)).body.data;
    expect(link).toMatchObject({ code: 'VIP99', priceAmount: '99', state: 'ACTIVE', uses: 0 });
    expect(link.url).toMatch(/\/pay\/VIP99$/);
    await authed(app, cs).post('/api/v1/creator/sales/links').send({ code: 'VIP99', title: 'Dup', itemKind: 'course', itemId: main.id }).expect(422);

    const host = tenantHost(A.tenant.slug);
    const pub = (await api(app).get('/api/v1/public/pay/vip99').set('Host', host).expect(200)).body.data;
    expect(pub).toMatchObject({ title: 'Webinar attendees offer', itemTitle: 'Python Basics', price: '99', regularPrice: '1000.00', allowCoupons: false, note: 'Only for webinar attendees' });

    const buyer = await student(app, A.tenant.slug, 'Link Buyer');
    const q = (await authed(app, buyer.s).post('/api/v1/learn/checkout/quote').send({ paymentLinkCode: 'VIP99' }).expect(200)).body.data;
    expect(q).toMatchObject({ total: '99.00', paymentLink: { code: 'VIP99', couponLocked: true }, bumps: [] });
    await authed(app, buyer.s).post('/api/v1/learn/checkout/quote').send({ paymentLinkCode: 'VIP99', couponCode: 'SAVE10' }).expect(422);
    const order = (await authed(app, buyer.s).post('/api/v1/learn/checkout').send({ paymentLinkCode: 'VIP99', billing }).expect(201)).body.data;
    expect(order).toMatchObject({ totalAmount: '99', paymentLinkId: link.id });
    await payOrder(app, sim, buyer.s, order.id);

    const after = (await authed(app, cs).get('/api/v1/creator/sales/links').expect(200)).body.data[0];
    expect(after).toMatchObject({ uses: 1, revenue: '99.00', state: 'EXHAUSTED' });
    await api(app).get('/api/v1/public/pay/VIP99').set('Host', host).expect(409);
    // A used link is switched off rather than deleted.
    expect((await authed(app, cs).delete(`/api/v1/creator/sales/links/${link.id}`).expect(200)).body.data).toMatchObject({ disabled: true });
    await api(app).get('/api/v1/public/pay/VIP99').set('Host', host).expect(404);
  });

  it('cart recovery: reminds unpaid checkouts on schedule with a coupon link, then counts the purchase as recovered', async () => {
    const cs = A.session;
    await authed(app, cs).put('/api/v1/creator/sales/recovery').send({ enabled: true, steps: [5], couponCode: null, whatsapp: false }).expect(422);
    await authed(app, cs).put('/api/v1/creator/sales/recovery').send({ enabled: true, steps: [60], couponCode: 'NOPE', whatsapp: false }).expect(422);
    const saved = (await authed(app, cs).put('/api/v1/creator/sales/recovery').send({ enabled: true, steps: [60, 1440], couponCode: 'save10', whatsapp: true }).expect(200)).body.data;
    expect(saved).toMatchObject({ enabled: true, steps: [60, 1440], couponCode: 'SAVE10', whatsapp: true, whatsappAvailable: false });

    const buyer = await student(app, A.tenant.slug, 'Hesitant Buyer');
    const order = (await authed(app, buyer.s).post('/api/v1/learn/checkout').send({ courseId: premium.id, billing }).expect(201)).body.data;
    const recovery = app.get(RecoveryService);
    const before = await emailCount(app, buyer.email);
    await recovery.run();
    expect(await emailCount(app, buyer.email)).toBe(before); // too early

    await prisma.order.update({ where: { id: order.id }, data: { createdAt: new Date(Date.now() - 2 * 3600_000) } });
    await recovery.run();
    const mail = await lastEmail(app, buyer.email);
    expect(mail).toMatchObject({ tag: 'checkout-recovery', subject: 'You left something at checkout' });
    expect(mail!.text).toContain('Python Mastery');
    expect(mail!.text).toContain('Use code SAVE10 to get 10% off.');
    expect(mail!.text).toMatch(new RegExp(`/checkout/${premium.slug}\\?coupon=SAVE10`));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).recoveryStage).toBe(1);
    await recovery.run();
    expect(await emailCount(app, buyer.email)).toBe(before + 1); // the second reminder waits for its step

    // Comes back through the link and pays: the reminder sequence carries over and the sale counts as recovered.
    const again = (await authed(app, buyer.s).post('/api/v1/learn/checkout').send({ courseId: premium.id, couponCode: 'SAVE10', billing }).expect(201)).body.data;
    expect((await prisma.order.findUniqueOrThrow({ where: { id: again.id } })).recoveryStage).toBe(1);
    await payOrder(app, sim, buyer.s, again.id);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ recoveredByOrderId: again.id });
    const stats = (await authed(app, cs).get('/api/v1/creator/sales/recovery/stats').expect(200)).body.data;
    expect(stats).toMatchObject({ reminded: 1, recovered: 1, revenue: [{ currency: 'INR', amount: 2700 }] });
    const recent = (await authed(app, cs).get('/api/v1/creator/sales/recovery/recent').expect(200)).body.data;
    expect(recent[0]).toMatchObject({ id: order.id, buyer: { email: buyer.email } });

    // Nothing more is sent for a recovered checkout.
    await prisma.order.update({ where: { id: order.id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    await recovery.run();
    expect(await emailCount(app, buyer.email)).toBe(before + 2); // + the purchase receipt only
  });

  it('ad tracking IDs are validated and published to the academy site', async () => {
    const cs = A.session;
    const bad = await authed(app, cs).put('/api/v1/creator/sales/tracking').send({ metaPixelId: '<script>', ga4Id: 'UA-123', gtmId: '' }).expect(422);
    expect(bad.body.error.details.map((d: any) => d.field).sort()).toEqual(['ga4Id', 'metaPixelId']);
    await authed(app, cs).put('/api/v1/creator/sales/tracking').send({ metaPixelId: '123456789012345', ga4Id: 'g-ab12cd34ef', gtmId: 'GTM-K9ZX7Q' }).expect(200);
    const site = (await api(app).get('/api/v1/public/site').set('Host', tenantHost(A.tenant.slug)).expect(200)).body.data;
    expect(site.tracking).toEqual({ metaPixelId: '123456789012345', ga4Id: 'G-AB12CD34EF', gtmId: 'GTM-K9ZX7Q' });
  });

  it('another academy cannot see or change these offers, links and settings', async () => {
    const B = await registerCreator(app);
    const offer = (await authed(app, A.session).post('/api/v1/creator/sales/offers').send({ type: 'BUMP', name: 'Iso', headline: 'Iso bump', itemKind: 'course', itemId: addon.id, priceAmount: 99 }).expect(201)).body.data;
    const link = (await authed(app, A.session).post('/api/v1/creator/sales/links').send({ title: 'Iso link', itemKind: 'course', itemId: main.id }).expect(201)).body.data;
    expect((await authed(app, B.session).get('/api/v1/creator/sales/offers').expect(200)).body.data).toEqual([]);
    expect((await authed(app, B.session).get('/api/v1/creator/sales/links').expect(200)).body.data).toEqual([]);
    expect((await authed(app, B.session).get('/api/v1/creator/sales/items').expect(200)).body.data).toEqual([]);
    await authed(app, B.session).put(`/api/v1/creator/sales/offers/${offer.id}`).send({ type: 'BUMP', name: 'Mine', headline: 'Mine now', itemKind: 'course', itemId: addon.id, priceAmount: 1 }).expect(404);
    await authed(app, B.session).post(`/api/v1/creator/sales/offers/${offer.id}/status`).send({ status: 'PAUSED' }).expect(404);
    await authed(app, B.session).delete(`/api/v1/creator/sales/offers/${offer.id}`).expect(404);
    await authed(app, B.session).put(`/api/v1/creator/sales/links/${link.id}`).send({ title: 'Mine', itemKind: 'course', itemId: main.id }).expect(404);
    await authed(app, B.session).delete(`/api/v1/creator/sales/links/${link.id}`).expect(404);
    // B can't sell A's course through an offer or link.
    await authed(app, B.session).post('/api/v1/creator/sales/links').send({ title: 'Theirs', itemKind: 'course', itemId: main.id }).expect(422);
    expect((await authed(app, B.session).get('/api/v1/creator/sales/recovery').expect(200)).body.data.enabled).toBe(false);
    expect((await authed(app, B.session).get('/api/v1/creator/sales/tracking').expect(200)).body.data).toEqual({ metaPixelId: null, ga4Id: null, gtmId: null });
    expect((await authed(app, B.session).get('/api/v1/creator/sales/recovery/stats').expect(200)).body.data).toMatchObject({ reminded: 0, recovered: 0 });
    // A's link code doesn't open on B's site.
    await api(app).get(`/api/v1/public/pay/${link.code}`).set('Host', tenantHost(B.tenant.slug)).expect(404);
  });
});
