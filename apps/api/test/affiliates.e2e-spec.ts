import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { AffiliatesService } from '../src/modules/affiliates/affiliates.service.js';
import { EntitlementsService } from '../src/modules/subscriptions/entitlements.service.js';
import { api, authed, createTestApp, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';
import { RazorpaySim } from './razorpay-sim.js';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const KEY_ID = 'rzp_test_AffiliateKey12';
const KEY_SECRET = 'affiliate_sim_secret';

describe('Affiliates (e2e)', () => {
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
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: name, email: uniqueEmail('af'), password: 'student-password-1' }).expect(201);
    const s = parseSession(reg, host);
    return { s, id: (await authed(app, s).get('/api/v1/auth/me')).body.data.user.id as string };
  }
  async function buy(s: Session, courseId: string, affiliateCode?: string) {
    const o = (await authed(app, s).post('/api/v1/learn/checkout').send({ courseId, affiliateCode, billing: { name: 'Buyer' } }).expect(201)).body.data;
    const p = (await authed(app, s).post(`/api/v1/learn/orders/${o.id}/pay`).expect(200)).body.data;
    await authed(app, s).post(`/api/v1/learn/orders/${o.id}/confirm`).send(sim.pay(p.checkout.orderId)).expect(200);
    return o;
  }

  it('program → join/approve → referral purchase → refunds adjust → approval → payout; no self-referral, no buyer PII', async () => {
    const c = await registerCreator(app);
    const cs = c.session;
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    expect((await authed(app, cs).get('/api/v1/creator/affiliates/program').expect(403)).body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    await prisma.tenantLimitOverride.create({ data: { tenantId: c.tenant.id, featureKey: 'affiliates', enabled: true, reason: 'test' } });
    await app.get(EntitlementsService).invalidate(c.tenant.id);

    await authed(app, cs).put('/api/v1/creator/payments/razorpay').send({ keyId: KEY_ID, keySecret: KEY_SECRET }).expect(200);
    const co = (await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'Referral course' }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
    const l = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Intro', type: 'TEXT' }).expect(201)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}/lessons/${l.id}`).send({ content: doc('Hi'), isPublished: true }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}`).send({ isFree: false, priceAmount: 1000 }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/publish`).send({}).expect(200);

    const promoter = await student(c.tenant.slug, 'Pooja Promoter');
    await authed(app, promoter.s).post('/api/v1/learn/affiliate/join').send({ acceptTerms: true }).expect(409); // program off
    await authed(app, cs).put('/api/v1/creator/affiliates/program').send({ enabled: true, defaultPercent: 20, holdDays: 7, cookieDays: 30 }).expect(200);
    const joined = (await authed(app, promoter.s).post('/api/v1/learn/affiliate/join').send({ acceptTerms: true, payoutDetails: 'pooja@upi' }).expect(200)).body.data;
    expect(joined.affiliate).toMatchObject({ status: 'PENDING', commissionPercent: 20 });
    const code = joined.affiliate.code;
    const host = tenantHost(c.tenant.slug);
    expect((await api(app).post('/api/v1/public/affiliates/click').set('Host', host).send({ code, path: '/courses/x' }).expect(200)).body.data.valid).toBe(false); // not approved yet
    const aff = (await authed(app, cs).get('/api/v1/creator/affiliates')).body.data[0];
    await authed(app, cs).patch(`/api/v1/creator/affiliates/${aff.id}`).send({ status: 'ACTIVE' }).expect(200);
    expect((await api(app).post('/api/v1/public/affiliates/click').set('Host', host).send({ code: code.toLowerCase(), path: '/courses/x' }).expect(200)).body.data).toEqual({ valid: true, cookieDays: 30 });

    // Self-referral earns nothing; a referred purchase earns 20% of the net sale.
    const self = await buy(promoter.s, co.id, code);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: self.id } })).affiliateId).toBeNull();
    const buyer = await student(c.tenant.slug, 'Bhavin Buyer');
    const order = await buy(buyer.s, co.id, code);
    const conv = await prisma.affiliateConversion.findFirstOrThrow({ where: { orderId: order.id } });
    expect([conv.status, conv.saleAmount.toString(), conv.commission.toString()]).toEqual(['PENDING', '1000', '200']);
    const ledger = (await authed(app, cs).get(`/api/v1/creator/orders/${order.id}`)).body.data.ledger;
    expect(ledger.find((x: any) => x.type === 'AFFILIATE_COMMISSION').amount).toBe('-200');

    // Two partial refunds scale the commission from the original sale (no compounding).
    await authed(app, cs).post(`/api/v1/creator/orders/${order.id}/refunds`).send({ amount: 250 }).expect(201);
    expect((await prisma.affiliateConversion.findUniqueOrThrow({ where: { id: conv.id } })).commission.toString()).toBe('150');
    await authed(app, cs).post(`/api/v1/creator/orders/${order.id}/refunds`).send({ amount: 250 }).expect(201);
    expect((await prisma.affiliateConversion.findUniqueOrThrow({ where: { id: conv.id } })).commission.toString()).toBe('100');
    const summary = (await authed(app, cs).get('/api/v1/creator/orders/summary')).body.data.totals[0];
    expect(summary.affiliateCommission).toBe('100.00');

    // A fully refunded referral is reversed.
    const buyer2 = await student(c.tenant.slug, 'Charu Buyer');
    const order2 = await buy(buyer2.s, co.id, code);
    await authed(app, cs).post(`/api/v1/creator/orders/${order2.id}/refunds`).send({}).expect(201);
    expect((await prisma.affiliateConversion.findFirstOrThrow({ where: { orderId: order2.id } })).status).toBe('REVERSED');

    // Approval after the hold period, then payout.
    await authed(app, cs).post(`/api/v1/creator/affiliates/${aff.id}/payouts`).send({ payoutRef: 'UTR1' }).expect(409);
    expect(await app.get(AffiliatesService).approveDue(new Date(Date.now() + 8 * 86_400_000))).toEqual({ approved: 1 });
    expect((await authed(app, cs).get('/api/v1/creator/affiliates')).body.data[0]).toMatchObject({ owed: '100.00', clicks: 1, conversions: 1 });
    expect((await authed(app, cs).post(`/api/v1/creator/affiliates/${aff.id}/payouts`).send({ payoutRef: 'UTR-778899' }).expect(200)).body.data).toEqual({ paid: 1 });

    // The affiliate's dashboard shows earnings but no buyer details.
    const me = (await authed(app, promoter.s).get('/api/v1/learn/affiliate').expect(200)).body.data;
    expect(me.stats).toMatchObject({ clicks: 1, conversions: 1, paid: '100.00', pending: '0.00' });
    expect(JSON.stringify(me)).not.toContain('Bhavin');
    expect(JSON.stringify(me)).not.toContain(order.id);

    // Isolation.
    const other = await registerCreator(app);
    await prisma.tenantLimitOverride.create({ data: { tenantId: other.tenant.id, featureKey: 'affiliates', enabled: true, reason: 'test' } });
    await app.get(EntitlementsService).invalidate(other.tenant.id);
    expect((await authed(app, other.session).get('/api/v1/creator/affiliates')).body.data).toEqual([]);
    await authed(app, other.session).patch(`/api/v1/creator/affiliates/${aff.id}`).send({ status: 'SUSPENDED' }).expect(404);
  });
});
