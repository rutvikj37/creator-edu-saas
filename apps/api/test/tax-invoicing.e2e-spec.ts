import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { financialYear } from '../src/modules/commerce/invoice-number.js';
import { api, authed, createTestApp, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';
import { RazorpaySim } from './razorpay-sim.js';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const KEY_ID = 'rzp_test_TaxInvoice123';
const KEY_SECRET = 'sim_tax_invoice_secret';

describe('Tax and invoicing settings (e2e)', () => {
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

  it('GST details, place of supply, serial start, invoice note, LUT exports at 0%, GSTIN at checkout, and turning invoices off', async () => {
    const c = await registerCreator(app);
    const cs = c.session;
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    await authed(app, cs).put('/api/v1/creator/payments/razorpay').send({ keyId: KEY_ID, keySecret: KEY_SECRET }).expect(200);
    const co = (await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'GST Basics' }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
    const l = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Intro', type: 'TEXT' }).expect(201)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}/lessons/${l.id}`).send({ content: doc('Hi'), isPublished: true }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}`).send({ isFree: false, priceAmount: 1000 }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/publish`).send({}).expect(200);
    const fy = financialYear(new Date());

    expect((await authed(app, cs).get('/api/v1/creator/academy/business').expect(200)).body.data).toMatchObject({ nextInvoiceNumber: `INV/${fy}/00001`, invoicesEnabled: true, gstInputCredit: true, exportsUnderLut: false });
    await authed(app, cs).put('/api/v1/creator/academy/business').send({ invoiceStartNumber: 0 }).expect(422);
    const saved = (await authed(app, cs).put('/api/v1/creator/academy/business').send({
      gstRegistered: true, gstin: '29ABCDE1234F1Z5', state: 'Karnataka', taxRate: 18, pricesIncludeTax: false, invoicePrefix: 'SPE', invoiceStartNumber: 10001,
      taxDetails: 'SAC 999293 · LUT ARN AD290000000001', invoiceNote: 'Thank you for learning with us.', exportsUnderLut: true, gstInputCredit: false,
    }).expect(200)).body.data;
    expect(saved).toMatchObject({ state: 'Karnataka', invoiceStartNumber: 10001, exportsUnderLut: true });
    expect((await authed(app, cs).get('/api/v1/creator/academy/business')).body.data.nextInvoiceNumber).toBe(`SPE/${fy}/10001`);
    const host = tenantHost(c.tenant.slug);
    expect((await api(app).get('/api/v1/public/site').set('Host', host).expect(200)).body.data.gstInputCredit).toBe(false);

    async function buyer(name: string) {
      const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: name, email: uniqueEmail('tax'), password: 'student-password-1' }).expect(201);
      return parseSession(reg, host) as Session;
    }
    async function buy(s: Session, country: string) {
      const o = (await authed(app, s).post('/api/v1/learn/checkout').send({ courseId: co.id, billing: { name: 'Tax Buyer', country } }).expect(201)).body.data;
      const p = (await authed(app, s).post(`/api/v1/learn/orders/${o.id}/pay`).expect(200)).body.data;
      await authed(app, s).post(`/api/v1/learn/orders/${o.id}/confirm`).send(sim.pay(p.checkout.orderId)).expect(200);
      return o;
    }

    // Indian buyer: 18% GST added on top; first invoice uses the chosen serial and carries the details and note.
    const inBuyer = await buyer('India Buyer');
    expect((await authed(app, inBuyer).post('/api/v1/learn/checkout/quote').send({ courseId: co.id, country: 'IN' }).expect(200)).body.data).toMatchObject({ tax: '180.00', total: '1180.00', taxInclusive: false });
    const o1 = await buy(inBuyer, 'IN');
    const inv1 = await prisma.invoice.findFirstOrThrow({ where: { orderId: o1.id } });
    expect(inv1.number).toBe(`SPE/${fy}/10001`);
    expect(inv1.seller).toMatchObject({ gstin: '29ABCDE1234F1Z5', state: 'Karnataka', details: 'SAC 999293 · LUT ARN AD290000000001', note: 'Thank you for learning with us.' });
    const pdf = await authed(app, inBuyer).get(`/api/v1/learn/orders/${o1.id}/invoice`).buffer(true).parse((r, cb) => { const b: Buffer[] = []; r.on('data', (d: Buffer) => b.push(d)); r.on('end', () => cb(null, Buffer.concat(b))); }).expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    // Buyer outside India with LUT: zero-rated, invoice says so.
    const usBuyer = await buyer('US Buyer');
    expect((await authed(app, usBuyer).post('/api/v1/learn/checkout/quote').send({ courseId: co.id, country: 'US' }).expect(200)).body.data).toMatchObject({ tax: '0.00', total: '1000.00' });
    const o2 = await buy(usBuyer, 'US');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o2.id } })).totalAmount.toString()).toBe('1000');
    const inv2 = await prisma.invoice.findFirstOrThrow({ where: { orderId: o2.id } });
    expect(inv2.number).toBe(`SPE/${fy}/10002`);
    expect(inv2.totals).toMatchObject({ zeroRated: true, tax: '0' });

    // Without LUT, exports are taxed like domestic sales.
    await authed(app, cs).put('/api/v1/creator/academy/business').send({ exportsUnderLut: false }).expect(200);
    const usBuyer2 = await buyer('Another US Buyer');
    expect((await authed(app, usBuyer2).post('/api/v1/learn/checkout/quote').send({ courseId: co.id, country: 'US' }).expect(200)).body.data.tax).toBe('180.00');

    // Invoices off: the order is paid but no invoice is issued, and the download says why.
    await authed(app, cs).put('/api/v1/creator/academy/business').send({ invoicesEnabled: false }).expect(200);
    const third = await buyer('No Invoice Buyer');
    const o3 = await buy(third, 'IN');
    expect(await prisma.invoice.count({ where: { orderId: o3.id } })).toBe(0);
    const r = await authed(app, third).get(`/api/v1/learn/orders/${o3.id}/invoice`).expect(404);
    expect(r.body.error.message).toMatch(/does not issue invoices/);
    expect((await authed(app, cs).get('/api/v1/creator/academy/business')).body.data.nextInvoiceNumber).toBe(`SPE/${fy}/10003`);
  });
});
