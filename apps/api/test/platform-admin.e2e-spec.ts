import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { adminWithRoles, api, authed, createTestApp, lastEmail, login, PLATFORM, registerCreator, resetDatabase, superAdmin, tenantHost, uniqueEmail, type Session } from './helpers.js';

describe('Platform administration (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let root: Session;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    root = (await superAdmin(app)).session;
  });
  afterAll(async () => app?.close());

  it('new academies start on the default plan (trial)', async () => {
    const c = await registerCreator(app);
    const billing = await authed(app, c.session).get('/api/v1/creator/billing').expect(200);
    expect(billing.body.data.subscription).toMatchObject({ status: 'TRIALING', plan: { code: 'trial' } });
    expect(billing.body.data.entitlements.features['courses.max']).toEqual({ enabled: true, limit: 3 });
    expect(new Date(billing.body.data.subscription.trialEndsAt).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
  });

  it('creates and edits plans with features and prices; validates input', async () => {
    const body = {
      code: 'campus', name: 'Campus', description: 'For institutes', status: 'ACTIVE', isPublic: true, isDefault: false, trialDays: 0, sortOrder: 5,
      features: [{ featureKey: 'courses.max', enabled: true, limitValue: 500 }, { featureKey: 'white_label', enabled: true }],
      prices: [{ interval: 'MONTH', currency: 'INR', amount: 14999 }, { interval: 'YEAR', currency: 'INR', amount: 149990 }],
    };
    const created = await authed(app, root).post('/api/v1/platform/plans').send(body).expect(201);
    expect(created.body.data.prices).toHaveLength(2);
    expect(created.body.data.features).toEqual(expect.arrayContaining([{ featureKey: 'courses.max', enabled: true, limitValue: 500 }]));

    await authed(app, root).post('/api/v1/platform/plans').send({ ...body, code: 'bad', features: [{ featureKey: 'teleport', enabled: true }] }).expect(422);
    await authed(app, root).post('/api/v1/platform/plans').send(body).expect(409); // duplicate code

    const updated = await authed(app, root).put(`/api/v1/platform/plans/${created.body.data.id}`).send({ ...body, prices: [{ interval: 'MONTH', currency: 'INR', amount: 12999 }] }).expect(200);
    const prices = updated.body.data.prices;
    expect(prices.find((p: any) => p.interval === 'MONTH')).toMatchObject({ amount: '12999', active: true });
    expect(prices.find((p: any) => p.interval === 'YEAR')).toMatchObject({ active: false }); // kept for history, deactivated
    const pub = await api(app).get('/api/v1/public/plans').set('Host', PLATFORM).expect(200);
    expect(pub.body.data.map((p: any) => p.code)).toEqual(expect.arrayContaining(['grow', 'rise', 'campus']));
    expect(await prisma.auditLog.count({ where: { action: { in: ['plan.create', 'plan.update'] } } })).toBe(2);
  });

  it('lists, filters and inspects tenants', async () => {
    const c = await registerCreator(app, { businessName: 'Filter Me Academy' });
    const list = await authed(app, root).get('/api/v1/platform/tenants?q=filter-me&pageSize=5').expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta).toMatchObject({ page: 1, pageSize: 5, total: 1 });
    expect(list.body.data[0]).toMatchObject({ slug: 'filter-me-academy', subscription: { status: 'TRIALING' } });
    const detail = await authed(app, root).get(`/api/v1/platform/tenants/${c.tenant.id}`).expect(200);
    expect(detail.body.data.owner.email).toBe(c.body.email);
    expect(detail.body.data.domains[0].hostname).toBe('filter-me-academy.lvh.me');
    expect(JSON.stringify(detail.body)).not.toMatch(/passwordHash|verificationToken/);
  });

  it('super admin provisions an agency; the owner signs in with the emailed temporary password', async () => {
    const email = uniqueEmail('agency');
    await authed(app, root).post('/api/v1/platform/tenants').send({ name: 'X', ownerName: 'Neha Owner', email }).expect(422);
    const created = await authed(app, root)
      .post('/api/v1/platform/tenants')
      .send({ name: 'Bright <b>Minds</b>', ownerName: 'Neha Owner', email, subdomain: 'bright-minds', paymentType: 'TRIAL', trialDays: 30 })
      .expect(201);
    const { tenant, owner } = created.body.data;
    expect(tenant).toMatchObject({ slug: 'bright-minds', status: 'ACTIVE' });
    expect(owner).toMatchObject({ email, isNewUser: true, tempPassword: expect.any(String) });

    const mail = await lastEmail(app, email);
    expect(mail?.tag).toBe('admin-agency-created');
    expect(mail!.html).toContain('http://bright-minds.lvh.me:5173');
    expect(mail!.html).toContain('Bright &lt;b&gt;Minds&lt;/b&gt;');
    expect(mail!.html).toContain(owner.tempPassword);

    const { session } = await login(app, PLATFORM, email, owner.tempPassword);
    const billing = await authed(app, session).get('/api/v1/creator/billing').expect(200);
    expect(billing.body.data.subscription.status).toBe('TRIALING');
    expect(new Date(billing.body.data.subscription.trialEndsAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(await prisma.auditLog.count({ where: { action: 'tenant.create_by_admin', targetId: tenant.id } })).toBe(1);
    const stored = await prisma.auditLog.findFirstOrThrow({ where: { action: 'tenant.create_by_admin', targetId: tenant.id } });
    expect(JSON.stringify(stored)).not.toContain(owner.tempPassword);

    // Edit: slug is normalized, reserved/taken slugs refused, the subdomain follows the slug.
    await authed(app, root).patch(`/api/v1/platform/tenants/${tenant.id}`).send({ slug: 'admin' }).expect(422);
    const edited = await authed(app, root).patch(`/api/v1/platform/tenants/${tenant.id}`).send({ slug: 'Bright Minds Two', ownerName: 'Neha K' }).expect(200);
    expect(edited.body.data.slug).toBe('bright-minds-two');
    expect(edited.body.data.domains[0].hostname).toBe('bright-minds-two.lvh.me');

    const creators = await authed(app, root).get(`/api/v1/platform/tenants/creators?q=${encodeURIComponent(email)}`).expect(200);
    expect(creators.body.data).toEqual([expect.objectContaining({ email, fullName: 'Neha K', academies: [expect.objectContaining({ id: tenant.id })] })]);

    const c = await registerCreator(app);
    await authed(app, c.session).post('/api/v1/platform/tenants').send({ name: 'Nope', ownerName: 'Nope', email: uniqueEmail() }).expect(403);
  });

  it('purges tenants whose deletion window has passed', async () => {
    const c = await registerCreator(app);
    await authed(app, root).delete(`/api/v1/platform/tenants/${c.tenant.id}`).send({ confirmSlug: c.tenant.slug }).expect(200);
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { deletionScheduledAt: new Date(Date.now() - 1000) } });
    const res = await authed(app, root).post('/api/v1/platform/tenants/purge-expired').expect(200);
    expect(res.body.data).toEqual({ purgedCount: 1, tenants: [c.tenant.slug] });
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: c.tenant.id } })).status).toBe('DELETED');
    expect(await prisma.tenantDomain.count({ where: { tenantId: c.tenant.id } })).toBe(0);
    await api(app).get('/api/v1/public/site').set('Host', tenantHost(c.tenant.slug)).expect(404);
  });

  it('suspension makes the workspace read-only and closes the academy; activation restores it', async () => {
    const c = await registerCreator(app);
    await prisma.tenantLimitOverride.create({ data: { tenantId: c.tenant.id, featureKey: 'domains.custom', enabled: true, limitValue: 3n } });
    await authed(app, root).put(`/api/v1/platform/tenants/${c.tenant.id}/limits`).send({ overrides: [{ featureKey: 'domains.custom', enabled: true, limitValue: 3 }] }).expect(200);
    await authed(app, root).post(`/api/v1/platform/tenants/${c.tenant.id}/activate`).expect(200);
    const student = await api(app).post('/api/v1/auth/register/student').set('Host', tenantHost(c.tenant.slug)).send({ fullName: 'Stu', email: uniqueEmail(), password: 'student-password-1' }).expect(201);
    const studentAuth = { accessToken: student.body.data.accessToken, host: tenantHost(c.tenant.slug) };

    await authed(app, root).post(`/api/v1/platform/tenants/${c.tenant.id}/suspend`).send({ reason: 'Chargeback investigation' }).expect(200);
    await authed(app, c.session).get('/api/v1/creator/workspace').expect(200); // read-only access
    const blocked = await authed(app, c.session).post('/api/v1/creator/domains').send({ hostname: 'learn.suspended-example.com' }).expect(403);
    expect(blocked.body.error.code).toBe('TENANT_SUSPENDED');
    await authed(app, c.session).post('/api/v1/creator/support/tickets').send({ subject: 'Why am I suspended?', category: 'account', priority: 'HIGH', body: 'Please explain the suspension.' }).expect(201);
    await authed(app, studentAuth).get('/api/v1/auth/me').expect(401); // students signed out
    const site = await api(app).get('/api/v1/public/site').set('Host', tenantHost(c.tenant.slug)).expect(200);
    expect(site.body.data.isLive).toBe(false);

    await authed(app, root).post(`/api/v1/platform/tenants/${c.tenant.id}/activate`).expect(200);
    await authed(app, c.session).post('/api/v1/creator/domains').send({ hostname: 'learn.restored-example.com' }).expect(201);
    expect(await prisma.auditLog.count({ where: { tenantId: c.tenant.id, action: { in: ['tenant.suspend', 'tenant.activate'] } } })).toBe(3);
  });

  it('plan changes and overrides drive feature limits', async () => {
    const c = await registerCreator(app);
    const denied = await authed(app, c.session).post('/api/v1/creator/domains').send({ hostname: 'learn.limit-example.com' }).expect(403);
    expect(denied.body.error.code).toBe('PLAN_LIMIT_REACHED');

    const grow = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { code: 'grow' }, include: { prices: true } });
    const yearInr = grow.prices.find((p) => p.interval === 'YEAR' && p.currency === 'INR')!;
    const changed = await authed(app, root).post(`/api/v1/platform/tenants/${c.tenant.id}/subscription`).send({ planId: grow.id, planPriceId: yearInr.id }).expect(200);
    expect(changed.body.data).toMatchObject({ status: 'ACTIVE', plan: { code: 'grow' } });
    await authed(app, c.session).post('/api/v1/creator/domains').send({ hostname: 'learn.limit-example.com' }).expect(201);
    const second = await authed(app, c.session).post('/api/v1/creator/domains').send({ hostname: 'two.limit-example.com' }).expect(403);
    expect(second.body.error.code).toBe('PLAN_LIMIT_REACHED');

    await authed(app, root).put(`/api/v1/platform/tenants/${c.tenant.id}/limits`).send({ overrides: [{ featureKey: 'domains.custom', enabled: true, limitValue: 2, reason: 'Enterprise pilot' }] }).expect(200);
    await authed(app, c.session).post('/api/v1/creator/domains').send({ hostname: 'two.limit-example.com' }).expect(201);
    expect(await prisma.subscription.count({ where: { tenantId: c.tenant.id } })).toBe(2);
    expect(await prisma.subscription.count({ where: { tenantId: c.tenant.id, currentKey: 'current' } })).toBe(1);
  });

  it('schedules deletion only with typed confirmation and allows restore', async () => {
    const c = await registerCreator(app);
    await authed(app, root).delete(`/api/v1/platform/tenants/${c.tenant.id}`).send({ confirmSlug: 'nope' }).expect(422);
    const del = await authed(app, root).delete(`/api/v1/platform/tenants/${c.tenant.id}`).send({ confirmSlug: c.tenant.slug }).expect(200);
    expect(del.body.data.status).toBe('PENDING_DELETION');
    await authed(app, c.session).post('/api/v1/creator/support/tickets').send({ subject: 'Please restore', category: 'account', priority: 'URGENT', body: 'We deleted by mistake.' }).expect(201);
    await authed(app, root).post(`/api/v1/platform/tenants/${c.tenant.id}/restore`).expect(200);
  });

  it('validates and stores settings; unknown keys rejected; public branding updates', async () => {
    const bad = await authed(app, root).put('/api/v1/platform/settings').send({ items: [{ key: 'general.defaultCurrency', value: 'rupees' }, { key: 'evil.key', value: 1 }] }).expect(422);
    expect(bad.body.error.details.map((d: any) => d.field).sort()).toEqual(['evil.key', 'general.defaultCurrency']);
    await authed(app, root).put('/api/v1/platform/settings').send({ items: [{ key: 'branding.name', value: 'LearnHub' }, { key: 'system.maintenanceMode', value: false }, { key: 'tax.defaultGstRate', value: 18 }] }).expect(200);
    const info = await api(app).get('/api/v1/system/info').expect(200);
    expect(info.body.data.name).toBe('LearnHub');
    const settings = await authed(app, root).get('/api/v1/platform/settings').expect(200);
    expect(settings.body.data.find((g: any) => g.group === 'tax').items.find((i: any) => i.key === 'tax.defaultGstRate').value).toBe(18);
  });

  it('manages administrators with safeguards and role-based access', async () => {
    const invited = await authed(app, root).post('/api/v1/platform/admins').send({ email: 'support.lead@platform.test', fullName: 'Support Lead', roles: ['SUPPORT_ADMIN'] }).expect(201);
    expect(invited.body.data.invited).toBe(true);
    expect((await lastEmail(app, 'support.lead@platform.test'))?.tag).toBe('admin-invite');

    const me = await authed(app, root).get('/api/v1/auth/me').expect(200);
    await authed(app, root).put(`/api/v1/platform/admins/${me.body.data.user.id}/roles`).send({ roles: ['SUPPORT_ADMIN'] }).expect(403);
    await authed(app, root).post(`/api/v1/platform/admins/${me.body.data.user.id}/suspend`).expect(403);

    const support = await adminWithRoles(app, ['SUPPORT_ADMIN']);
    await authed(app, support.session).get('/api/v1/platform/support/tickets').expect(200);
    await authed(app, support.session).get('/api/v1/platform/tenants').expect(200); // read
    await authed(app, support.session).post('/api/v1/platform/plans').send({}).expect(403);
    await authed(app, support.session).get('/api/v1/platform/settings').expect(403);
    await authed(app, support.session).get('/api/v1/platform/admins').expect(403);

    const finance = await adminWithRoles(app, ['FINANCE_ADMIN']);
    await authed(app, finance.session).get('/api/v1/platform/dashboard').expect(200);
    await authed(app, finance.session).get('/api/v1/platform/support/tickets').expect(403);

    await authed(app, root).post(`/api/v1/platform/admins/${support.userId}/suspend`).expect(200);
    await authed(app, support.session).get('/api/v1/auth/me').expect(401);
    expect((await login(app, PLATFORM, support.email, 'admin-password-1')).res.status).toBe(403);
  });

  it('creators can never reach platform endpoints', async () => {
    const c = await registerCreator(app);
    await authed(app, c.session).get('/api/v1/platform/tenants').expect(403);
    await authed(app, c.session).get('/api/v1/platform/dashboard').expect(403);
    await authed(app, c.session).get('/api/v1/platform/audit-logs').expect(403);
  });

  it('dashboard metrics reflect the database', async () => {
    const res = await authed(app, root).get('/api/v1/platform/dashboard').expect(200);
    const d = res.body.data;
    expect(d.tenants.total).toBe(await prisma.tenant.count({ where: { status: { not: 'DELETED' } } }));
    expect(d.students).toBe(await prisma.user.count({ where: { realm: 'TENANT' } }));
    expect(d.series.tenantRegistrations).toHaveLength(30);
    expect(d.series.tenantRegistrations.reduce((s: number, x: any) => s + x.count, 0)).toBe(await prisma.tenant.count()); // registrations include since-deleted tenants
    expect(d.subscriptions.mrr).toEqual(expect.arrayContaining([{ currency: 'INR', amount: 2999 }]));
    expect(d.commerce).toMatchObject({ available: true, paidOrders: 0, gmv: [] });
  });

  it('support ticket conversation with internal notes and SLA fields', async () => {
    const c = await registerCreator(app);
    const ticket = await authed(app, c.session).post('/api/v1/creator/support/tickets').send({ subject: 'Video upload failing', category: 'technical', priority: 'HIGH', body: 'Uploads stop at 90 percent.' }).expect(201);
    const id = ticket.body.data.id;
    const support = await adminWithRoles(app, ['SUPPORT_ADMIN']);
    const inbox = await authed(app, support.session).get('/api/v1/platform/support/tickets?view=unassigned').expect(200);
    expect(inbox.body.data.find((t: any) => t.id === id)).toMatchObject({ priority: 'HIGH', slaDueAt: expect.any(String), tenant: { id: c.tenant.id } });

    await authed(app, support.session).post(`/api/v1/platform/support/tickets/${id}/messages`).send({ body: 'Customer is on trial plan', internal: true }).expect(201);
    await authed(app, support.session).post(`/api/v1/platform/support/tickets/${id}/messages`).send({ body: 'Please retry with the latest browser.' }).expect(201);
    await authed(app, support.session).patch(`/api/v1/platform/support/tickets/${id}`).send({ status: 'RESOLVED' }).expect(200);

    const creatorView = await authed(app, c.session).get(`/api/v1/creator/support/tickets/${id}`).expect(200);
    expect(creatorView.body.data.messages.map((m: any) => m.body)).toEqual(['Uploads stop at 90 percent.', 'Please retry with the latest browser.']);
    expect(JSON.stringify(creatorView.body)).not.toContain('trial plan');
    expect(creatorView.body.data.status).toBe('RESOLVED');
    expect((await lastEmail(app, c.body.email))?.tag).toBe('support-reply');

    await authed(app, c.session).post(`/api/v1/creator/support/tickets/${id}/messages`).send({ body: 'Still failing.' }).expect(201);
    expect((await authed(app, c.session).get(`/api/v1/creator/support/tickets/${id}`)).body.data.status).toBe('OPEN'); // reopened
    const report = await authed(app, support.session).get('/api/v1/platform/support/report').expect(200);
    expect(report.body.data.avgFirstResponseHours).not.toBeNull();
  });

  it('categories and announcements', async () => {
    const cat = await authed(app, root).post('/api/v1/platform/categories').send({ name: 'Programming' }).expect(201);
    await authed(app, root).post('/api/v1/platform/categories').send({ name: 'Programming' }).expect(409);
    await authed(app, root).post('/api/v1/platform/categories').send({ name: 'Web Development', parentId: cat.body.data.id }).expect(201);
    const pub = await api(app).get('/api/v1/public/categories').expect(200);
    expect(pub.body.data.map((c: any) => c.slug)).toEqual(['programming', 'web-development']);

    await authed(app, root).post('/api/v1/platform/announcements').send({ audience: 'CREATORS', title: 'Scheduled maintenance', body: 'Sunday 2am UTC', tone: 'warning', startsAt: new Date(Date.now() - 1000).toISOString() }).expect(201);
    await authed(app, root).post('/api/v1/platform/announcements').send({ audience: 'STUDENTS', title: 'Student only', body: 'Hi students', tone: 'info', startsAt: new Date(Date.now() - 1000).toISOString() }).expect(201);
    const c = await registerCreator(app);
    const active = await authed(app, c.session).get('/api/v1/announcements/active').expect(200);
    expect(active.body.data.map((a: any) => a.title)).toEqual(['Scheduled maintenance']);
  });

  it('audit log is queryable with filters', async () => {
    const res = await authed(app, root).get('/api/v1/platform/audit-logs?action=tenant.&pageSize=50').expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((r: any) => r.action.startsWith('tenant.'))).toBe(true);
  });
});
