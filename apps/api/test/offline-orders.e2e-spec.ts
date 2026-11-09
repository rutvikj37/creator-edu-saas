import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { api, authed, createTestApp, emailCount, registerCreator, resetDatabase, tenantHost, uniqueEmail } from './helpers.js';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

describe('Offline transactions (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(async () => app?.close());

  it('records a cash/UPI payment as a paid order with access, invoice and ledger; filters and search find it; refunds and duplicates are refused', async () => {
    const c = await registerCreator(app);
    const cs = c.session;
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    async function course(title: string, price: number | null) {
      const co = (await authed(app, cs).post('/api/v1/creator/courses').send({ title }).expect(201)).body.data;
      const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
      const l = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Intro', type: 'TEXT' }).expect(201)).body.data;
      await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}/lessons/${l.id}`).send({ content: doc('Hi'), isPublished: true }).expect(200);
      await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}`).send(price ? { isFree: false, priceAmount: price } : { isFree: true }).expect(200);
      await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/publish`).send({}).expect(200);
      return co;
    }
    const paid = await course('Accounts Basics', 2499);
    const free = await course('Free Intro', null);
    const email = uniqueEmail('cash');
    await api(app).post('/api/v1/auth/register/student').set('Host', tenantHost(c.tenant.slug)).send({ fullName: 'Cash Learner', email, password: 'student-password-1' }).expect(201);
    const learner = await prisma.user.findFirstOrThrow({ where: { email, tenantId: c.tenant.id } });

    await authed(app, cs).post('/api/v1/creator/orders/offline').send({ itemKind: 'course', itemId: paid.id, userId: 'x'.repeat(25), mode: 'UPI', amount: 2000 }).expect(422);
    await authed(app, cs).post('/api/v1/creator/orders/offline').send({ itemKind: 'course', itemId: paid.id, userId: learner.id, mode: 'CARD', amount: 2000 }).expect(422);
    await authed(app, cs).post('/api/v1/creator/orders/offline').send({ itemKind: 'course', itemId: free.id, userId: learner.id, mode: 'CASH', amount: 100 }).expect(409);

    const before = await emailCount(app, email);
    const o = (await authed(app, cs).post('/api/v1/creator/orders/offline').send({ itemKind: 'course', itemId: paid.id, userId: learner.id, mode: 'UPI', reference: 'UPI-REF-778899', amount: 2000, sendEmail: false }).expect(201)).body.data;
    expect(o).toMatchObject({ status: 'PAID', totalAmount: '2000', paymentMode: 'UPI', externalReference: 'UPI-REF-778899', billing: { name: 'Cash Learner', email } });
    expect(await emailCount(app, email)).toBe(before); // no receipt when asked not to
    expect((await prisma.enrollment.findFirstOrThrow({ where: { userId: learner.id, courseId: paid.id } })).status).toBe('ACTIVE');
    const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId: o.id } });
    expect(inv.totals).toMatchObject({ paidVia: 'UPI (direct)', paymentId: 'UPI-REF-778899', total: '2000' });
    expect(o.ledger.find((l: any) => l.type === 'SALE')).toMatchObject({ amount: '2000' });

    // Already has access → refused; offline orders can't be refunded through Razorpay.
    await authed(app, cs).post('/api/v1/creator/orders/offline').send({ itemKind: 'course', itemId: paid.id, userId: learner.id, mode: 'CASH', amount: 2499 }).expect(409);
    await authed(app, cs).post(`/api/v1/creator/orders/${o.id}/refunds`).send({ revokeAccess: true }).expect(409);

    // Filters and search.
    const list = (q: string) => authed(app, cs).get(`/api/v1/creator/orders?${q}`).expect(200).then((r) => r.body.data.map((x: any) => x.id));
    expect(await list('channel=offline')).toEqual([o.id]);
    expect(await list('channel=razorpay')).toEqual([]);
    expect(await list('type=course')).toContain(o.id);
    expect(await list('type=bundle')).toEqual([]);
    expect(await list('q=UPI-REF-778899')).toEqual([o.id]);

    // Another academy can't record against these learners/items.
    const other = await registerCreator(app);
    await authed(app, other.session).post('/api/v1/creator/orders/offline').send({ itemKind: 'course', itemId: paid.id, userId: learner.id, mode: 'CASH', amount: 10 }).expect((r) => expect([404, 422]).toContain(r.status));
  });
});
