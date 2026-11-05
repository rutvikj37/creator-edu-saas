import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../src/core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../src/core/tenancy/tenant-prisma.js';
import { TenantContextMissingError } from '../src/core/tenancy/tenant-prisma.js';
import { TenantContext } from '../src/core/tenancy/tenant-context.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { PasswordService } from '../src/modules/auth/services/password.service.js';
import { EntitlementsService } from '../src/modules/subscriptions/entitlements.service.js';
import { api, authed, createTestApp, login, parseSession, PLATFORM, registerCreator, resetDatabase, tenantHost, uniqueEmail, type Session } from './helpers.js';

/**
 * Every tenant-scoped (workspace) route must appear here. The registry test at the bottom
 * fails when a new /creator route is added without an isolation case.
 */
const WORKSPACE_ROUTES_COVERED = [
  'GET /api/v1/creator/workspace',
  'GET /api/v1/creator/members',
  'GET /api/v1/creator/domains',
  'POST /api/v1/creator/domains',
  'POST /api/v1/creator/domains/:id/verify',
  'PATCH /api/v1/creator/domains/:id/primary',
  'DELETE /api/v1/creator/domains/:id',
  'GET /api/v1/creator/billing',
  'GET /api/v1/creator/support/tickets',
  'POST /api/v1/creator/support/tickets',
  'GET /api/v1/creator/support/tickets/:id',
  'POST /api/v1/creator/support/tickets/:id/messages',
  // Phase 4 routes: isolation covered in creator-platform.e2e-spec.ts
  'POST /api/v1/creator/files', 'POST /api/v1/creator/files/:id/complete',
  'GET /api/v1/creator/academy', 'PUT /api/v1/creator/academy', 'GET /api/v1/creator/academy/business', 'PUT /api/v1/creator/academy/business',
  'GET /api/v1/creator/onboarding', 'PUT /api/v1/creator/onboarding/step', 'POST /api/v1/creator/onboarding/publish', 'GET /api/v1/creator/dashboard',
  'GET /api/v1/creator/courses', 'POST /api/v1/creator/courses', 'GET /api/v1/creator/courses/:id', 'PATCH /api/v1/creator/courses/:id', 'DELETE /api/v1/creator/courses/:id',
  'GET /api/v1/creator/courses/:id/publish-check', 'POST /api/v1/creator/courses/:id/publish', 'POST /api/v1/creator/courses/:id/unpublish', 'POST /api/v1/creator/courses/:id/archive',
  'POST /api/v1/creator/courses/:id/restore', 'POST /api/v1/creator/courses/:id/duplicate', 'PUT /api/v1/creator/courses/:id/instructors', 'GET /api/v1/creator/courses/:id/curriculum',
  'PUT /api/v1/creator/courses/:id/curriculum/order', 'POST /api/v1/creator/courses/:id/sections', 'PATCH /api/v1/creator/courses/:id/sections/:sectionId',
  'DELETE /api/v1/creator/courses/:id/sections/:sectionId', 'POST /api/v1/creator/courses/:id/lessons', 'PATCH /api/v1/creator/courses/:id/lessons/:lessonId',
  'DELETE /api/v1/creator/courses/:id/lessons/:lessonId',
  // Phase 5 routes: isolation covered in student-platform.e2e-spec.ts
  'GET /api/v1/creator/students', 'GET /api/v1/creator/students/:id', 'GET /api/v1/creator/courses/:id/enrollments', 'POST /api/v1/creator/courses/:id/enrollments',
  'DELETE /api/v1/creator/enrollments/:enrollmentId', 'GET /api/v1/creator/discussions', 'POST /api/v1/creator/discussions/:id/replies', 'POST /api/v1/creator/discussions/:id/moderate',
  'GET /api/v1/creator/courses/:id/lessons/:lessonId/quiz', 'PUT /api/v1/creator/courses/:id/lessons/:lessonId/quiz', 'POST /api/v1/creator/courses/:id/lessons/:lessonId/quiz/questions',
  'PUT /api/v1/creator/courses/:id/lessons/:lessonId/quiz/questions/order', 'PUT /api/v1/creator/courses/:id/lessons/:lessonId/quiz/questions/:qid',
  'DELETE /api/v1/creator/courses/:id/lessons/:lessonId/quiz/questions/:qid', 'GET /api/v1/creator/quizzes/:quizId/attempts', 'GET /api/v1/creator/quiz-attempts/:attemptId', 'POST /api/v1/creator/quiz-attempts/:attemptId/grade',
  'GET /api/v1/creator/courses/:id/lessons/:lessonId/assignment', 'PUT /api/v1/creator/courses/:id/lessons/:lessonId/assignment', 'GET /api/v1/creator/assignments/:assignmentId/submissions',
  'POST /api/v1/creator/submissions/:submissionId/grade', 'GET /api/v1/creator/certificates/template', 'PUT /api/v1/creator/certificates/template', 'GET /api/v1/creator/certificates',
  'POST /api/v1/creator/certificates/:id/revoke', 'POST /api/v1/creator/certificates/:id/reinstate',
  // Phase 6 routes: isolation covered in video.e2e-spec.ts
  'POST /api/v1/creator/files/:id/parts', 'GET /api/v1/creator/videos', 'POST /api/v1/creator/videos', 'PATCH /api/v1/creator/videos/:id', 'GET /api/v1/creator/videos/:id/preview', 'DELETE /api/v1/creator/videos/:id',
  // Phase 10 — contacts, campaigns, automations (cross-tenant checks in marketing.e2e-spec.ts)
  'GET /api/v1/creator/leads', 'POST /api/v1/creator/leads/import', 'GET /api/v1/creator/leads/:id', 'PATCH /api/v1/creator/leads/:id', 'DELETE /api/v1/creator/leads/:id',
  'GET /api/v1/creator/campaigns', 'POST /api/v1/creator/campaigns', 'GET /api/v1/creator/campaigns/:id', 'PATCH /api/v1/creator/campaigns/:id', 'POST /api/v1/creator/campaigns/:id/test',
  'POST /api/v1/creator/campaigns/:id/schedule', 'POST /api/v1/creator/campaigns/:id/cancel',
  'GET /api/v1/creator/automations', 'POST /api/v1/creator/automations', 'GET /api/v1/creator/automations/:id', 'PATCH /api/v1/creator/automations/:id', 'DELETE /api/v1/creator/automations/:id',
  // Phase 9 — live classes & batches (cross-tenant checks in live.e2e-spec.ts)
  'GET /api/v1/creator/live/providers', 'GET /api/v1/creator/live/classes', 'POST /api/v1/creator/live/classes', 'GET /api/v1/creator/live/classes/:id', 'PATCH /api/v1/creator/live/classes/:id',
  'POST /api/v1/creator/live/classes/:id/cancel', 'POST /api/v1/creator/live/sessions/:id/cancel', 'POST /api/v1/creator/live/sessions/:id/host', 'POST /api/v1/creator/live/sessions/:id/end',
  'GET /api/v1/creator/live/sessions/:id/attendance', 'GET /api/v1/creator/live/sessions/:id/attendance.csv', 'GET /api/v1/creator/live/sessions/:id/recording',
  'GET /api/v1/creator/live/sessions/:id/admissions', 'POST /api/v1/creator/live/sessions/:id/admissions/:admissionId', 'GET /api/v1/creator/live/sessions/:id/polls',
  'POST /api/v1/creator/live/sessions/:id/polls', 'POST /api/v1/creator/live/sessions/:id/polls/:pollId/close', 'GET /api/v1/creator/live/sessions/:id/questions',
  'POST /api/v1/creator/live/sessions/:id/questions/:questionId/answer',
  'GET /api/v1/creator/batches', 'POST /api/v1/creator/batches', 'GET /api/v1/creator/batches/:id', 'PATCH /api/v1/creator/batches/:id', 'POST /api/v1/creator/batches/:id/members',
  'POST /api/v1/creator/batches/:id/members/:memberId/remove', 'POST /api/v1/creator/batches/:id/archive',
  // Phase 8 — website builder & blog (cross-tenant checks in website.e2e-spec.ts)
  'GET /api/v1/creator/website', 'PUT /api/v1/creator/website/settings', 'POST /api/v1/creator/website/templates/:key/apply', 'POST /api/v1/creator/website/preview-token',
  'POST /api/v1/creator/website/pages', 'GET /api/v1/creator/website/pages/:id', 'PATCH /api/v1/creator/website/pages/:id', 'POST /api/v1/creator/website/pages/:id/publish',
  'POST /api/v1/creator/website/pages/:id/unpublish', 'GET /api/v1/creator/website/pages/:id/versions', 'POST /api/v1/creator/website/pages/:id/versions/:versionId/restore',
  'POST /api/v1/creator/website/pages/:id/home', 'DELETE /api/v1/creator/website/pages/:id',
  'GET /api/v1/creator/blog/posts', 'POST /api/v1/creator/blog/posts', 'GET /api/v1/creator/blog/posts/:id', 'PATCH /api/v1/creator/blog/posts/:id',
  'POST /api/v1/creator/blog/posts/:id/publish', 'POST /api/v1/creator/blog/posts/:id/unpublish', 'DELETE /api/v1/creator/blog/posts/:id',
  // Phase 8 — branded subdomains (domains.e2e-spec.ts)
  'GET /api/v1/creator/domains/subdomains/availability', 'POST /api/v1/creator/domains/subdomains',
  // Phase 7 — commerce (cross-tenant behaviour is also exercised in commerce.e2e-spec.ts)
  'GET /api/v1/creator/payments/razorpay', 'PUT /api/v1/creator/payments/razorpay', 'POST /api/v1/creator/payments/razorpay/verify', 'PATCH /api/v1/creator/payments/razorpay', 'DELETE /api/v1/creator/payments/razorpay',
  'GET /api/v1/creator/coupons', 'POST /api/v1/creator/coupons', 'PATCH /api/v1/creator/coupons/:id', 'DELETE /api/v1/creator/coupons/:id',
  'GET /api/v1/creator/orders', 'GET /api/v1/creator/orders/summary', 'GET /api/v1/creator/orders/:id', 'GET /api/v1/creator/orders/:id/invoice', 'POST /api/v1/creator/orders/:id/refunds',
  'GET /api/v1/creator/transactions',
  // Phase 7 — plan billing (cross-tenant checks in billing.e2e-spec.ts)
  'GET /api/v1/creator/billing/plans', 'POST /api/v1/creator/billing/quote', 'POST /api/v1/creator/billing/checkout', 'GET /api/v1/creator/billing/invoices',
  'GET /api/v1/creator/billing/invoices/:id', 'GET /api/v1/creator/billing/invoices/:id/pdf', 'POST /api/v1/creator/billing/invoices/:id/pay',
  'POST /api/v1/creator/billing/invoices/:id/confirm', 'POST /api/v1/creator/billing/cancellation',
  'GET /api/v1/creator/staff', 'POST /api/v1/creator/staff/invitations', 'DELETE /api/v1/creator/staff/invitations/:id', 'PATCH /api/v1/creator/staff/:memberId', 'DELETE /api/v1/creator/staff/:memberId',
];

describe('Tenant isolation (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let A: Awaited<ReturnType<typeof registerCreator>>;
  let B: Awaited<ReturnType<typeof registerCreator>>;
  let domainA: { id: string; hostname: string };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    A = await registerCreator(app, { businessName: 'Alpha Academy' });
    B = await registerCreator(app, { businessName: 'Beta Academy' });
    // The seeded default plan allows no custom domains; grant some via overrides for this suite.
    for (const t of [A.tenant.id, B.tenant.id]) {
      await prisma.tenantLimitOverride.create({ data: { tenantId: t, featureKey: 'domains.custom', enabled: true, limitValue: 5n } });
      await app.get(EntitlementsService).invalidate(t);
    }
    const res = await authed(app, A.session).post('/api/v1/creator/domains').send({ hostname: 'learn.alpha-example.com' }).expect(201);
    domainA = res.body.data;
  });
  afterAll(async () => app?.close());

  it('each workspace sees only its own data', async () => {
    const a = await authed(app, A.session).get('/api/v1/creator/domains').expect(200);
    const b = await authed(app, B.session).get('/api/v1/creator/domains').expect(200);
    expect(a.body.data.map((d: { hostname: string }) => d.hostname).sort()).toEqual(['alpha-academy.lvh.me', 'learn.alpha-example.com']);
    expect(b.body.data.map((d: { hostname: string }) => d.hostname)).toEqual(['beta-academy.lvh.me']);

    const wa = await authed(app, A.session).get('/api/v1/creator/workspace').expect(200);
    const wb = await authed(app, B.session).get('/api/v1/creator/workspace').expect(200);
    expect(wa.body.data.id).toBe(A.tenant.id);
    expect(wb.body.data.id).toBe(B.tenant.id);

    const mb = await authed(app, B.session).get('/api/v1/creator/members').expect(200);
    expect(mb.body.data.map((m: { user: { email: string } }) => m.user.email)).toEqual([B.body.email]);
  });

  it("tenant B cannot read, verify, modify or delete tenant A's resources by id (404, not 403)", async () => {
    await authed(app, B.session).post(`/api/v1/creator/domains/${domainA.id}/verify`).expect(404);
    await authed(app, B.session).patch(`/api/v1/creator/domains/${domainA.id}/primary`).expect(404);
    await authed(app, B.session).delete(`/api/v1/creator/domains/${domainA.id}`).expect(404);
    expect(await prisma.tenantDomain.findUnique({ where: { id: domainA.id } })).not.toBeNull();

    const coupon = (await authed(app, A.session).post('/api/v1/creator/coupons').send({ code: 'ALPHA20', type: 'PERCENT', value: 20 }).expect(201)).body.data;
    await authed(app, B.session).patch(`/api/v1/creator/coupons/${coupon.id}`).send({ isActive: false }).expect(404);
    await authed(app, B.session).delete(`/api/v1/creator/coupons/${coupon.id}`).expect(404);
    expect((await authed(app, B.session).get('/api/v1/creator/coupons').expect(200)).body.data).toEqual([]);
    // Same code is free to use in another academy.
    await authed(app, B.session).post('/api/v1/creator/coupons').send({ code: 'ALPHA20', type: 'FIXED', value: 50 }).expect(201);
    await authed(app, B.session).get('/api/v1/creator/orders/ckxxxxxxxxxxxxxxxxxxxxxxx/invoice').expect(404);
  });

  it('client-supplied tenantId is rejected, never trusted', async () => {
    const res = await authed(app, B.session).post('/api/v1/creator/domains').send({ hostname: 'learn.beta-example.com', tenantId: A.tenant.id }).expect(422);
    expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'tenantId' })]);
    await authed(app, B.session).get(`/api/v1/creator/domains?tenantId=${A.tenant.id}`).expect(200).then((r) => {
      expect(r.body.data.every((d: { hostname: string }) => d.hostname.startsWith('beta'))).toBe(true);
    });
  });

  it("support tickets and billing are isolated per workspace", async () => {
    const t = await authed(app, A.session).post('/api/v1/creator/support/tickets').send({ subject: 'Payout question', category: 'billing', priority: 'MEDIUM', body: 'When are payouts sent each month?' }).expect(201);
    await authed(app, B.session).get(`/api/v1/creator/support/tickets/${t.body.data.id}`).expect(404);
    await authed(app, B.session).post(`/api/v1/creator/support/tickets/${t.body.data.id}/messages`).send({ body: 'hijack' }).expect(404);
    const list = await authed(app, B.session).get('/api/v1/creator/support/tickets').expect(200);
    expect(list.body.data).toEqual([]);
    const billing = await authed(app, B.session).get('/api/v1/creator/billing').expect(200);
    expect(billing.body.data.usage['domains.custom']).toBe(0);
  });

  it('cannot switch into a workspace without membership', async () => {
    await authed(app, B.session).post('/api/v1/auth/switch-tenant').send({ tenantId: A.tenant.id }).expect(404);
  });

  it('a domain already connected to another academy cannot be claimed', async () => {
    const res = await authed(app, B.session).post('/api/v1/creator/domains').send({ hostname: 'learn.alpha-example.com' }).expect(409);
    expect(res.body.error.message).not.toContain('Alpha');
  });

  it('tokens are bound to the realm of their host', async () => {
    await prisma.tenant.updateMany({ where: { id: { in: [A.tenant.id, B.tenant.id] } }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(A.tenant.slug), tenantHost(B.tenant.slug));
    const reg = await api(app)
      .post('/api/v1/auth/register/student')
      .set('Host', tenantHost(A.tenant.slug))
      .send({ fullName: 'Stu Dent', email: uniqueEmail('stu'), password: 'student-password-1' })
      .expect(201);
    const student: Session = parseSession(reg, tenantHost(A.tenant.slug));

    // Academy A token on academy B → rejected
    await authed(app, { ...student, host: tenantHost(B.tenant.slug) }).get('/api/v1/auth/me').expect(401);
    // Academy token on the platform host → rejected
    await authed(app, { ...student, host: PLATFORM }).get('/api/v1/auth/me').expect(401);
    // Platform (creator) token on an academy host → rejected
    await authed(app, { ...A.session, host: tenantHost(A.tenant.slug) }).get('/api/v1/auth/me').expect(401);
    // Student on its own academy cannot reach workspace routes
    await authed(app, student).get('/api/v1/creator/workspace').expect(404);
    // Refresh cookies are host-scoped too
    await api(app).post('/api/v1/auth/refresh').set('Host', tenantHost(B.tenant.slug)).set('Cookie', student.cookies).set('X-CSRF-Token', student.csrf).expect(401);
  });

  it('staff permissions are enforced inside a workspace (RBAC)', async () => {
    const passwords = app.get(PasswordService);
    const instructorRole = await prisma.role.findUniqueOrThrow({ where: { uniqueKey: 'system:INSTRUCTOR' } });
    const email = uniqueEmail('instructor');
    const user = await prisma.user.create({ data: { realm: 'PLATFORM', realmKey: 'platform', email, fullName: 'Ian Instructor', passwordHash: await passwords.hash('instructor-pass-1') } });
    await prisma.tenantMember.create({ data: { tenantId: A.tenant.id, userId: user.id, roleId: instructorRole.id } });
    const { session } = await login(app, PLATFORM, email, 'instructor-pass-1');
    await authed(app, session).get('/api/v1/creator/workspace').expect(200);
    await authed(app, session).get('/api/v1/creator/domains').expect(403);
    await authed(app, session).post('/api/v1/creator/domains').send({ hostname: 'x.instructor-example.com' }).expect(403);
    await authed(app, session).get('/api/v1/creator/members').expect(403);
    await authed(app, session).get('/api/v1/creator/orders').expect(403);
    await authed(app, session).get('/api/v1/creator/transactions').expect(403);
    await authed(app, session).post('/api/v1/creator/orders/ckxxxxxxxxxxxxxxxxxxxxxxx/refunds').send({}).expect(403);
    await authed(app, session).get('/api/v1/creator/coupons').expect(403);
    await authed(app, session).get('/api/v1/creator/billing/invoices').expect(403);
    await authed(app, session).get('/api/v1/creator/website').expect(403);
    await authed(app, session).get('/api/v1/creator/leads').expect(403);
    await authed(app, session).post('/api/v1/creator/blog/posts').send({ title: 'x' }).expect(403);
    await authed(app, session).post('/api/v1/creator/billing/checkout').send({ planPriceId: 'ckxxxxxxxxxxxxxxxxxxxxxxx' }).expect(403);
    await authed(app, session).put('/api/v1/creator/payments/razorpay').send({ keyId: 'rzp_test_AbCdEf123456', keySecret: 'secret-secret' }).expect(403);

    // Removing membership cuts access immediately (membership verified per request).
    await prisma.tenantMember.updateMany({ where: { userId: user.id }, data: { status: 'REMOVED' } });
    await authed(app, session).get('/api/v1/creator/workspace').expect(404);
  });

  it('unknown and unverified hosts resolve to nothing', async () => {
    await api(app).post('/api/v1/auth/login').set('Host', 'learn.alpha-example.com').send({ email: 'a@b.co', password: 'whatever-123' }).expect(404);
    await api(app).post('/api/v1/auth/login').set('Host', 'nope.lvh.me').send({ email: 'a@b.co', password: 'whatever-123' }).expect(404);
    await api(app).get('/api/v1/public/site').set('Host', PLATFORM).expect(404);
  });

  it('verified custom domains route to their academy', async () => {
    await prisma.tenantDomain.update({ where: { id: domainA.id }, data: { status: 'VERIFIED' } });
    await app.get(HostResolverService).invalidate('learn.alpha-example.com');
    const site = await api(app).get('/api/v1/public/site').set('Host', 'learn.alpha-example.com').expect(200);
    expect(site.body.data.name).toBe('Alpha Academy');
  });

  it('the tenant-scoped data client refuses to run without a tenant context', async () => {
    const db = app.get<TenantPrismaClient>(TENANT_PRISMA);
    await expect(db.tenantDomain.findMany()).rejects.toBeInstanceOf(TenantContextMissingError);
    const ctx = app.get(TenantContext);
    const own = await ctx.run(B.tenant.id, () => db.tenantDomain.findMany());
    expect(own.every((d) => d.tenantId === B.tenant.id)).toBe(true);
    const cross = await ctx.run(B.tenant.id, () => db.tenantDomain.findUnique({ where: { id: domainA.id } }));
    expect(cross).toBeNull();
    await expect(ctx.run(B.tenant.id, () => db.tenantDomain.update({ where: { id: domainA.id }, data: { isPrimary: true } }))).rejects.toThrow();
  });

  it('every workspace route is covered by this suite', () => {
    const router = (app.getHttpAdapter().getInstance() as { router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } }).router;
    const routes = router.stack
      .filter((l) => l.route?.path.startsWith('/api/v1/creator'))
      .flatMap((l) => Object.keys(l.route!.methods).filter((m) => m !== '_all').map((m) => `${m.toUpperCase()} ${l.route!.path}`));
    expect(routes.length).toBeGreaterThan(0);
    const uncovered = routes.filter((r) => !WORKSPACE_ROUTES_COVERED.includes(r));
    expect(uncovered).toEqual([]);
  });
});
