import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { MembershipsService } from '../src/modules/memberships/memberships.service.js';
import { api, authed, createTestApp, lastEmail, parseSession, PNG, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail, uploadFile } from './helpers.js';
import { RazorpaySim } from './razorpay-sim.js';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const KEY_ID = 'rzp_test_MemberKey1234';
const KEY_SECRET = 'member_sim_secret';
const DAY = 86_400_000;

describe('Memberships and communities (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let sim: RazorpaySim;
  let c: Awaited<ReturnType<typeof registerCreator>>;
  let cs: Session;
  let courses: { id: string }[] = [];
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
    for (const title of ['Members course A', 'Members course B']) {
      const co = (await authed(app, cs).post('/api/v1/creator/courses').send({ title }).expect(201)).body.data;
      const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
      const l = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Intro', type: 'TEXT' }).expect(201)).body.data;
      await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}/lessons/${l.id}`).send({ content: doc('Hi'), isPublished: true }).expect(200);
      await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}`).send({ isFree: false, priceAmount: 999 }).expect(200);
      await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/publish`).send({}).expect(200);
      courses.push(co);
    }
  });
  afterAll(async () => app?.close());

  async function student(name: string) {
    const host = tenantHost(c.tenant.slug);
    const email = uniqueEmail('cm');
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: name, email, password: 'student-password-1' }).expect(201);
    const s = parseSession(reg, host);
    return { s, email, id: (await authed(app, s).get('/api/v1/auth/me')).body.data.user.id as string };
  }
  async function buyPlan(s: Session, planId: string) {
    const o = (await authed(app, s).post('/api/v1/learn/checkout').send({ membershipPlanId: planId, billing: { name: 'Member' } }).expect(201)).body.data;
    const p = (await authed(app, s).post(`/api/v1/learn/orders/${o.id}/pay`).expect(200)).body.data;
    await authed(app, s).post(`/api/v1/learn/orders/${o.id}/confirm`).send(sim.pay(p.checkout.orderId)).expect(200);
    return o;
  }

  it('membership: buy → courses unlocked until period end → renewal extends → refund revokes → reminders and expiry', async () => {
    await authed(app, cs).post('/api/v1/creator/memberships').send({ name: 'All access', priceAmount: 499, interval: 'MONTH', courseIds: [] }).expect(422);
    const plan = (await authed(app, cs).post('/api/v1/creator/memberships').send({ name: 'All access', priceAmount: 499, interval: 'MONTH', courseIds: courses.map((x) => x.id) }).expect(201)).body.data;
    const pub = (await api(app).get('/api/v1/public/memberships').set('Host', tenantHost(c.tenant.slug)).expect(200)).body.data;
    expect(pub[0]).toMatchObject({ name: 'All access', priceAmount: '499', interval: 'MONTH', courses: [{ title: 'Members course A' }, { title: 'Members course B' }] });

    const m = await student('Meena Member');
    const quote = (await authed(app, m.s).post('/api/v1/learn/checkout/quote').send({ membershipPlanId: plan.id }).expect(200)).body.data;
    expect(quote).toMatchObject({ kind: 'membership', total: '499.00', course: { title: 'All access membership (monthly)' } });
    const order = await buyPlan(m.s, plan.id);
    const mine = (await authed(app, m.s).get('/api/v1/learn/memberships')).body.data[0];
    expect(mine).toMatchObject({ active: true, plan: { name: 'All access' } });
    const end1 = new Date(mine.currentPeriodEnd).getTime();
    expect(end1).toBeGreaterThan(Date.now() + 27 * DAY);
    const enr = await prisma.enrollment.findMany({ where: { userId: m.id } });
    expect(enr.map((e) => [e.source, e.expiresAt?.getTime()])).toEqual([['MEMBERSHIP', end1], ['MEMBERSHIP', end1]]);
    await authed(app, m.s).get(`/api/v1/learn/courses/${courses[0].id}/player`).expect(200);

    // Paying again extends from the current end, not from today.
    await buyPlan(m.s, plan.id);
    const end2 = new Date((await authed(app, m.s).get('/api/v1/learn/memberships')).body.data[0].currentPeriodEnd).getTime();
    expect(end2 - end1).toBeGreaterThan(27 * DAY);
    expect((await prisma.enrollment.findFirstOrThrow({ where: { userId: m.id, courseId: courses[1].id } })).expiresAt!.getTime()).toBe(end2);
    expect((await authed(app, cs).get(`/api/v1/creator/memberships/${plan.id}/members`)).body.data).toEqual([expect.objectContaining({ status: 'ACTIVE', user: expect.objectContaining({ fullName: 'Meena Member' }) })]);

    // Reminder within 7 days of the end, once; expiry after the end ends access.
    const svc = app.get(MembershipsService);
    await prisma.membership.updateMany({ where: { userId: m.id }, data: { currentPeriodEnd: new Date(Date.now() + 3 * DAY) } });
    expect((await svc.maintain()).reminded).toBe(1);
    expect((await svc.maintain()).reminded).toBe(0);
    expect((await lastEmail(app, m.email))!).toMatchObject({ tag: 'membership-renewal', subject: 'Your All access membership ends soon' });
    await prisma.membership.updateMany({ where: { userId: m.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    await prisma.enrollment.updateMany({ where: { userId: m.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await svc.maintain()).expired).toBe(1);
    await authed(app, m.s).get(`/api/v1/learn/courses/${courses[0].id}/player`).expect(403);

    // A full refund with access removal cancels the membership.
    const r = await student('Rohit Refund');
    const ro = await buyPlan(r.s, plan.id);
    await authed(app, cs).post(`/api/v1/creator/orders/${ro.id}/refunds`).send({ revokeAccess: true }).expect(201);
    expect((await prisma.membership.findFirstOrThrow({ where: { userId: r.id } })).status).toBe('CANCELLED');
    expect((await prisma.enrollment.findMany({ where: { userId: r.id } })).map((e) => e.status)).toEqual(['REVOKED', 'REVOKED']);
    expect(order.id).toBeTruthy();
  });

  it('communities: access by audience, posts, replies notify, likes, staff-only spaces, lock, hide, reports', async () => {
    const plan = (await authed(app, cs).post('/api/v1/creator/memberships').send({ name: 'Inner circle', priceAmount: 299, interval: 'MONTH', courseIds: [courses[0].id] }).expect(201)).body.data;
    const open = (await authed(app, cs).post('/api/v1/creator/communities').send({ name: 'Lounge', access: 'ALL_STUDENTS' }).expect(201)).body.data;
    const announce = (await authed(app, cs).post('/api/v1/creator/communities').send({ name: 'Announcements', access: 'ALL_STUDENTS', staffOnlyPosts: true }).expect(201)).body.data;
    const members = (await authed(app, cs).post('/api/v1/creator/communities').send({ name: 'Members only', access: 'MEMBERSHIP', membershipPlanId: plan.id }).expect(201)).body.data;
    await authed(app, cs).post('/api/v1/creator/communities').send({ name: 'Bad', access: 'COURSE' }).expect(422);

    const a = await student('Asha Author');
    const b = await student('Bilal Replier');
    expect((await authed(app, a.s).get('/api/v1/learn/communities')).body.data.map((x: any) => x.name)).toEqual(['Lounge', 'Announcements']);
    await authed(app, a.s).get(`/api/v1/learn/communities/${members.id}/posts`).expect(404);
    await buyPlan(b.s, plan.id);
    expect((await authed(app, b.s).get('/api/v1/learn/communities')).body.data.map((x: any) => x.name)).toContain('Members only');

    await authed(app, a.s).post(`/api/v1/learn/communities/${announce.id}/posts`).send({ body: 'Can I post?' }).expect(403);
    const post = (await authed(app, a.s).post(`/api/v1/learn/communities/${open.id}/posts`).send({ title: 'Study group?', body: 'Anyone up for weekend study?' }).expect(201)).body.data;
    expect(post).toMatchObject({ title: 'Study group?', author: { name: 'Asha Author', staff: false }, mine: true, commentCount: 0 });
    const replied = (await authed(app, b.s).post(`/api/v1/learn/communities/posts/${post.id}/comments`).send({ body: 'Count me in!' }).expect(201)).body.data;
    expect(replied.comments).toEqual([expect.objectContaining({ body: 'Count me in!', author: { name: 'Bilal Replier', staff: false } })]);
    const note = (await authed(app, a.s).get('/api/v1/notifications')).body.data.items[0];
    expect(note).toMatchObject({ category: 'community', title: 'New reply in Lounge', link: `/learn/communities/${open.id}/posts/${post.id}` });
    expect((await authed(app, b.s).post(`/api/v1/learn/communities/posts/${post.id}/like`).expect(200)).body.data).toMatchObject({ likeCount: 1, likedByMe: true });
    await authed(app, b.s).delete(`/api/v1/learn/communities/posts/${post.id}`).expect(404); // not theirs

    // Moderation: lock stops student comments, hide removes from students but staff still see it.
    await authed(app, cs).post(`/api/v1/creator/communities/posts/${post.id}/moderate`).send({ action: 'lock' }).expect(200);
    await authed(app, b.s).post(`/api/v1/learn/communities/posts/${post.id}/comments`).send({ body: 'late' }).expect(409);
    await authed(app, b.s).post('/api/v1/learn/communities/reports').send({ postId: post.id, reason: 'Off topic' }).expect(200);
    expect((await authed(app, cs).get('/api/v1/creator/communities')).body.data.openReports).toBe(1);
    await authed(app, cs).post(`/api/v1/creator/communities/posts/${post.id}/moderate`).send({ action: 'hide' }).expect(200);
    expect((await authed(app, b.s).get(`/api/v1/learn/communities/${open.id}/posts`)).body.data.items).toEqual([]);
    expect((await authed(app, cs).get(`/api/v1/creator/communities/${open.id}/posts`)).body.data.items[0]).toMatchObject({ hidden: true });
    expect((await authed(app, cs).get('/api/v1/creator/communities')).body.data.openReports).toBe(0);
    const staffPost = (await authed(app, cs).post(`/api/v1/creator/communities/${announce.id}/posts`).send({ body: 'Live class moved to Friday.' }).expect(201)).body.data;
    expect(staffPost.author.staff).toBe(true);

    // Another academy sees nothing.
    const other = await registerCreator(app);
    await authed(app, other.session).get(`/api/v1/creator/communities/${open.id}/posts`).expect(404);
    expect((await authed(app, other.session).get('/api/v1/creator/communities')).body.data.communities).toEqual([]);
  });
  it('membership builder: draft from a name, details, courses, then pricing with a sale price; publish rules; stats; drafts stay hidden', async () => {
    const cover = (await uploadFile(app, cs, 'IMAGE', 'cover.png', 'image/png', PNG)).body.data;
    const draft = (await authed(app, cs).post('/api/v1/creator/memberships').send({ name: 'My Membership', description: 'Welcome to my membership community', coverFileId: cover.id, faqs: [{ question: 'What is included?', answer: 'Every course listed.' }] }).expect(201)).body.data;
    expect(draft).toMatchObject({ status: 'DRAFT', priceAmount: '0', courseIds: [], coverUrl: expect.any(String), faqs: [{ question: 'What is included?', answer: 'Every course listed.' }] });
    await authed(app, cs).post('/api/v1/creator/memberships').send({ name: 'Bad', faqs: [{ question: 'Q', answer: '' }] }).expect(422);
    // Not sellable yet: hidden publicly, refused at checkout, can't be published without courses and a price.
    expect((await api(app).get('/api/v1/public/memberships').set('Host', tenantHost(c.tenant.slug))).body.data.map((p: any) => p.id)).not.toContain(draft.id);
    const m = await student('Draft Peeker');
    await authed(app, m.s).post('/api/v1/learn/checkout').send({ membershipPlanId: draft.id, billing: { name: 'Peeker' } }).expect(404);
    const refused = await authed(app, cs).patch(`/api/v1/creator/memberships/${draft.id}`).send({ status: 'ACTIVE' }).expect(422);
    expect(refused.body.error.details.map((d: any) => d.field).sort()).toEqual(['courseIds', 'priceAmount']);
    // Step 2: courses. Step 3: plan name, price 1499 struck through, charged 999 a year; publish.
    await authed(app, cs).patch(`/api/v1/creator/memberships/${draft.id}`).send({ courseIds: courses.map((x) => x.id) }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/memberships/${draft.id}`).send({ priceAmount: 999, compareAtAmount: 999 }).expect(422);
    const live = (await authed(app, cs).patch(`/api/v1/creator/memberships/${draft.id}`).send({ planName: 'Yearly pass', priceAmount: 999, compareAtAmount: 1499, interval: 'YEAR', status: 'ACTIVE' }).expect(200)).body.data;
    expect(live).toMatchObject({ status: 'ACTIVE', planName: 'Yearly pass', interval: 'YEAR' });
    expect([Number(live.priceAmount), Number(live.compareAtAmount)]).toEqual([999, 1499]);
    expect((await authed(app, cs).get(`/api/v1/creator/memberships/${draft.id}`).expect(200)).body.data).toMatchObject({ name: 'My Membership', coverUrl: expect.any(String) });
    const pub = (await api(app).get('/api/v1/public/memberships').set('Host', tenantHost(c.tenant.slug))).body.data.find((p: any) => p.id === draft.id);
    expect(pub).toMatchObject({ planName: 'Yearly pass', courses: expect.arrayContaining([expect.objectContaining({ title: 'Members course A' })]) });
    // A buyer pays the sale price; the header totals and the card numbers count it.
    const before = (await authed(app, cs).get('/api/v1/creator/memberships/stats').expect(200)).body.data;
    await buyPlan(m.s, draft.id);
    const after = (await authed(app, cs).get('/api/v1/creator/memberships/stats')).body.data;
    expect(after.totalMembers).toBe(before.totalMembers + 1);
    expect(Number(after.totalRevenue) - Number(before.totalRevenue)).toBe(999);
    expect((await authed(app, cs).get('/api/v1/creator/memberships')).body.data.find((p: any) => p.id === draft.id)).toMatchObject({ activeMembers: 1, revenue: '999' });
    // Another academy can't read it.
    const other = await registerCreator(app);
    await authed(app, other.session).get(`/api/v1/creator/memberships/${draft.id}`).expect(404);
    expect((await authed(app, other.session).get('/api/v1/creator/memberships/stats')).body.data.totalMembers).toBe(0);
  });
});
