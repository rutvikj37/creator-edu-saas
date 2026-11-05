import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { EntitlementsService } from '../src/modules/subscriptions/entitlements.service.js';
import { api, authed, createTestApp, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';
import { RazorpaySim } from './razorpay-sim.js';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const KEY_ID = 'rzp_test_Analytics1234';
const KEY_SECRET = 'analytics_sim_secret';

function parseCsv(text: string) {
  expect(text.charCodeAt(0)).toBe(0xfeff);
  const rows = text.slice(1).split('\r\n').map((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.slice(0, -1).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')));
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

describe('Analytics, exports and GST report (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let sim: RazorpaySim;
  let c: Awaited<ReturnType<typeof registerCreator>>;
  let cs: Session;
  let course: { id: string; title: string };
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    sim = new RazorpaySim().install(app);
    sim.keys.set(KEY_ID, KEY_SECRET);
    c = await registerCreator(app);
    cs = c.session;
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    await authed(app, cs).put('/api/v1/creator/payments/razorpay').send({ keyId: KEY_ID, keySecret: KEY_SECRET }).expect(200);
    await authed(app, cs).put('/api/v1/creator/academy/business').send({ legalName: 'Asha Learning LLP', gstRegistered: true, gstin: '24ABCDE1234F1Z5', taxRate: 18, pricesIncludeTax: true, state: 'Gujarat' }).expect(200);
    course = (await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'GST course' }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${course.id}/curriculum`)).body.data[0].id;
    const l = (await authed(app, cs).post(`/api/v1/creator/courses/${course.id}/lessons`).send({ sectionId: sec, title: 'Intro', type: 'TEXT' }).expect(201)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}/lessons/${l.id}`).send({ content: doc('Hi'), isPublished: true }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}`).send({ isFree: false, priceAmount: 1180 }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${course.id}/publish`).send({}).expect(200);
  });
  afterAll(async () => app?.close());

  async function buy(name: string, billing: Record<string, string>) {
    const host = tenantHost(c.tenant.slug);
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: name, email: uniqueEmail('an'), password: 'student-password-1' }).expect(201);
    const s = parseSession(reg, host);
    const o = (await authed(app, s).post('/api/v1/learn/checkout').send({ courseId: course.id, billing: { name, ...billing } }).expect(201)).body.data;
    const p = (await authed(app, s).post(`/api/v1/learn/orders/${o.id}/pay`).expect(200)).body.data;
    await authed(app, s).post(`/api/v1/learn/orders/${o.id}/confirm`).send(sim.pay(p.checkout.orderId)).expect(200);
    return o;
  }

  it('GST report splits intra/inter-state, B2B/B2C, includes credit notes; exports are CSV-safe; overview from real data', async () => {
    await buy('Gujarat Buyer', { state: 'gujarat' }); // intra (state names compared loosely)
    const mh = await buy('Mumbai Buyer', { state: 'Maharashtra' }); // inter
    await buy('=HYPERLINK("x")', { gstin: '27AAACB1234C1Z5' }); // B2B, Maharashtra GSTIN → inter
    await buy('No State Buyer', {}); // unknown → supplier location → intra
    await authed(app, cs).post(`/api/v1/creator/orders/${mh.id}/refunds`).send({ amount: 590, reason: 'Partial' }).expect(201);

    const g = (await authed(app, cs).get('/api/v1/creator/analytics/gst').expect(200)).body.data;
    expect(g.sellerGstin).toBe('24ABCDE1234F1Z5');
    const inv = g.rows.filter((r: any) => r.type === 'INVOICE');
    expect(inv).toHaveLength(4);
    expect(inv[0]).toMatchObject({ customer: 'Gujarat Buyer', category: 'B2C', interState: false, rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0, total: 1180 });
    expect(inv[1]).toMatchObject({ customer: 'Mumbai Buyer', interState: true, igst: 180, cgst: 0, placeOfSupply: 'Maharashtra' });
    expect(inv[2]).toMatchObject({ category: 'B2B', gstin: '27AAACB1234C1Z5', interState: true, igst: 180, placeOfSupply: '27 (GSTIN)' });
    expect(inv[3]).toMatchObject({ interState: false, cgst: 90, sgst: 90, placeOfSupply: 'Gujarat' });
    const cn = g.rows.find((r: any) => r.type === 'CREDIT_NOTE');
    expect(cn).toMatchObject({ invoiceNumber: inv[1].invoiceNumber, total: -590, taxable: -500, igst: -90, cgst: 0, sgst: 0 });
    expect(g.summary).toEqual([{ currency: 'INR', rate: 18, documents: 5, taxable: 3500, igst: 270, cgst: 180, sgst: 180, total: 4130 }]);

    // CSV: BOM, formula cells neutralised, numbers as numbers.
    const csv = await authed(app, cs).get('/api/v1/creator/analytics/exports/gst.csv').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const rows = parseCsv(csv.text);
    expect(rows).toHaveLength(5);
    expect(rows[2]).toMatchObject({ Customer: `'=HYPERLINK("x")`, 'B2B/B2C': 'B2B', Supply: 'Inter-state', IGST: '180' });
    expect(rows[4]).toMatchObject({ 'Document type': 'Credit note', Total: '-590' });
    const orders = parseCsv((await authed(app, cs).get('/api/v1/creator/analytics/exports/orders.csv').expect(200)).text);
    expect(orders.map((o) => o.Status)).toEqual(['PAID', 'PARTIALLY_REFUNDED', 'PAID', 'PAID']);
    expect(orders[1]).toMatchObject({ Total: '1180', Refunded: '590', Items: 'GST course' });

    // Overview: money from the ledger, counts from enrolments and users, daily series in academy time.
    const o = (await authed(app, cs).get('/api/v1/creator/analytics/overview').expect(200)).body.data;
    expect(o.range).toMatchObject({ timezone: 'Asia/Kolkata', currency: 'INR' });
    expect(o.money.totals[0]).toMatchObject({ gross: '4720.00', refunds: '590.00' });
    expect(o.counts).toMatchObject({ newStudents: 4, enrollments: 4, paidOrders: 4 });
    expect(o.series).toHaveLength(30);
    expect(o.series.at(-1)).toMatchObject({ revenue: '4130.00', enrollments: 4, students: 4 });
    expect(o.topCourses).toEqual([{ courseId: course.id, title: 'GST course', sales: 4, revenue: '4720' }]);
    expect(o.enrollmentsBySource).toEqual({ PURCHASE: 4 });

    // A range with nothing in it, and bad ranges.
    const empty = (await authed(app, cs).get('/api/v1/creator/analytics/gst?from=2020-01-01&to=2020-01-31').expect(200)).body.data;
    expect(empty.rows).toEqual([]);
    await authed(app, cs).get('/api/v1/creator/analytics/overview?from=2026-02-01&to=2026-01-01').expect(422);
    await authed(app, cs).get('/api/v1/creator/analytics/overview?from=2020-01-01&to=2026-01-01').expect(422);
    await authed(app, cs).get('/api/v1/creator/analytics/overview?from=01-01-2026').expect(422);
  });

  it('advanced analytics and student exports need the plan feature; other academies see nothing', async () => {
    await authed(app, cs).get('/api/v1/creator/analytics/courses').expect(403);
    await authed(app, cs).get('/api/v1/creator/analytics/exports/students.csv').expect(403);
    await prisma.tenantLimitOverride.create({ data: { tenantId: c.tenant.id, featureKey: 'analytics.advanced', enabled: true, reason: 'test' } });
    await app.get(EntitlementsService).invalidate(c.tenant.id);
    const courses = (await authed(app, cs).get('/api/v1/creator/analytics/courses').expect(200)).body.data;
    expect(courses).toEqual([expect.objectContaining({ title: 'GST course', enrollments: 4, activeEnrollments: 4, completions: 0, sales: 4, revenue: '4720' })]);
    const students = parseCsv((await authed(app, cs).get('/api/v1/creator/analytics/exports/students.csv').expect(200)).text);
    expect(students).toHaveLength(4);
    expect(students[0]).toMatchObject({ Name: 'Gujarat Buyer', Courses: '1', Completed: '0' });
    const enr = parseCsv((await authed(app, cs).get(`/api/v1/creator/analytics/exports/enrollments.csv?courseId=${course.id}`).expect(200)).text);
    expect(enr).toHaveLength(4);
    expect(enr[0]).toMatchObject({ Course: 'GST course', Source: 'PURCHASE', 'Progress %': '0' });

    const other = await registerCreator(app);
    await prisma.tenantLimitOverride.create({ data: { tenantId: other.tenant.id, featureKey: 'analytics.advanced', enabled: true, reason: 'test' } });
    await authed(app, other.session).get(`/api/v1/creator/analytics/exports/enrollments.csv?courseId=${course.id}`).expect(404);
    expect((await authed(app, other.session).get('/api/v1/creator/analytics/gst').expect(200)).body.data.rows).toEqual([]);
    expect((await authed(app, other.session).get('/api/v1/creator/analytics/overview').expect(200)).body.data.counts).toMatchObject({ newStudents: 0, enrollments: 0, paidOrders: 0 });
    expect(parseCsv((await authed(app, other.session).get('/api/v1/creator/analytics/exports/students.csv').expect(200)).text)).toEqual([]);
  });
});
