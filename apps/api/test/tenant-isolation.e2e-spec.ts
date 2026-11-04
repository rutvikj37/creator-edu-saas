import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../src/core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../src/core/tenancy/tenant-prisma.js';
import { TenantContextMissingError } from '../src/core/tenancy/tenant-prisma.js';
import { TenantContext } from '../src/core/tenancy/tenant-context.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { PasswordService } from '../src/modules/auth/services/password.service.js';
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
  });

  it('client-supplied tenantId is rejected, never trusted', async () => {
    const res = await authed(app, B.session).post('/api/v1/creator/domains').send({ hostname: 'learn.beta-example.com', tenantId: A.tenant.id }).expect(422);
    expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'tenantId' })]);
    await authed(app, B.session).get(`/api/v1/creator/domains?tenantId=${A.tenant.id}`).expect(200).then((r) => {
      expect(r.body.data.every((d: { hostname: string }) => d.hostname.startsWith('beta'))).toBe(true);
    });
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
