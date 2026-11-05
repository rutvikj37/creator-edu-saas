import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { OrdersService } from '../src/modules/commerce/orders.service.js';
import { WebhooksService } from '../src/modules/commerce/webhooks.service.js';
import { adminWithRoles, api, authed, createTestApp, lastEmail, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';
import { RazorpaySim } from './razorpay-sim.js';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const KEY_ID = 'rzp_test_AbCdEf123456';
const KEY_SECRET = 'sim_key_secret_value';
const WEBHOOK_SECRET = 'sim_webhook_secret';

async function academy(app: NestExpressApplication) {
  const c = await registerCreator(app);
  await app.get(PrismaService).tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
  await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
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

describe('Commerce — Razorpay (e2e)', () => {
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

  it('gateway setup → coupon + GST checkout → Checkout.js confirm → access, invoice, ledger, receipt; duplicates are harmless', async () => {
    const c = await academy(app);
    const cs = c.session;
    const course = await paidCourse(app, cs, 'Paid SQL course', 1180);
    const host = tenantHost(c.tenant.slug);
    const buyer = await student(app, c.tenant.slug);

    // Not sellable before Razorpay is connected.
    expect((await api(app).get('/api/v1/public/site').set('Host', host)).body.data.paymentsEnabled).toBe(false);
    await authed(app, buyer.s).post('/api/v1/learn/checkout').send({ courseId: course.id, billing: { name: 'Priya Buyer' } }).expect(409);

    // Gateway: format check, rejected keys, then verified keys. Secrets never come back.
    await authed(app, cs).put('/api/v1/creator/payments/razorpay').send({ keyId: 'pk_live_nope', keySecret: 'x'.repeat(10) }).expect(422);
    const bad = (await authed(app, cs).put('/api/v1/creator/payments/razorpay').send({ keyId: KEY_ID, keySecret: 'wrong-secret-123' }).expect(200)).body.data;
    expect(bad).toMatchObject({ status: 'ERROR', lastError: 'Razorpay rejected these keys', mode: 'TEST' });
    const ok = (await authed(app, cs).put('/api/v1/creator/payments/razorpay').send({ keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET }).expect(200)).body.data;
    expect(ok).toMatchObject({ status: 'VERIFIED', keyId: KEY_ID, hasWebhookSecret: true });
    expect(ok.webhookUrl).toMatch(new RegExp(`/api/v1/webhooks/razorpay/${ok.id}$`));
    expect(JSON.stringify(ok)).not.toContain(KEY_SECRET);
    const stored = await prisma.paymentGatewayAccount.findUniqueOrThrow({ where: { id: ok.id } });
    expect(stored.secretEnc).not.toContain(KEY_SECRET);
    expect((await api(app).get('/api/v1/public/site').set('Host', host)).body.data.paymentsEnabled).toBe(true);

    // GST 18% inclusive and a 10% coupon.
    await authed(app, cs).put('/api/v1/creator/academy/business').send({ legalName: 'Asha Learning LLP', gstRegistered: true, gstin: '24ABCDE1234F1Z5', taxRate: 18, pricesIncludeTax: true, state: 'Gujarat' }).expect(200);
    await authed(app, cs).post('/api/v1/creator/coupons').send({ code: 'save10', type: 'PERCENT', value: 10, courseIds: [course.id] }).expect(201);
    await authed(app, cs).post('/api/v1/creator/coupons').send({ code: 'SAVE10', type: 'FIXED', value: 5 }).expect(422);
    const bogus = await authed(app, buyer.s).post('/api/v1/learn/checkout/quote').send({ courseId: course.id, couponCode: 'NOPE' }).expect(422);
    expect(bogus.body.error.details[0]).toEqual({ field: 'couponCode', message: 'This coupon code is not valid' });
    const quote = (await authed(app, buyer.s).post('/api/v1/learn/checkout/quote').send({ courseId: course.id, couponCode: 'save10' }).expect(200)).body.data;
    expect(quote).toMatchObject({ subtotal: '1180.00', discount: '118.00', total: '1062.00', tax: '162.00', couponCode: 'SAVE10', paymentsEnabled: true });

    // Order with idempotency.
    const body = { courseId: course.id, couponCode: 'SAVE10', billing: { name: 'Priya Buyer', phone: '+919812345678', state: 'Gujarat' } };
    const order = (await authed(app, buyer.s).post('/api/v1/learn/checkout').set('Idempotency-Key', 'k-1').send(body).expect(201)).body.data;
    expect(order).toMatchObject({ status: 'PENDING', number: 'ORD-000001', totalAmount: '1062', taxAmount: '162', couponCode: 'SAVE10' });
    const replay = (await authed(app, buyer.s).post('/api/v1/learn/checkout').set('Idempotency-Key', 'k-1').send(body).expect(201)).body.data;
    expect(replay.id).toBe(order.id);

    // Another student cannot see or pay this order.
    const other = await student(app, c.tenant.slug, 'Other Student');
    await authed(app, other.s).get(`/api/v1/learn/orders/${order.id}`).expect(404);
    await authed(app, other.s).post(`/api/v1/learn/orders/${order.id}/pay`).expect(404);

    const pay = (await authed(app, buyer.s).post(`/api/v1/learn/orders/${order.id}/pay`).expect(200)).body.data;
    expect(pay.checkout).toMatchObject({ provider: 'RAZORPAY', keyId: KEY_ID, amount: 106200, currency: 'INR', prefill: { contact: '+919812345678' } });
    expect(JSON.stringify(pay)).not.toContain(KEY_SECRET);
    const rzpOrder = sim.orders.get(pay.checkout.orderId);
    expect(rzpOrder).toMatchObject({ amount: 106200, receipt: 'ORD-000001', notes: { orderId: order.id } });

    // Forged signature is rejected; nothing is granted.
    const result = sim.pay(pay.checkout.orderId);
    await authed(app, buyer.s).post(`/api/v1/learn/orders/${order.id}/confirm`).send({ ...result, razorpay_signature: 'a'.repeat(64) }).expect(422);
    expect(await prisma.enrollment.count({ where: { courseId: course.id } })).toBe(0);

    const paid = (await authed(app, buyer.s).post(`/api/v1/learn/orders/${order.id}/confirm`).send(result).expect(200)).body.data;
    expect(paid).toMatchObject({ status: 'PAID', invoiceNumber: expect.stringMatching(/^INV\/\d{4}-\d{2}\/00001$/) });
    expect(paid.payments[0]).toMatchObject({ status: 'CAPTURED', providerPaymentId: result.razorpay_payment_id, method: 'upi', feeAmount: '25.06' });
    const enr = await prisma.enrollment.findFirstOrThrow({ where: { courseId: course.id } });
    expect(enr).toMatchObject({ source: 'PURCHASE', status: 'ACTIVE' });
    await authed(app, buyer.s).get(`/api/v1/learn/courses/${course.id}/player`).expect(200);
    expect((await prisma.coupon.findFirstOrThrow({ where: { code: 'SAVE10' } })).redemptionCount).toBe(1);
    const receipt = await lastEmail(app, buyer.email);
    expect(receipt).toMatchObject({ tag: 'purchase-receipt', subject: 'Payment received — order ORD-000001' });
    expect(receipt!.text).toContain('INR 1,062.00');

    // Ledger: sale 1062, GST 162, Razorpay fee 25.06, 5% commission on net 900 = 45.
    const ledger = (await authed(app, cs).get(`/api/v1/creator/orders/${order.id}`).expect(200)).body.data.ledger;
    expect(ledger.map((l: any) => [l.type, l.amount])).toEqual([['SALE', '1062'], ['TAX', '-162'], ['GATEWAY_FEE', '-25.06'], ['PLATFORM_COMMISSION', '-45']]);
    const summary = (await authed(app, cs).get('/api/v1/creator/orders/summary').expect(200)).body.data;
    expect(summary.totals[0]).toEqual({ currency: 'INR', gross: '1062.00', refunds: '0.00', tax: '162.00', gatewayFees: '25.06', platformCommission: '45.00', affiliateCommission: '0.00', net: '829.94' });

    // Repeat confirmation and the matching webhook change nothing.
    await authed(app, buyer.s).post(`/api/v1/learn/orders/${order.id}/confirm`).send(result).expect(200);
    const wh = sim.webhook(WEBHOOK_SECRET, 'payment.captured', { id: result.razorpay_payment_id, order_id: pay.checkout.orderId, status: 'captured' }, 'evt_dup');
    await api(app).post(`/api/v1/webhooks/razorpay/${ok.id}`).set(wh.headers).send(wh.body).expect(200);
    const dup = await api(app).post(`/api/v1/webhooks/razorpay/${ok.id}`).set(wh.headers).send(wh.body).expect(200);
    expect(dup.body.data).toEqual({ received: true, duplicate: true });
    const ev = await prisma.webhookEvent.findFirstOrThrow({ where: { eventId: 'evt_dup' } });
    expect(await app.get(WebhooksService).process(ev.id)).toBe('already-captured');
    expect(await prisma.ledgerEntry.count({ where: { orderId: order.id } })).toBe(4);
    expect(await prisma.invoice.count({ where: { orderId: order.id } })).toBe(1);

    // Coupon is per-user once; buying again is blocked.
    await authed(app, buyer.s).post('/api/v1/learn/checkout').send(body).expect(409);

    // Invoice PDF for buyer and staff; not for another student.
    const pdf = await authed(app, buyer.s).get(`/api/v1/learn/orders/${order.id}/invoice`).buffer(true).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');
    await authed(app, cs).get(`/api/v1/creator/orders/${order.id}/invoice`).expect(200);
    await authed(app, other.s).get(`/api/v1/learn/orders/${order.id}/invoice`).expect(404);

    // Lists.
    const list = await authed(app, cs).get('/api/v1/creator/orders?q=priya').expect(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({ number: 'ORD-000001', buyer: { fullName: 'Priya Buyer' } });
    const tx = await authed(app, cs).get('/api/v1/creator/transactions').expect(200);
    expect(tx.body.data.map((p: any) => p.status)).toEqual(['CAPTURED']);
    expect((await authed(app, buyer.s).get('/api/v1/learn/orders').expect(200)).body.data).toHaveLength(1);
  });

  it('webhook-only payment, invalid signatures, failure and retry, amount mismatch, reconciliation, 100% coupon', async () => {
    const c = await academy(app);
    const cs = c.session;
    const course = await paidCourse(app, cs, 'Webhook course', 500);
    const acc = (await authed(app, cs).put('/api/v1/creator/payments/razorpay').send({ keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET }).expect(200)).body.data;
    const webhooks = app.get(WebhooksService);
    const buy = async () => {
      const b = await student(app, c.tenant.slug);
      const o = (await authed(app, b.s).post('/api/v1/learn/checkout').send({ courseId: course.id, billing: { name: 'Web Buyer' } }).expect(201)).body.data;
      const p = (await authed(app, b.s).post(`/api/v1/learn/orders/${o.id}/pay`).expect(200)).body.data;
      return { ...b, order: o, rzp: p.checkout.orderId as string };
    };

    // 1) Buyer closes the tab after paying; the webhook fulfils.
    const a = await buy();
    const r1 = sim.pay(a.rzp);
    const bad = sim.webhook('not-the-secret', 'payment.captured', { id: r1.razorpay_payment_id, order_id: a.rzp });
    await api(app).post(`/api/v1/webhooks/razorpay/${acc.id}`).set(bad.headers).send(bad.body).expect(401);
    await api(app).post('/api/v1/webhooks/razorpay/ckxxxxxxxxxxxxxxxxxxxxxxx').set(bad.headers).send(bad.body).expect(404);
    const good = sim.webhook(WEBHOOK_SECRET, 'payment.captured', { id: r1.razorpay_payment_id, order_id: a.rzp });
    await api(app).post(`/api/v1/webhooks/razorpay/${acc.id}`).set(good.headers).send(good.body).expect(200);
    const ev = await prisma.webhookEvent.findFirstOrThrow({ where: { eventId: good.headers['x-razorpay-event-id'] } });
    expect(ev).toMatchObject({ status: 'RECEIVED', tenantId: c.tenant.id });
    expect(await webhooks.process(ev.id)).toBe('fulfilled');
    expect((await authed(app, a.s).get(`/api/v1/learn/orders/${a.order.id}`)).body.data.status).toBe('PAID');
    expect(await prisma.webhookEvent.findUniqueOrThrow({ where: { id: ev.id } })).toMatchObject({ status: 'PROCESSED' });

    // 2) Declined, then a retry with a fresh Razorpay order succeeds.
    const b = await buy();
    const declined = sim.pay(b.rzp, { status: 'failed' });
    const f = (await authed(app, b.s).post(`/api/v1/learn/orders/${b.order.id}/confirm`).send({ razorpay_order_id: b.rzp }).expect(200)).body.data;
    expect(f).toMatchObject({ status: 'FAILED', failureReason: 'Payment declined by bank' });
    expect(declined.razorpay_payment_id).toBeTruthy();
    const retry = (await authed(app, b.s).post(`/api/v1/learn/orders/${b.order.id}/pay`).expect(200)).body.data;
    expect(retry.checkout.orderId).not.toBe(b.rzp);
    const ok = (await authed(app, b.s).post(`/api/v1/learn/orders/${b.order.id}/confirm`).send(sim.pay(retry.checkout.orderId)).expect(200)).body.data;
    expect(ok.status).toBe('PAID');
    expect(ok.payments.map((p: any) => p.status)).toEqual(['CAPTURED', 'FAILED']);

    // 3) Captured amount differs from the order: never fulfilled.
    const m = await buy();
    const mm = sim.pay(m.rzp, { amount: 100 });
    const mismatch = (await authed(app, m.s).post(`/api/v1/learn/orders/${m.order.id}/confirm`).send(mm).expect(200)).body.data;
    expect(mismatch.status).toBe('PAYMENT_INITIATED');
    expect(mismatch.payments[0]).toMatchObject({ status: 'FAILED', failureReason: expect.stringContaining('Amount mismatch') });
    expect(await prisma.enrollment.count({ where: { userId: (await prisma.order.findUniqueOrThrow({ where: { id: m.order.id } })).userId } })).toBe(0);

    // 4) No callback and no webhook (authorized only): reconciliation captures and fulfils.
    const r = await buy();
    sim.pay(r.rzp, { status: 'authorized' });
    await prisma.payment.updateMany({ where: { providerOrderId: r.rzp }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    const stats = await app.get(OrdersService).reconcile();
    expect(stats).toMatchObject({ fulfilled: 1, errors: 0 });
    expect((await authed(app, r.s).get(`/api/v1/learn/orders/${r.order.id}`)).body.data.status).toBe('PAID');
    expect([...sim.payments.values()].find((p) => p.order_id === r.rzp).status).toBe('captured');

    // 5) Unpaid orders expire.
    const e = await buy();
    await prisma.order.update({ where: { id: e.order.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await app.get(OrdersService).reconcile();
    expect((await authed(app, e.s).get(`/api/v1/learn/orders/${e.order.id}`)).body.data.status).toBe('EXPIRED');
    await authed(app, e.s).post(`/api/v1/learn/orders/${e.order.id}/pay`).expect(409);

    // 6) 100% coupon completes without Razorpay.
    await authed(app, cs).post('/api/v1/creator/coupons').send({ code: 'FREEPASS', type: 'PERCENT', value: 100, maxRedemptions: 1 }).expect(201);
    const calls = sim.calls.length;
    const fp = await student(app, c.tenant.slug);
    const free = (await authed(app, fp.s).post('/api/v1/learn/checkout').send({ courseId: course.id, couponCode: 'FREEPASS', billing: { name: 'Lucky' } }).expect(201)).body.data;
    expect(free).toMatchObject({ status: 'PAID', totalAmount: '0', invoiceNumber: expect.any(String) });
    expect(sim.calls.length).toBe(calls);
    const fp2 = await student(app, c.tenant.slug);
    const exhausted = await authed(app, fp2.s).post('/api/v1/learn/checkout/quote').send({ courseId: course.id, couponCode: 'FREEPASS' }).expect(422);
    expect(exhausted.body.error.message).toBe('This coupon has been fully used');
    const cp = (await authed(app, cs).get('/api/v1/creator/coupons').expect(200)).body.data[0];
    expect(cp).toMatchObject({ code: 'FREEPASS', state: 'EXHAUSTED', redemptionCount: 1 });
    await authed(app, cs).patch(`/api/v1/creator/coupons/${cp.id}`).send({ value: 50 }).expect(409);
  });

  it('refunds: partial, over-refund, pending → webhook, full with access revoked; finance views; isolation', async () => {
    const c = await academy(app);
    const cs = c.session;
    const course = await paidCourse(app, cs, 'Refund course', 1000);
    const acc = (await authed(app, cs).put('/api/v1/creator/payments/razorpay').send({ keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET }).expect(200)).body.data;
    const buy = async () => {
      const b = await student(app, c.tenant.slug);
      const o = (await authed(app, b.s).post('/api/v1/learn/checkout').send({ courseId: course.id, billing: { name: 'Refund Buyer' } }).expect(201)).body.data;
      const p = (await authed(app, b.s).post(`/api/v1/learn/orders/${o.id}/pay`).expect(200)).body.data;
      await authed(app, b.s).post(`/api/v1/learn/orders/${o.id}/confirm`).send(sim.pay(p.checkout.orderId)).expect(200);
      return { ...b, order: o };
    };

    // Unpaid orders cannot be refunded; staff without refunds.manage cannot refund (checked in isolation suite).
    const a = await buy();
    await authed(app, cs).post(`/api/v1/creator/orders/${a.order.id}/refunds`).send({ amount: 1000.01 }).expect(422);
    const part = (await authed(app, cs).post(`/api/v1/creator/orders/${a.order.id}/refunds`).send({ amount: 400, reason: 'Partial goodwill' }).expect(201)).body.data;
    expect(part).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedAmount: '400' });
    expect(part.refunds[0]).toMatchObject({ status: 'PROCESSED', amount: '400', revokeAccess: false });
    expect(part.ledger.filter((l: any) => l.type.startsWith('REFUND') || l.type.endsWith('REVERSAL')).map((l: any) => [l.type, l.amount])).toEqual([['REFUND', '-400'], ['COMMISSION_REVERSAL', '20']]);
    await authed(app, cs).post(`/api/v1/creator/orders/${a.order.id}/refunds`).send({ amount: 600.5 }).expect(422);
    expect((await lastEmail(app, a.email))!.tag).toBe('refund-issued');
    // Access stays after a partial refund.
    await authed(app, a.s).get(`/api/v1/learn/courses/${course.id}/player`).expect(200);

    // Pending refund settles through the webhook; full refund with revoke ends access.
    const b = await buy();
    sim.refundMode = 'pending';
    const pending = (await authed(app, cs).post(`/api/v1/creator/orders/${b.order.id}/refunds`).send({ reason: 'Changed mind', revokeAccess: true }).expect(201)).body.data;
    expect(pending.status).toBe('PAID');
    expect(pending.refunds[0]).toMatchObject({ status: 'PENDING', amount: '1000', revokeAccess: true });
    const rf = sim.refunds.get(pending.refunds[0].providerRefundId);
    rf.status = 'processed';
    const wh = sim.webhook(WEBHOOK_SECRET, 'refund.processed', { id: rf.id, payment_id: rf.payment_id, status: 'processed', amount: rf.amount });
    await api(app).post(`/api/v1/webhooks/razorpay/${acc.id}`).set(wh.headers).send(wh.body).expect(200);
    const ev = await prisma.webhookEvent.findFirstOrThrow({ where: { eventId: wh.headers['x-razorpay-event-id'] } });
    expect(await app.get(WebhooksService).process(ev.id)).toBe('processed');
    sim.refundMode = 'processed';
    const done = (await authed(app, cs).get(`/api/v1/creator/orders/${b.order.id}`)).body.data;
    expect(done).toMatchObject({ status: 'REFUNDED', refundedAmount: '1000' });
    expect(done.payments[0].status).toBe('REFUNDED');
    await authed(app, b.s).get(`/api/v1/learn/courses/${course.id}/player`).expect(403);
    await authed(app, cs).post(`/api/v1/creator/orders/${b.order.id}/refunds`).send({}).expect(409);

    // Summary nets refunds and reversals: gross 2000, refunds 1400, commission 100 − 70 = 30.
    const s = (await authed(app, cs).get('/api/v1/creator/orders/summary')).body.data.totals[0];
    expect(s).toMatchObject({ gross: '2000.00', refunds: '1400.00', platformCommission: '30.00' });

    // Gateway with captured payments cannot be deleted (refunds must keep working); pausing hides checkout.
    await authed(app, cs).delete('/api/v1/creator/payments/razorpay').expect(409);
    await authed(app, cs).patch('/api/v1/creator/payments/razorpay').send({ isActive: false }).expect(200);
    expect((await api(app).get('/api/v1/public/site').set('Host', tenantHost(c.tenant.slug))).body.data.paymentsEnabled).toBe(false);
    const late = await student(app, c.tenant.slug);
    await authed(app, late.s).post('/api/v1/learn/checkout').send({ courseId: course.id, billing: { name: 'Late' } }).expect(409);

    // Another academy sees none of this.
    const other = await academy(app);
    await authed(app, other.session).get(`/api/v1/creator/orders/${a.order.id}`).expect(404);
    await authed(app, other.session).post(`/api/v1/creator/orders/${a.order.id}/refunds`).send({}).expect(404);
    expect((await authed(app, other.session).get('/api/v1/creator/orders')).body.meta.total).toBe(0);
    expect((await authed(app, other.session).get('/api/v1/creator/payments/razorpay')).body.data.configured).toBe(false);

    // Platform finance: support admins lack finance access; finance admins see all academies.
    const support = await adminWithRoles(app, ['SUPPORT_ADMIN']);
    await authed(app, support.session).get('/api/v1/platform/finance/overview').expect(403);
    const fin = await adminWithRoles(app, ['FINANCE_ADMIN']);
    const ov = (await authed(app, fin.session).get('/api/v1/platform/finance/overview').expect(200)).body.data;
    expect(ov.paidOrders).toBeGreaterThanOrEqual(2);
    expect(ov.gmv.find((g: any) => g.currency === 'INR').amount).toBeGreaterThanOrEqual(2000);
    const txs = await authed(app, fin.session).get('/api/v1/platform/finance/transactions?status=REFUNDED').expect(200);
    expect(txs.body.data.some((t: any) => t.tenant?.id === c.tenant.id)).toBe(true);
  });
});
