import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { EntitlementsService } from '../src/modules/subscriptions/entitlements.service.js';
import { adminWithRoles, api, authed, createTestApp, lastEmail, PLATFORM, registerCreator, resetDatabase, tokenFromEmail } from './helpers.js';

describe('Super Admin — integrations, domains, analytics, email templates (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof adminWithRoles>>;
  let support: Awaited<ReturnType<typeof adminWithRoles>>;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    admin = await adminWithRoles(app, ['SUPER_ADMIN']);
    support = await adminWithRoles(app, ['SUPPORT_ADMIN']);
  });
  afterAll(async () => app?.close());

  it('integrations: status of every service without secrets; system read permission required', async () => {
    const res = (await authed(app, admin.session).get('/api/v1/platform/integrations').expect(200)).body.data;
    const keys = res.items.map((i: any) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['smtp', 'whatsapp', 'razorpay-platform', 'razorpay-academies', 'bunny', 'livekit', 'zoom', 'anthropic', 'google-drive']));
    expect(res.summary.total).toBe(res.items.length);
    const whatsapp = res.items.find((i: any) => i.key === 'whatsapp');
    expect(whatsapp).toMatchObject({ configured: false, configuredIn: 'environment' });
    expect(whatsapp.missing).toEqual(expect.arrayContaining(['WHATSAPP_ACCESS_TOKEN']));
    const json = JSON.stringify(res);
    for (const secret of [process.env.JWT_ACCESS_SECRET, process.env.ENCRYPTION_KEY, process.env.SMTP_PASS].filter((s) => s && s.length > 6)) expect(json).not.toContain(secret);
    await authed(app, support.session).get('/api/v1/platform/integrations').expect(403);
  });

  it('domains: every academy’s hostnames, re-check DNS, detach a custom domain', async () => {
    const c = await registerCreator(app, { businessName: 'Domain Academy' });
    await prisma.tenantLimitOverride.create({ data: { tenantId: c.tenant.id, featureKey: 'domains.custom', enabled: true, limitValue: 5n } });
    await app.get(EntitlementsService).invalidate(c.tenant.id);
    const custom = (await authed(app, c.session).post('/api/v1/creator/domains').send({ hostname: 'learn.domain-academy.invalid' }).expect(201)).body.data;

    const all = await authed(app, support.session).get('/api/v1/platform/domains').expect(200);
    expect(all.body.data.map((d: any) => d.hostname)).toEqual(expect.arrayContaining(['domain-academy.lvh.me', 'learn.domain-academy.invalid']));
    expect(all.body.data.find((d: any) => d.id === custom.id)).toMatchObject({ type: 'CUSTOM', status: 'PENDING', tenant: { name: 'Domain Academy' } });
    expect(JSON.stringify(all.body.data)).not.toContain('verificationToken');
    const filtered = (await authed(app, admin.session).get('/api/v1/platform/domains').query({ type: 'CUSTOM', q: 'domain-academy' }).expect(200)).body.data;
    expect(filtered.map((d: any) => d.id)).toEqual([custom.id]);
    expect((await authed(app, admin.session).get('/api/v1/platform/domains/summary').expect(200)).body.data).toMatchObject({ custom: 1, customPending: 1 });

    // Support can look but not act.
    await authed(app, support.session).post(`/api/v1/platform/domains/${custom.id}/verify`).expect(403);
    const checked = (await authed(app, admin.session).post(`/api/v1/platform/domains/${custom.id}/verify`).expect(201)).body.data;
    expect(checked).toMatchObject({ ok: false, status: 'FAILED' });
    expect(checked.lastCheckError).toBeTruthy();

    const sub = all.body.data.find((d: any) => d.hostname === 'domain-academy.lvh.me');
    await authed(app, admin.session).delete(`/api/v1/platform/domains/${sub.id}`).expect(422);
    await authed(app, admin.session).delete(`/api/v1/platform/domains/${custom.id}`).expect(200);
    expect(await prisma.tenantDomain.findUnique({ where: { id: custom.id } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'domain.detach', targetId: custom.id } })).toBe(1);
  });

  it('analytics: growth, engagement, conversion, activation and adoption across academies', async () => {
    const a = (await authed(app, support.session).get('/api/v1/platform/analytics').expect(200)).body.data;
    expect(a.totals.newAcademies).toBeGreaterThanOrEqual(1);
    expect(a.series.enrollments).toHaveLength(30);
    expect(a.series.gmv.points).toHaveLength(30);
    expect(a.activation[0]).toMatchObject({ step: 'Signed up' });
    expect(a.activation[0].count).toBeGreaterThanOrEqual(1);
    expect(a.adoption.features.map((f: any) => f.feature)).toEqual(expect.arrayContaining(['Published a course', 'Upsells & bumps', 'Payment links', 'Custom domain']));
    await authed(app, admin.session).get('/api/v1/platform/analytics').query({ from: 'nope' }).expect(422);
  });

  it('email templates: reword, validate placeholders, preview, test-send, real emails use it, reset', async () => {
    const list = (await authed(app, admin.session).get('/api/v1/platform/email-templates').expect(200)).body.data;
    expect(list.map((t: any) => t.key)).toEqual(expect.arrayContaining(['verifyEmail', 'otp', 'passwordReset', 'purchaseReceipt', 'checkoutRecovery']));
    await authed(app, support.session).get('/api/v1/platform/email-templates').expect(403);
    const one = (await authed(app, admin.session).get('/api/v1/platform/email-templates/otp').expect(200)).body.data;
    expect(one).toMatchObject({ customized: false, required: ['code'] });
    await authed(app, admin.session).get('/api/v1/platform/email-templates/nope').expect(404);

    const unknown = await authed(app, admin.session).put('/api/v1/platform/email-templates/passwordReset').send({ subject: 'Hi {{nickname}}', heading: 'Reset', body: 'Click below.' }).expect(422);
    expect(unknown.body.error.details[0].message).toContain('{{nickname}}');
    const missing = await authed(app, admin.session).put('/api/v1/platform/email-templates/otp').send({ subject: 'Your code', heading: 'Code', body: 'No code here' }).expect(422);
    expect(missing.body.error.details[0].message).toContain('{{code}}');

    const preview = (await authed(app, admin.session).post('/api/v1/platform/email-templates/passwordReset/preview').send({ subject: 'Reset for {{brand}}', heading: 'Hello <b>{{name}}</b>', body: 'Hi **{{name}}**,\n\nUse the button.', ctaLabel: 'Choose a new password' }).expect(201)).body.data;
    expect(preview.subject).toBe('Reset for Acme Academy');
    expect(preview.html).toContain('Hello &lt;b&gt;Priya Sharma&lt;/b&gt;');
    expect(preview.html).toContain('<strong>Priya Sharma</strong>');
    expect(preview.html).toContain('Choose a new password');

    const sent = (await authed(app, admin.session).post('/api/v1/platform/email-templates/passwordReset/test').send({ subject: 'Reset for {{brand}}', heading: 'Reset', body: 'Hi {{name}}' }).expect(201)).body.data;
    expect(sent.sentTo).toBe(admin.email);
    expect((await lastEmail(app, admin.email))!.subject).toBe('[Test] Reset for Acme Academy');

    await authed(app, admin.session).put('/api/v1/platform/email-templates/passwordReset').send({ subject: '{{brand}}: new password requested', heading: 'Let’s get you back in', body: 'Hi {{name}},\n\nSomeone (hopefully you) asked to reset your password.', ctaLabel: 'Reset it' }).expect(200);
    const c = await registerCreator(app);
    await api(app).post('/api/v1/auth/password/forgot').set('Host', PLATFORM).send({ email: c.body.email }).expect(200);
    const mail = await lastEmail(app, c.body.email);
    expect(mail).toMatchObject({ tag: 'password-reset', subject: expect.stringMatching(/: new password requested$/) });
    expect(mail!.text).toContain('Someone (hopefully you) asked to reset your password.');
    expect(mail!.text).toContain('Reset it: ');
    expect(tokenFromEmail(mail!.text)).toBeTruthy();
    expect((mail as any).template).toBeUndefined();

    await authed(app, admin.session).delete('/api/v1/platform/email-templates/passwordReset').expect(200);
    await api(app).post('/api/v1/auth/password/forgot').set('Host', PLATFORM).send({ email: c.body.email }).expect(200);
    expect((await lastEmail(app, c.body.email))!.subject).toMatch(/^Reset your .+ password$/);
    expect(await prisma.auditLog.count({ where: { action: { in: ['email_template.update', 'email_template.reset'] }, targetId: 'passwordReset' } })).toBe(2);
  });

  it('finance tax report: GST on paid platform invoices by month, rate and type; open/void invoices excluded', async () => {
    const { tenant } = await registerCreator(app, { businessName: 'Tax Academy' });
    const base = { tenantId: tenant.id, currency: 'INR', lines: [], dueAt: new Date() };
    await prisma.billingInvoice.createMany({
      data: [
        { ...base, kind: 'PLAN', status: 'PAID', number: 'PLT-T-1', subtotalAmount: 1000, taxAmount: 180, totalAmount: 1180, taxRate: 18, paidAt: new Date() },
        { ...base, kind: 'COMMISSION', status: 'PAID', number: 'PLT-T-2', subtotalAmount: 500, taxAmount: 90, totalAmount: 590, taxRate: 18, paidAt: new Date() },
        { ...base, kind: 'RENEWAL', status: 'OPEN', subtotalAmount: 999, taxAmount: 0, totalAmount: 999 },
        { ...base, kind: 'PLAN', status: 'VOID', subtotalAmount: 999, taxAmount: 0, totalAmount: 999 },
      ],
    });
    const r = (await authed(app, admin.session).get('/api/v1/platform/finance/tax').expect(200)).body.data;
    expect(r.totals).toEqual([{ currency: 'INR', invoices: 2, taxable: 1500, tax: 270, total: 1770 }]);
    expect(r.rates).toEqual([expect.objectContaining({ rate: 18, invoices: 2, tax: 270 })]);
    expect(r.kinds.map((k: { kind: string }) => k.kind).sort()).toEqual(['COMMISSION', 'PLAN']);
    expect(r.months).toHaveLength(1);
    expect(r.invoices.map((i: { number: string }) => i.number)).toEqual(['PLT-T-2', 'PLT-T-1']);
    expect(r.invoices[0]).toMatchObject({ tenant: { name: 'Tax Academy' }, taxable: 500, tax: 90 });
    await authed(app, support.session).get('/api/v1/platform/finance/tax').expect(403);
  });
});
