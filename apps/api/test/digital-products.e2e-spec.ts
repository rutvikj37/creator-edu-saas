import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { api, authed, createTestApp, PDF, PNG, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail, uploadFile } from './helpers.js';
import { RazorpaySim } from './razorpay-sim.js';

const KEY_ID = 'rzp_test_DigitalProd77';
const KEY_SECRET = 'sim_digital_key_secret';

describe('Digital products (e2e)', () => {
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
    await authed(app, c.session).put('/api/v1/creator/payments/razorpay').send({ keyId: KEY_ID, keySecret: KEY_SECRET }).expect(200);
    return c;
  }
  async function student(slug: string) {
    const host = tenantHost(slug);
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: 'Download Buyer', email: uniqueEmail('dl'), password: 'student-password-1' }).expect(201);
    const s = parseSession(reg, host);
    return { s, id: (await authed(app, s).get('/api/v1/auth/me')).body.data.user.id as string };
  }
  async function pay(s: Session, orderId: string) {
    const p = (await authed(app, s).post(`/api/v1/learn/orders/${orderId}/pay`).expect(200)).body.data;
    return (await authed(app, s).post(`/api/v1/learn/orders/${orderId}/confirm`).send(sim.pay(p.checkout.orderId)).expect(200)).body.data;
  }
  /** Follows the signed link (local storage driver) and returns the bytes. */
  async function fetchSigned(url: string) {
    const u = new URL(url);
    const res = await api(app).get(u.pathname + u.search).set('Host', u.host).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    return res;
  }

  it('creator builds and publishes products; buyers pay or claim free ones, download with limits; refunds revoke; others are refused', async () => {
    const c = await academy();
    const cs = c.session;
    const host = tenantHost(c.tenant.slug);
    // Files must be uploaded with the product purpose; images-only purposes are refused.
    const ebookBytes = Buffer.concat([PDF, Buffer.alloc(2000, 0x20)]);
    const ebook = (await uploadFile(app, cs, 'PRODUCT_FILE', 'GST Guide 2026.pdf', 'application/pdf', ebookBytes)).body.data;
    const sheet = (await uploadFile(app, cs, 'PRODUCT_FILE', 'Tracker.pdf', 'application/pdf', PDF)).body.data;
    const lesson = (await uploadFile(app, cs, 'LESSON_FILE', 'other.pdf', 'application/pdf', PDF)).body.data;
    const cover = (await uploadFile(app, cs, 'IMAGE', 'cover.png', 'image/png', PNG)).body.data;

    const bad = await authed(app, cs).post('/api/v1/creator/products').send({ title: 'Wrong file', priceAmount: 99, files: [{ fileAssetId: lesson.id, title: 'x' }] }).expect(422);
    expect(bad.body.error.details[0].field).toBe('files');
    let product = (await authed(app, cs).post('/api/v1/creator/products').send({ title: 'GST Guide for Freelancers', description: 'Plain-language GST guide.', priceAmount: 299, compareAtAmount: 499, coverFileId: cover.id, downloadLimit: 2, files: [{ fileAssetId: ebook.id, title: 'The guide (PDF)' }] }).expect(201)).body.data;
    expect(product).toMatchObject({ slug: 'gst-guide-for-freelancers', status: 'DRAFT', priceAmount: '299', currency: 'INR', files: [{ title: 'The guide (PDF)', fileName: 'GST Guide 2026.pdf' }] });
    const empty = (await authed(app, cs).post('/api/v1/creator/products').send({ title: 'Empty', priceAmount: 0 }).expect(201)).body.data;
    expect((await authed(app, cs).post(`/api/v1/creator/products/${empty.id}/status`).send({ status: 'PUBLISHED' }).expect(422)).body.error.details[0].message).toBe('Add at least one file before publishing');
    // Add a second file and reorder.
    product = (await authed(app, cs).patch(`/api/v1/creator/products/${product.id}`).send({ files: [{ fileAssetId: sheet.id, title: 'Expense tracker' }, { id: product.files[0].id, title: 'The guide (PDF)' }] }).expect(200)).body.data;
    expect(product.files.map((f: any) => f.title)).toEqual(['Expense tracker', 'The guide (PDF)']);
    await api(app).get(`/api/v1/public/products/${product.slug}`).set('Host', host).expect(404); // draft
    await authed(app, cs).post(`/api/v1/creator/products/${product.id}/status`).send({ status: 'PUBLISHED' }).expect(200);

    // Public page: file names/types, no storage ids or links.
    const page = (await api(app).get(`/api/v1/public/products/${product.slug}`).set('Host', host).expect(200)).body.data;
    expect(page).toMatchObject({ title: 'GST Guide for Freelancers', priceAmount: '299', compareAtAmount: '499', isFree: false, downloadLimit: 2, files: [{ title: 'Expense tracker', type: 'PDF' }, { title: 'The guide (PDF)', type: 'PDF' }] });
    expect(JSON.stringify(page)).not.toMatch(new RegExp(`${ebook.id}|${sheet.id}`)); // product files never exposed (cover image is public)
    expect((await api(app).get('/api/v1/public/products').set('Host', host).expect(200)).body.data.map((p: any) => p.slug)).toEqual(['gst-guide-for-freelancers']);

    // Non-buyer cannot download; paid product cannot be claimed for free.
    const b = await student(c.tenant.slug);
    await authed(app, b.s).post(`/api/v1/learn/products/${product.id}/files/${product.files[1].id}/download`).expect(403);
    await authed(app, b.s).post(`/api/v1/learn/products/${product.id}/claim`).expect(409);

    // Purchase through checkout → access; owned items are refused next time.
    const q = (await authed(app, b.s).post('/api/v1/learn/checkout/quote').send({ digitalProductId: product.id }).expect(200)).body.data;
    expect(q).toMatchObject({ kind: 'product', total: '299.00', items: [{ kind: 'product', title: 'GST Guide for Freelancers' }] });
    const order = (await authed(app, b.s).post('/api/v1/learn/checkout').send({ digitalProductId: product.id, billing: { name: 'Download Buyer' } }).expect(201)).body.data;
    expect(await prisma.digitalProductAccess.count({ where: { productId: product.id } })).toBe(0);
    expect((await pay(b.s, order.id)).items[0]).toMatchObject({ digitalProductId: product.id });
    await authed(app, b.s).post('/api/v1/learn/checkout').send({ digitalProductId: product.id, billing: { name: 'Download Buyer' } }).expect(409);
    const mine = (await authed(app, b.s).get('/api/v1/learn/products').expect(200)).body.data;
    expect(mine).toEqual([expect.objectContaining({ title: 'GST Guide for Freelancers', downloadLimit: 2, files: [expect.objectContaining({ title: 'Expense tracker', remaining: 2 }), expect.objectContaining({ title: 'The guide (PDF)', remaining: 2 })] })]);

    // Download: signed link returns the exact bytes; limit of 2 per file enforced.
    const fileId = product.files[1].id;
    const d1 = (await authed(app, b.s).post(`/api/v1/learn/products/${product.id}/files/${fileId}/download`).expect(200)).body.data;
    expect(d1).toMatchObject({ fileName: 'GST Guide 2026.pdf', expiresInSeconds: 600 });
    const got = await fetchSigned(d1.url);
    expect(got.status).toBe(200);
    expect(Buffer.compare(got.body as Buffer, ebookBytes)).toBe(0);
    await authed(app, b.s).post(`/api/v1/learn/products/${product.id}/files/${fileId}/download`).expect(200);
    const over = await authed(app, b.s).post(`/api/v1/learn/products/${product.id}/files/${fileId}/download`).expect(409);
    expect(over.body.error.message).toMatch(/used all 2 downloads/);
    expect((await authed(app, b.s).get('/api/v1/learn/products')).body.data[0].files[1]).toMatchObject({ downloads: 2, remaining: 0 });
    // The other file still has its own allowance; another product's file id is refused.
    await authed(app, b.s).post(`/api/v1/learn/products/${product.id}/files/${product.files[0].id}/download`).expect(200);
    const buyers = (await authed(app, cs).get(`/api/v1/creator/products/${product.id}/buyers`).expect(200)).body.data;
    expect(buyers).toEqual([expect.objectContaining({ userId: b.id, source: 'PURCHASE', active: true, downloads: 3 })]);
    expect((await authed(app, cs).get(`/api/v1/creator/products/${product.id}`)).body.data).toMatchObject({ buyers: 1, sales: 1, revenue: '299' });

    // Free product: claimed without checkout; via the cart together with a paid one.
    const freebie = (await authed(app, cs).post('/api/v1/creator/products').send({ title: 'Free GST checklist', priceAmount: 0, files: [{ fileAssetId: sheet.id, title: 'Checklist' }] }).expect(201)).body.data;
    await authed(app, cs).post(`/api/v1/creator/products/${freebie.id}/status`).send({ status: 'PUBLISHED' }).expect(200);
    const b2 = await student(c.tenant.slug);
    await authed(app, b2.s).post('/api/v1/learn/checkout').send({ digitalProductId: freebie.id, billing: { name: 'Free Taker' } }).expect(409); // free → claim
    await authed(app, b2.s).post(`/api/v1/learn/products/${freebie.id}/claim`).expect(200);
    await authed(app, b2.s).post('/api/v1/learn/cart/items').send({ digitalProductId: product.id }).expect(200);
    const cart = (await authed(app, b2.s).get('/api/v1/learn/cart').expect(200)).body.data;
    expect(cart).toMatchObject({ count: 1, items: [{ kind: 'product', title: 'GST Guide for Freelancers' }] });
    const o2 = (await authed(app, b2.s).post('/api/v1/learn/checkout').send({ fromCart: true, billing: { name: 'Cart Buyer' } }).expect(201)).body.data;
    await pay(b2.s, o2.id);
    expect((await authed(app, b2.s).get('/api/v1/learn/products')).body.data.map((p: any) => p.title).sort()).toEqual(['Free GST checklist', 'GST Guide for Freelancers']);
    expect((await authed(app, b2.s).get('/api/v1/learn/cart')).body.data.count).toBe(0);

    // Full refund with revoke removes access.
    await authed(app, cs).post(`/api/v1/creator/orders/${order.id}/refunds`).send({ revokeAccess: true }).expect(201);
    await authed(app, b.s).post(`/api/v1/learn/products/${product.id}/files/${product.files[0].id}/download`).expect(403);
    expect((await authed(app, b.s).get('/api/v1/learn/products')).body.data).toEqual([]);

    // Another academy cannot see, edit or sell these products; its students cannot download.
    const other = await academy();
    await authed(app, other.session).get(`/api/v1/creator/products/${product.id}`).expect(404);
    await authed(app, other.session).patch(`/api/v1/creator/products/${product.id}`).send({ title: 'x' }).expect(404);
    await authed(app, other.session).post('/api/v1/creator/products').send({ title: 'Steal', priceAmount: 1, files: [{ fileAssetId: ebook.id, title: 'x' }] }).expect(422);
    const os = await student(other.tenant.slug);
    await authed(app, os.s).post(`/api/v1/learn/products/${product.id}/files/${product.files[0].id}/download`).expect(403);
    await api(app).get(`/api/v1/public/products/${product.slug}`).set('Host', tenantHost(other.tenant.slug)).expect(404);
  });
});
