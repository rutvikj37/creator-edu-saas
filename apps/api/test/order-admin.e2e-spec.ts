import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { api, authed, createTestApp, parseSession, registerCreator, resetDatabase, tenantHost, uniqueEmail } from './helpers.js';
import { RazorpaySim } from './razorpay-sim.js';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const KEY_ID = 'rzp_test_OrderAdmin1234';
const KEY_SECRET = 'sim_order_admin_secret';

describe('Transaction details, edit order and settlements (e2e)', () => {
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

  it('comments on an order, edits buyer GST details (invoice follows), validates affiliates, and lists Razorpay settlements', async () => {
    const c = await registerCreator(app);
    const cs = c.session;
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    // No Razorpay yet: earnings only, not connected.
    expect((await authed(app, cs).get('/api/v1/creator/settlements').expect(200)).body.data).toMatchObject({ connected: false, items: [] });
    await authed(app, cs).put('/api/v1/creator/payments/razorpay').send({ keyId: KEY_ID, keySecret: KEY_SECRET }).expect(200);
    const co = (await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'Tally ERP' }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
    const l = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Intro', type: 'TEXT' }).expect(201)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}/lessons/${l.id}`).send({ content: doc('Hi'), isPublished: true }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}`).send({ isFree: false, priceAmount: 1000 }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/publish`).send({}).expect(200);
    const host = tenantHost(c.tenant.slug);
    const s = parseSession(await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: 'Himanshi Buyer', email: uniqueEmail('oa'), password: 'student-password-1' }).expect(201), host);
    const o = (await authed(app, s).post('/api/v1/learn/checkout').send({ courseId: co.id, billing: { name: 'Himanshi Buyer' } }).expect(201)).body.data;
    const p = (await authed(app, s).post(`/api/v1/learn/orders/${o.id}/pay`).expect(200)).body.data;
    await authed(app, s).post(`/api/v1/learn/orders/${o.id}/confirm`).send(sim.pay(p.checkout.orderId)).expect(200);

    // Comments (internal).
    await authed(app, cs).post(`/api/v1/creator/orders/${o.id}/comments`).send({ body: '   ' }).expect(422);
    const comments = (await authed(app, cs).post(`/api/v1/creator/orders/${o.id}/comments`).send({ body: 'Called the learner, all good.' }).expect(201)).body.data;
    expect(comments).toEqual([expect.objectContaining({ body: 'Called the learner, all good.', author: 'Asha Creator' })]);
    expect((await authed(app, cs).get(`/api/v1/creator/orders/${o.id}/comments`).expect(200)).body.data).toHaveLength(1);

    // Edit order: state, GSTIN and GST address go on the order and the invoice.
    await authed(app, cs).patch(`/api/v1/creator/orders/${o.id}`).send({ gstin: 'BAD' }).expect(422);
    const edited = (await authed(app, cs).patch(`/api/v1/creator/orders/${o.id}`).send({ state: 'Karnataka', gstin: '29abcde1234f1z5', gstAddress: '12 MG Road, Bengaluru' }).expect(200)).body.data;
    expect(edited.billing).toMatchObject({ state: 'Karnataka', gstin: '29ABCDE1234F1Z5', address: '12 MG Road, Bengaluru' });
    expect((await prisma.invoice.findFirstOrThrow({ where: { orderId: o.id } })).buyer).toMatchObject({ state: 'Karnataka', gstin: '29ABCDE1234F1Z5', address: '12 MG Road, Bengaluru' });
    await authed(app, cs).patch(`/api/v1/creator/orders/${o.id}`).send({ affiliateCode: 'NOSUCHCODE' }).expect(422);

    // Settlements from Razorpay with a per-settlement transaction count.
    const now = Math.floor(Date.now() / 1000);
    sim.settlements = [
      { id: 'setl_A1', entity: 'settlement', amount: 95000, fees: 2000, tax: 360, utr: 'UTR778899', status: 'processed', created_at: now - 3600 },
      { id: 'setl_B2', entity: 'settlement', amount: 5000, fees: 0, tax: 0, utr: null, status: 'created', created_at: now - 7200 },
    ];
    sim.recon = [{ settlement_id: 'setl_A1', type: 'payment' }, { settlement_id: 'setl_A1', type: 'payment' }, { settlement_id: 'setl_A1', type: 'settlement' }];
    const st = (await authed(app, cs).get('/api/v1/creator/settlements').expect(200)).body.data;
    const fee = Number((await prisma.payment.findFirstOrThrow({ where: { orderId: o.id } })).feeAmount ?? 0);
    expect(st).toMatchObject({ connected: true, totals: { earnings: '1000.00', settled: '950.00', toBeSettled: (1000 - fee - 950).toFixed(2) } });
    expect(st.items.map((i: any) => [i.id, i.transactions])).toEqual([['setl_A1', 2], ['setl_B2', null]]);
    expect((await authed(app, cs).get('/api/v1/creator/settlements?q=utr778').expect(200)).body.data.items.map((i: any) => i.id)).toEqual(['setl_A1']);
    const csv = await authed(app, cs).get('/api/v1/creator/settlements.csv').expect(200);
    expect(csv.text).toContain('setl_A1');

    // Another academy sees none of it.
    const other = await registerCreator(app);
    await authed(app, other.session).get(`/api/v1/creator/orders/${o.id}/comments`).expect(404);
    await authed(app, other.session).patch(`/api/v1/creator/orders/${o.id}`).send({ state: 'Goa' }).expect(404);
  });
});
