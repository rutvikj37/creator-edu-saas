import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { EntitlementsService } from '../src/modules/subscriptions/entitlements.service.js';
import { api, authed, createTestApp, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';
import { RazorpaySim } from './razorpay-sim.js';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const KEY_ID = 'rzp_test_CartBundle1234';
const KEY_SECRET = 'sim_cart_key_secret';

describe('Cart and bundles (e2e)', () => {
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
    // The trial plan allows 3 courses; these tests need more.
    await prisma.tenantLimitOverride.create({ data: { tenantId: c.tenant.id, featureKey: 'courses.max', limitValue: BigInt(20), reason: 'test' } as never });
    await app.get(EntitlementsService).invalidate(c.tenant.id);
    await authed(app, c.session).put('/api/v1/creator/payments/razorpay').send({ keyId: KEY_ID, keySecret: KEY_SECRET }).expect(200);
    return c;
  }
  async function course(cs: Session, title: string, price: number | null, publish = true) {
    const co = (await authed(app, cs).post('/api/v1/creator/courses').send({ title }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
    const l = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Welcome', type: 'TEXT' }).expect(201)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}/lessons/${l.id}`).send({ content: doc('Hello'), isPublished: true }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}`).send(price === null ? { isFree: true } : { isFree: false, priceAmount: price }).expect(200);
    if (publish) await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/publish`).send({}).expect(200);
    return co as { id: string; slug: string; title: string };
  }
  async function student(slug: string) {
    const host = tenantHost(slug);
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: 'Cart Buyer', email: uniqueEmail('cart'), password: 'student-password-1' }).expect(201);
    return parseSession(reg, host);
  }
  async function payOrder(s: Session, orderId: string) {
    const pay = (await authed(app, s).post(`/api/v1/learn/orders/${orderId}/pay`).expect(200)).body.data;
    return (await authed(app, s).post(`/api/v1/learn/orders/${orderId}/confirm`).send(sim.pay(pay.checkout.orderId)).expect(200)).body.data;
  }

  it('bundles: creator rules, public page, purchase grants every course, refund revokes them', async () => {
    const c = await academy();
    const cs = c.session;
    const host = tenantHost(c.tenant.slug);
    const a = await course(cs, 'Excel Basics', 999);
    const b = await course(cs, 'Excel Charts', 1499);
    const free = await course(cs, 'Excel Shortcuts', null);
    const draft = await course(cs, 'Excel Macros', 799, false);

    // Validation: at least two courses; drafts cannot be published in a bundle.
    const bad = await authed(app, cs).post('/api/v1/creator/bundles').send({ title: 'Solo', priceAmount: 500, courseIds: [a.id] }).expect(422);
    expect(bad.body.error.details[0]).toEqual({ field: 'courseIds', message: 'Choose 2–30 courses' });
    const withDraft = (await authed(app, cs).post('/api/v1/creator/bundles').send({ title: 'Excel Pro', priceAmount: 1999, courseIds: [a.id, draft.id] }).expect(201)).body.data;
    const pub = await authed(app, cs).post(`/api/v1/creator/bundles/${withDraft.id}/status`).send({ status: 'PUBLISHED' }).expect(422);
    expect(pub.body.error.details[0].message).toBe('Publish these courses first: Excel Macros');

    const bundle = (await authed(app, cs).patch(`/api/v1/creator/bundles/${withDraft.id}`).send({ courseIds: [a.id, b.id, free.id], description: 'Everything Excel' }).expect(200)).body.data;
    expect(bundle).toMatchObject({ slug: 'excel-pro', status: 'DRAFT', currency: 'INR', worthAmount: '2498.00', courses: [{ title: 'Excel Basics' }, { title: 'Excel Charts' }, { title: 'Excel Shortcuts' }] });
    await api(app).get('/api/v1/public/bundles/excel-pro').set('Host', host).expect(404); // drafts are not public
    await authed(app, cs).post(`/api/v1/creator/bundles/${bundle.id}/status`).send({ status: 'PUBLISHED' }).expect(200);
    const page = (await api(app).get('/api/v1/public/bundles/excel-pro').set('Host', host).expect(200)).body.data;
    expect(page).toMatchObject({ title: 'Excel Pro', priceAmount: '1999', worthAmount: '2498.00', courseCount: 3 });
    expect((await api(app).get('/api/v1/public/bundles').set('Host', host).expect(200)).body.data.map((x: any) => x.slug)).toEqual(['excel-pro']);

    // Buying the bundle (GST 18% exclusive) grants all three courses.
    await authed(app, cs).put('/api/v1/creator/academy/business').send({ legalName: 'Excel LLP', gstRegistered: true, gstin: '24ABCDE1234F1Z5', taxRate: 18, pricesIncludeTax: false, state: 'Gujarat' }).expect(200);
    const s = await student(c.tenant.slug);
    const me = (await authed(app, s).get('/api/v1/auth/me')).body.data.user.id;
    const q = (await authed(app, s).post('/api/v1/learn/checkout/quote').send({ bundleId: bundle.id }).expect(200)).body.data;
    expect(q).toMatchObject({ kind: 'bundle', subtotal: '1999.00', tax: '359.82', total: '2358.82', items: [{ kind: 'bundle', title: 'Excel Pro (bundle)', courseCount: 3 }] });
    const order = (await authed(app, s).post('/api/v1/learn/checkout').send({ bundleId: bundle.id, billing: { name: 'Cart Buyer' } }).expect(201)).body.data;
    expect(order.items).toEqual([expect.objectContaining({ bundleId: bundle.id, title: 'Excel Pro (bundle)', totalAmount: '2358.82' })]);
    const paid = await payOrder(s, order.id);
    expect(paid.status).toBe('PAID');
    const enrolled = await prisma.enrollment.findMany({ where: { userId: me }, orderBy: { createdAt: 'asc' } });
    expect(enrolled.map((e) => e.courseId).sort()).toEqual([a.id, b.id, free.id].sort());
    expect(enrolled.every((e) => e.source === 'PURCHASE' && e.status === 'ACTIVE')).toBe(true);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });
    expect((inv.lines as any[])[0]).toMatchObject({ description: 'Excel Pro (bundle)', totalAmount: '2358.82' });
    expect((await authed(app, cs).get(`/api/v1/creator/bundles/${bundle.id}`).expect(200)).body.data.sold).toBe(1);

    // Owned → cannot buy again; a full refund with revoke removes every bundle course.
    await authed(app, s).post('/api/v1/learn/checkout').send({ bundleId: bundle.id, billing: { name: 'Cart Buyer' } }).expect(409);
    await authed(app, cs).post(`/api/v1/creator/orders/${order.id}/refunds`).send({ revokeAccess: true, reason: 'Changed mind' }).expect(201);
    expect((await prisma.enrollment.findMany({ where: { userId: me } })).map((e) => e.status)).toEqual(['REVOKED', 'REVOKED', 'REVOKED']);

    // Unpublishing a course makes the bundle unavailable; archiving removes it from carts.
    await authed(app, cs).post(`/api/v1/creator/courses/${b.id}/unpublish`).send({}).expect((r) => expect([200, 201]).toContain(r.status));
    await api(app).get('/api/v1/public/bundles/excel-pro').set('Host', host).expect(404);
    await authed(app, s).post('/api/v1/learn/checkout/quote').send({ bundleId: bundle.id }).expect(409);
  });

  it('cart: several courses and a bundle in one order, coupon on eligible lines, overlap and ownership rules, cart emptied on payment', async () => {
    const c = await academy();
    const cs = c.session;
    const x = await course(cs, 'Python 1', 1000);
    const y = await course(cs, 'Python 2', 2000);
    const z = await course(cs, 'Python 3', 3000);
    const w = await course(cs, 'Data Science', 4000);
    const freeOne = await course(cs, 'Free Intro', null);
    const bundle = (await authed(app, cs).post('/api/v1/creator/bundles').send({ title: 'Python Path', priceAmount: 4500, courseIds: [y.id, z.id] }).expect(201)).body.data;
    await authed(app, cs).post(`/api/v1/creator/bundles/${bundle.id}/status`).send({ status: 'PUBLISHED' }).expect(200);
    await authed(app, cs).post('/api/v1/creator/coupons').send({ code: 'PY10', type: 'PERCENT', value: 10, courseIds: [x.id, w.id] }).expect(201);
    await authed(app, cs).post('/api/v1/creator/coupons').send({ code: 'BUNDLEONLY', type: 'PERCENT', value: 10, courseIds: [y.id] }).expect(201);

    const s = await student(c.tenant.slug);
    const me = (await authed(app, s).get('/api/v1/auth/me')).body.data.user.id;
    await authed(app, s).post('/api/v1/learn/checkout').send({ fromCart: true, billing: { name: 'Cart Buyer' } }).expect(422); // empty
    await authed(app, s).post('/api/v1/learn/cart/items').send({ courseId: freeOne.id }).expect(409); // free → enrol directly
    await authed(app, s).post('/api/v1/learn/cart/items').send({ courseId: x.id }).expect(200);
    await authed(app, s).post('/api/v1/learn/cart/items').send({ courseId: x.id }).expect(200); // idempotent
    await authed(app, s).post('/api/v1/learn/cart/items').send({ bundleId: bundle.id }).expect(200);
    const overlap = await authed(app, s).post('/api/v1/learn/cart/items').send({ courseId: z.id }).expect(409);
    expect(overlap.body.error.message).toBe('“Python 3” is already included in Python Path (bundle). Remove one of them.');
    let cart = (await authed(app, s).post('/api/v1/learn/cart/items').send({ courseId: w.id }).expect(200)).body.data;
    expect(cart).toMatchObject({ count: 3, currency: 'INR', subtotal: '9500.00', ready: true });
    expect(cart.items.map((i: any) => [i.kind, i.title])).toEqual([['course', 'Python 1'], ['bundle', 'Python Path'], ['course', 'Data Science']]);

    // Another student's cart is separate.
    const other = await student(c.tenant.slug);
    expect((await authed(app, other).get('/api/v1/learn/cart').expect(200)).body.data.count).toBe(0);
    await authed(app, other).delete(`/api/v1/learn/cart/items/${cart.items[0].id}`).expect(200);
    expect((await authed(app, s).get('/api/v1/learn/cart')).body.data.count).toBe(3);

    // Coupon limited to some courses applies to those lines only; a coupon for a bundled course does not apply to the bundle.
    const nope = await authed(app, s).post('/api/v1/learn/checkout/quote').send({ fromCart: true, couponCode: 'BUNDLEONLY' }).expect(422);
    expect(nope.body.error.details[0].message).toBe('This coupon does not apply to these items');
    const q = (await authed(app, s).post('/api/v1/learn/checkout/quote').send({ fromCart: true, couponCode: 'PY10' }).expect(200)).body.data;
    expect(q).toMatchObject({ kind: 'cart', subtotal: '9500.00', discount: '500.00', total: '9000.00' });
    expect(q.items.map((i: any) => [i.title, i.discount, i.total])).toEqual([['Python 1', '100.00', '900.00'], ['Python Path (bundle)', '0.00', '4500.00'], ['Data Science', '400.00', '3600.00']]);

    const order = (await authed(app, s).post('/api/v1/learn/checkout').set('Idempotency-Key', 'cart-1').send({ fromCart: true, couponCode: 'PY10', billing: { name: 'Cart Buyer' } }).expect(201)).body.data;
    expect(order).toMatchObject({ totalAmount: '9000', discountAmount: '500' });
    expect(order.items).toHaveLength(3);
    // Same key, different contents → refused.
    await authed(app, s).post('/api/v1/learn/checkout').set('Idempotency-Key', 'cart-1').send({ courseId: x.id, billing: { name: 'Cart Buyer' } }).expect(409);
    await payOrder(s, order.id);
    const granted = (await prisma.enrollment.findMany({ where: { userId: me } })).map((e) => e.courseId).sort();
    expect(granted).toEqual([x.id, y.id, z.id, w.id].sort());
    expect((await authed(app, s).get('/api/v1/learn/cart')).body.data.count).toBe(0);
    const ledger = (await authed(app, cs).get(`/api/v1/creator/orders/${order.id}`).expect(200)).body.data.ledger;
    expect(ledger[0]).toMatchObject({ type: 'SALE', amount: '9000' });
    expect((await prisma.couponRedemption.count({ where: { orderId: order.id } }))).toBe(1);

    // Owned course is refused in the cart; an item that becomes unavailable is flagged and blocks checkout.
    await authed(app, s).post('/api/v1/learn/cart/items').send({ courseId: x.id }).expect(409);
    const v = await course(cs, 'Python 4', 500);
    await authed(app, s).post('/api/v1/learn/cart/items').send({ courseId: v.id }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${v.id}/unpublish`).send({}).expect((r) => expect([200, 201]).toContain(r.status));
    cart = (await authed(app, s).get('/api/v1/learn/cart')).body.data;
    expect(cart).toMatchObject({ ready: false, items: [{ title: 'Python 4', problem: 'No longer available' }] });
    await authed(app, s).post('/api/v1/learn/checkout').send({ fromCart: true, billing: { name: 'Cart Buyer' } }).expect(404);
    expect((await authed(app, s).delete('/api/v1/learn/cart').expect(200)).body.data.count).toBe(0);
  });

  it('isolation: bundles and carts of one academy are invisible to another', async () => {
    const one = await academy();
    const two = await academy();
    const a = await course(one.session, 'Only here 1', 100);
    const b = await course(one.session, 'Only here 2', 100);
    const bundle = (await authed(app, one.session).post('/api/v1/creator/bundles').send({ title: 'Private pack', priceAmount: 150, courseIds: [a.id, b.id] }).expect(201)).body.data;
    await authed(app, two.session).get(`/api/v1/creator/bundles/${bundle.id}`).expect(404);
    await authed(app, two.session).post('/api/v1/creator/bundles').send({ title: 'Steal', priceAmount: 10, courseIds: [a.id, b.id] }).expect(422);
    await authed(app, one.session).post(`/api/v1/creator/bundles/${bundle.id}/status`).send({ status: 'PUBLISHED' }).expect(200);
    const s2 = await student(two.tenant.slug);
    await authed(app, s2).post('/api/v1/learn/cart/items').send({ bundleId: bundle.id }).expect(404);
    await api(app).get('/api/v1/public/bundles/private-pack').set('Host', tenantHost(two.tenant.slug)).expect(404);
  });
});
