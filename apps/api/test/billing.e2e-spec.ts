import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { BillingService } from '../src/modules/billing/billing.service.js';
import { adminWithRoles, api, authed, createTestApp, lastEmail, registerCreator, resetDatabase, superAdmin, tenantHost } from './helpers.js';
import { RazorpaySim } from './razorpay-sim.js';

const KEY_ID = 'rzp_test_PlatformKey1234';
const KEY_SECRET = 'platform_key_secret';
const WEBHOOK_SECRET = 'platform_webhook_secret';
const DAY = 86_400_000;

describe('SaaS plan billing (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let billing: BillingService;
  let sim: RazorpaySim;
  let growthMonthly: string;
  let proMonthly: string;

  async function academy() {
    const c = await registerCreator(app);
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    return c;
  }
  const current = (tenantId: string) => prisma.subscription.findFirstOrThrow({ where: { tenantId, currentKey: 'current' } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    billing = app.get(BillingService);
    await resetDatabase(app);
    sim = new RazorpaySim().install(app);
    sim.keys.set(KEY_ID, KEY_SECRET);
    const growth = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { code: 'growth' }, include: { prices: true } });
    const pro = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { code: 'pro' }, include: { prices: true } });
    growthMonthly = growth.prices.find((p) => p.interval === 'MONTH' && p.currency === 'INR')!.id;
    proMonthly = pro.prices.find((p) => p.interval === 'MONTH' && p.currency === 'INR')!.id;
  });
  afterAll(async () => app?.close());

  it('plan purchase through the platform Razorpay account, upgrade credit, renewal → past due → expired → reactivated by webhook', async () => {
    const c = await academy();
    const cs = c.session;
    const tenantId = c.tenant.id;
    expect((await current(tenantId)).status).toBe('TRIALING');

    // Without platform keys, plans are visible but cannot be bought online.
    const before = (await authed(app, cs).get('/api/v1/creator/billing/plans').expect(200)).body.data;
    expect(before).toMatchObject({ paymentsEnabled: false, currency: 'INR', current: { status: 'TRIALING' } });
    expect(before.plans.map((p: any) => p.code)).toEqual(['trial', 'growth', 'pro']);
    const blocked = await authed(app, cs).post('/api/v1/creator/billing/checkout').send({ planPriceId: growthMonthly }).expect(409);
    expect(blocked.body.error.code).toBe('INTEGRATION_NOT_CONFIGURED');

    // Super admin configures the platform account and GST; secrets are masked.
    const root = await superAdmin(app);
    await authed(app, root.session).put('/api/v1/platform/settings').send({ items: [
      { key: 'payments.razorpayKeyId', value: KEY_ID }, { key: 'payments.razorpayKeySecret', value: KEY_SECRET }, { key: 'payments.razorpayWebhookSecret', value: WEBHOOK_SECRET },
      { key: 'tax.gstin', value: '27AAACP1234Q1Z5' }, { key: 'tax.defaultGstRate', value: 18 }, { key: 'billing.legalName', value: 'Platform Pvt Ltd' }, { key: 'billing.graceDays', value: 7 },
    ] }).expect(200);
    const settings = (await authed(app, root.session).get('/api/v1/platform/settings')).body.data;
    expect(JSON.stringify(settings)).not.toContain(KEY_SECRET);
    const gw = (await authed(app, root.session).get('/api/v1/platform/billing/gateway?verify=true').expect(200)).body.data;
    expect(gw).toMatchObject({ configured: true, status: 'VERIFIED', mode: 'TEST', hasWebhookSecret: true });
    expect(gw.webhookUrl).toMatch(/\/api\/v1\/webhooks\/razorpay\/platform$/);

    // Growth monthly: ₹2,999 + 18% GST.
    const quote = (await authed(app, cs).post('/api/v1/creator/billing/quote').send({ planPriceId: growthMonthly }).expect(200)).body.data;
    expect(quote).toMatchObject({ plan: { name: 'Growth' }, credit: '0.00', tax: '539.82', total: '3538.82', taxRate: 18, paymentsEnabled: true });
    const inv = (await authed(app, cs).post('/api/v1/creator/billing/checkout').send({ planPriceId: growthMonthly }).expect(201)).body.data;
    expect(inv).toMatchObject({ kind: 'PLAN', status: 'OPEN', number: null, totalAmount: '3538.82' });
    const pay = (await authed(app, cs).post(`/api/v1/creator/billing/invoices/${inv.id}/pay`).expect(200)).body.data;
    expect(pay.checkout).toMatchObject({ keyId: KEY_ID, amount: 353882, currency: 'INR', name: 'Platform Pvt Ltd' });
    const r = sim.pay(pay.checkout.orderId);
    await authed(app, cs).post(`/api/v1/creator/billing/invoices/${inv.id}/confirm`).send({ ...r, razorpay_signature: 'b'.repeat(64) }).expect(422);
    const paid = (await authed(app, cs).post(`/api/v1/creator/billing/invoices/${inv.id}/confirm`).send(r).expect(200)).body.data;
    expect(paid).toMatchObject({ status: 'PAID', paidVia: 'RAZORPAY', reference: r.razorpay_payment_id, number: expect.stringMatching(/^PLT\/\d{4}-\d{2}\/00001$/) });
    let sub = await current(tenantId);
    expect(sub).toMatchObject({ status: 'ACTIVE', planPriceId: growthMonthly, source: 'billing' });
    expect(sub.currentPeriodEnd!.getTime() - sub.currentPeriodStart.getTime()).toBeGreaterThan(27 * DAY);
    expect((await authed(app, cs).get('/api/v1/creator/billing')).body.data.entitlements).toMatchObject({ active: true, planName: 'Growth' });
    expect((await lastEmail(app, c.body.email))!.tag).toBe('billing-receipt');
    await authed(app, cs).post('/api/v1/creator/billing/checkout').send({ planPriceId: growthMonthly }).expect(409); // already on it
    const pdf = await authed(app, cs).get(`/api/v1/creator/billing/invoices/${inv.id}/pdf`).buffer(true).expect(200);
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');

    // Upgrade mid-period: unused Growth time is credited.
    const up = (await authed(app, cs).post('/api/v1/creator/billing/quote').send({ planPriceId: proMonthly }).expect(200)).body.data;
    expect(Number(up.credit)).toBeGreaterThan(2990);
    expect(Number(up.credit)).toBeLessThanOrEqual(2999);
    expect(up.creditNote).toBe('Credit for unused time on Growth');

    // Renewal invoice 7 days ahead, once.
    await prisma.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: new Date(Date.now() + 3 * DAY) } });
    expect((await billing.runCycle()).renewalsCreated).toBe(1);
    expect((await billing.runCycle()).renewalsCreated).toBe(0);
    const renewal = await prisma.billingInvoice.findFirstOrThrow({ where: { tenantId, kind: 'RENEWAL' } });
    expect(renewal).toMatchObject({ status: 'OPEN', totalAmount: expect.anything(), subscriptionId: sub.id });
    expect(renewal.totalAmount.toString()).toBe('3538.82');
    expect((await lastEmail(app, c.body.email))!.tag).toBe('billing-renewal');

    // Unpaid at period end → past due (still entitled) → expired after grace (not entitled).
    await prisma.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: new Date(Date.now() - 60_000) } });
    expect((await billing.runCycle()).pastDue).toBe(1);
    sub = await current(tenantId);
    expect(sub.status).toBe('PAST_DUE');
    expect(sub.graceEndsAt!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'Still allowed in grace' }).expect(201);
    await prisma.subscription.update({ where: { id: sub.id }, data: { graceEndsAt: new Date(Date.now() - 1000) } });
    expect((await billing.runCycle()).expired).toBe(1);
    const denied = await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'Blocked' }).expect(402);
    expect(denied.body.error.code).toBe('NO_ACTIVE_PLAN');
    expect((await lastEmail(app, c.body.email))!.tag).toBe('billing-expired');

    // Paying the renewal (buyer closed the tab; webhook arrives) restores the plan from now.
    const rp = (await authed(app, cs).post(`/api/v1/creator/billing/invoices/${renewal.id}/pay`).expect(200)).body.data;
    const rr = sim.pay(rp.checkout.orderId);
    const forged = sim.webhook('wrong', 'payment.captured', { id: rr.razorpay_payment_id, order_id: rp.checkout.orderId });
    await api(app).post('/api/v1/webhooks/razorpay/platform').set(forged.headers).send(forged.body).expect(401);
    const wh = sim.webhook(WEBHOOK_SECRET, 'payment.captured', { id: rr.razorpay_payment_id, order_id: rp.checkout.orderId });
    await api(app).post('/api/v1/webhooks/razorpay/platform').set(wh.headers).send(wh.body).expect(200);
    expect((await api(app).post('/api/v1/webhooks/razorpay/platform').set(wh.headers).send(wh.body).expect(200)).body.data.duplicate).toBe(true);
    const ev = await prisma.webhookEvent.findFirstOrThrow({ where: { eventId: wh.headers['x-razorpay-event-id'] } });
    expect(await billing.processWebhook(ev.id, rp.checkout.orderId)).toBe('paid');
    sub = await current(tenantId);
    expect(sub).toMatchObject({ status: 'ACTIVE', graceEndsAt: null });
    expect(sub.currentPeriodStart.getTime()).toBeGreaterThan(Date.now() - 60_000);
    await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'Allowed again' }).expect(201);

    // Cancel at period end → canceled when the period ends; open renewals are voided.
    await authed(app, cs).post('/api/v1/creator/billing/cancellation').send({ cancelAtPeriodEnd: true }).expect(200);
    await prisma.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    expect((await billing.runCycle()).canceled).toBe(1);
    expect((await current(tenantId)).status).toBe('CANCELED');

    // Invoices are private to the academy.
    const other = await academy();
    await authed(app, other.session).get(`/api/v1/creator/billing/invoices/${inv.id}`).expect(404);
    await authed(app, other.session).post(`/api/v1/creator/billing/invoices/${inv.id}/pay`).expect(404);
    expect((await authed(app, other.session).get('/api/v1/creator/billing/invoices')).body.data).toEqual([]);
  });

  it('trial reminder and expiry; monthly commission invoices with carry-over; admin offline payment and void', async () => {
    const c = await academy();
    const tenantId = c.tenant.id;
    const sub = await current(tenantId);
    await prisma.subscription.update({ where: { id: sub.id }, data: { trialEndsAt: new Date(Date.now() + 2 * DAY) } });
    await billing.runCycle();
    expect((await lastEmail(app, c.body.email))!.tag).toBe('billing-trial-ending');
    await prisma.subscription.update({ where: { id: sub.id }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    expect((await billing.runCycle()).trialsEnded).toBeGreaterThanOrEqual(1);
    expect((await current(tenantId)).status).toBe('EXPIRED');
    // An academy without an active plan stops taking course payments.
    expect((await api(app).get('/api/v1/public/site').set('Host', tenantHost(c.tenant.slug))).body.data.paymentsEnabled).toBe(false);

    // Commission from last month's sales: ₹60 − ₹15 reversal = ₹45 + 18% GST, but the ₹100 minimum carries it over...
    const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 10));
    await prisma.ledgerEntry.createMany({ data: [
      { tenantId, type: 'PLATFORM_COMMISSION', amount: '-60', currency: 'INR', createdAt: lastMonth },
      { tenantId, type: 'COMMISSION_REVERSAL', amount: '15', currency: 'INR', createdAt: lastMonth },
    ] });
    await billing.runCycle();
    expect(await prisma.billingInvoice.count({ where: { tenantId, kind: 'COMMISSION' } })).toBe(0);
    // ...until more accrues.
    await prisma.ledgerEntry.create({ data: { tenantId, type: 'PLATFORM_COMMISSION', amount: '-80', currency: 'INR', createdAt: new Date(lastMonth.getTime() + DAY) } });
    expect((await billing.runCycle()).commissionInvoices).toBe(1);
    expect((await billing.runCycle()).commissionInvoices).toBe(0);
    const ci = await prisma.billingInvoice.findFirstOrThrow({ where: { tenantId, kind: 'COMMISSION' } });
    expect([ci.subtotalAmount.toString(), ci.taxAmount.toString(), ci.totalAmount.toString()]).toEqual(['125', '22.5', '147.5']);
    expect(ci.dueAt.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    expect((await lastEmail(app, c.body.email))!.tag).toBe('billing-commission');

    // Finance admins see everything and can record a bank transfer; support admins cannot.
    const support = await adminWithRoles(app, ['SUPPORT_ADMIN']);
    await authed(app, support.session).get('/api/v1/platform/billing/invoices').expect(403);
    const fin = await adminWithRoles(app, ['FINANCE_ADMIN']);
    const list = await authed(app, fin.session).get(`/api/v1/platform/billing/invoices?status=OPEN&tenantId=${tenantId}`).expect(200);
    expect(list.body.data.map((i: any) => i.kind)).toEqual(['COMMISSION']);
    const subs = await authed(app, fin.session).get('/api/v1/platform/billing/subscriptions?status=EXPIRED').expect(200);
    expect(subs.body.data.some((s: any) => s.tenant.id === tenantId)).toBe(true);
    const offline = (await authed(app, fin.session).post(`/api/v1/platform/billing/invoices/${ci.id}/record-payment`).send({ reference: 'UTR123456' }).expect(200)).body.data;
    expect(offline).toMatchObject({ status: 'PAID', paidVia: 'OFFLINE', reference: 'UTR123456', number: expect.stringMatching(/^PLT\//) });
    await authed(app, fin.session).post(`/api/v1/platform/billing/invoices/${ci.id}/void`).send({ reason: 'Mistake' }).expect(409);

    // Next month's commission starts after the last invoiced period.
    await prisma.ledgerEntry.create({ data: { tenantId, type: 'PLATFORM_COMMISSION', amount: '-500', currency: 'INR', createdAt: new Date() } });
    await billing.runCycle();
    expect(await prisma.billingInvoice.count({ where: { tenantId, kind: 'COMMISSION' } })).toBe(1);
    const nextMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 2));
    expect((await billing.runCycle(nextMonth)).commissionInvoices).toBeGreaterThanOrEqual(1);
    const second = await prisma.billingInvoice.findFirstOrThrow({ where: { tenantId, kind: 'COMMISSION', status: 'OPEN' } });
    expect(second.subtotalAmount.toString()).toBe('500');
    await authed(app, fin.session).post(`/api/v1/platform/billing/invoices/${second.id}/void`).send({ reason: 'Waived' }).expect(200);
  });
});
