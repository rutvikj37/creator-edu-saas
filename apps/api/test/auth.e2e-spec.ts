import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import {
  api, authed, codeFromEmail, createTestApp, emailCount, lastEmail, login, nextTotp, parseSession, PLATFORM, registerCreator,
  resetDatabase, tenantHost, tokenFromEmail, uniqueEmail,
} from './helpers.js';

describe('Authentication (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(async () => app?.close());

  describe('creator registration', () => {
    it('creates account, academy workspace, owner membership and subdomain atomically', async () => {
      const { body, res, session, tenant } = await registerCreator(app, { businessName: 'Riya’s Coding Académie' });
      expect(res.body.data.accessToken).toBeTruthy();
      expect(session.cookies.some((c) => c.startsWith('rt='))).toBe(true);
      expect(session.csrf).toBeTruthy();
      expect(tenant.slug).toBe('riya-s-coding-academie');
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|refreshToken/);

      const me = await authed(app, session).get('/api/v1/auth/me').expect(200);
      expect(me.body.data.user.email).toBe(body.email);
      expect(me.body.data.user.emailVerifiedAt).toBeNull();
      expect(me.body.data.memberships).toEqual([expect.objectContaining({ id: tenant.id, role: expect.objectContaining({ key: 'OWNER' }) })]);
      expect(me.body.data.activeTenantId).toBe(tenant.id);
      expect(me.body.data.permissions).toContain('domains.manage');
      expect(me.body.data.permissions).not.toContain('platform.tenants.manage');

      const domains = await authed(app, session).get('/api/v1/creator/domains').expect(200);
      expect(domains.body.data).toEqual([expect.objectContaining({ hostname: `${tenant.slug}.lvh.me`, type: 'SUBDOMAIN', status: 'VERIFIED', isPrimary: true })]);
      expect(JSON.stringify(domains.body)).not.toContain('verificationToken');

      const audit = await prisma.auditLog.findFirst({ where: { action: 'tenant.create', targetId: tenant.id } });
      expect(audit).not.toBeNull();
    });

    it('generates unique slugs for duplicate academy names', async () => {
      const a = await registerCreator(app, { businessName: 'Same Name Academy' });
      const b = await registerCreator(app, { businessName: 'Same Name Academy' });
      expect(a.tenant.slug).toBe('same-name-academy');
      expect(b.tenant.slug).toBe('same-name-academy-2');
    });

    it('rejects duplicates and invalid input with field errors', async () => {
      const { body } = await registerCreator(app);
      await api(app).post('/api/v1/auth/register/creator').set('Host', PLATFORM).send(body).expect(409);
      const bad = await api(app)
        .post('/api/v1/auth/register/creator')
        .set('Host', PLATFORM)
        .send({ fullName: 'X', email: 'nope', password: 'short', country: 'India', businessName: 'Y', role: 'SUPER_ADMIN' })
        .expect(422);
      const fields = bad.body.error.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(expect.arrayContaining(['fullName', 'email', 'password', 'country', 'businessName', 'role']));
    });

    it('is only available on the platform host', async () => {
      const { tenant } = await registerCreator(app);
      const valid = { fullName: 'Valid Person', email: uniqueEmail(), password: 'correct-horse-battery', country: 'IN', businessName: 'Valid Academy' };
      await api(app).post('/api/v1/auth/register/creator').set('Host', tenantHost(tenant.slug)).send(valid).expect(404);
      await api(app).post('/api/v1/auth/register/creator').set('Host', 'unknown.example.com').send(valid).expect(404);
    });
  });

  describe('email verification', () => {
    it('verifies by link once; the token cannot be reused', async () => {
      const { body, session } = await registerCreator(app);
      const mail = await lastEmail(app, body.email);
      expect(mail?.tag).toBe('verify-email');
      const token = tokenFromEmail(mail!.text);
      await api(app).post('/api/v1/auth/email/verify').set('Host', PLATFORM).send({ token }).expect(200);
      await api(app).post('/api/v1/auth/email/verify').set('Host', PLATFORM).send({ token }).expect(400);
      const me = await authed(app, session).get('/api/v1/auth/me').expect(200);
      expect(me.body.data.user.emailVerifiedAt).not.toBeNull();
    });

    it('verifies by 6-digit code', async () => {
      const { body, session } = await registerCreator(app);
      const code = codeFromEmail((await lastEmail(app, body.email))!.text);
      await authed(app, session).post('/api/v1/auth/email/verify-code').send({ code: code === '000000' ? '111111' : '000000' }).expect(400);
      await authed(app, session).post('/api/v1/auth/email/verify-code').send({ code }).expect(200);
    });

    it('OTP codes lock after 5 wrong attempts', async () => {
      const { body, session } = await registerCreator(app);
      const code = codeFromEmail((await lastEmail(app, body.email))!.text);
      const wrong = code === '123456' ? '654321' : '123456';
      for (let i = 0; i < 5; i++) await authed(app, session).post('/api/v1/auth/email/verify-code').send({ code: wrong }).expect(400);
      await authed(app, session).post('/api/v1/auth/email/verify-code').send({ code }).expect(400);
    });

    it('SMS OTP reports not-configured instead of pretending to send', async () => {
      const { session } = await registerCreator(app, { phone: '+919876543210' });
      const res = await authed(app, session).post('/api/v1/auth/otp/send').send({ purpose: 'PHONE_VERIFY' }).expect(409);
      expect(res.body.error.code).toBe('INTEGRATION_NOT_CONFIGURED');
    });
  });

  describe('login, lockout and sessions', () => {
    it('logs in with correct credentials and gives a generic error otherwise', async () => {
      const { body } = await registerCreator(app);
      const ok = await login(app, PLATFORM, body.email, body.password);
      expect(ok.res.status).toBe(200);
      expect(ok.session.accessToken).toBeTruthy();
      const bad = await login(app, PLATFORM, body.email, 'wrong-password-123');
      const unknown = await login(app, PLATFORM, 'nobody@example.test', 'wrong-password-123');
      expect(bad.res.status).toBe(401);
      expect(unknown.res.status).toBe(401);
      expect(bad.res.body.error.message).toBe(unknown.res.body.error.message);
      const history = await prisma.loginHistory.count({ where: { emailTried: body.email, success: false } });
      expect(history).toBe(1);
    });

    it('locks the account after 5 failed attempts', async () => {
      const { body } = await registerCreator(app);
      for (let i = 0; i < 5; i++) expect((await login(app, PLATFORM, body.email, 'wrong-password-123')).res.status).toBe(401);
      const locked = await login(app, PLATFORM, body.email, body.password);
      expect(locked.res.status).toBe(429);
      expect(locked.res.body.error.code).toBe('ACCOUNT_LOCKED');
    });

    it('rotates refresh tokens, requires CSRF and detects reuse', async () => {
      const { session } = await registerCreator(app);
      await api(app).post('/api/v1/auth/refresh').set('Host', PLATFORM).set('Cookie', session.cookies).expect(403);

      const first = await api(app).post('/api/v1/auth/refresh').set('Host', PLATFORM).set('Cookie', session.cookies).set('X-CSRF-Token', session.csrf).expect(200);
      const rotated = parseSession(first, PLATFORM);
      expect(rotated.accessToken).toBeTruthy();
      expect(rotated.cookies.find((c) => c.startsWith('rt='))).not.toBe(session.cookies.find((c) => c.startsWith('rt=')));

      // Replaying the old refresh token revokes the whole session family…
      await api(app).post('/api/v1/auth/refresh').set('Host', PLATFORM).set('Cookie', session.cookies).set('X-CSRF-Token', session.csrf).expect(401);
      // …so the newer token and its access token stop working too.
      await api(app).post('/api/v1/auth/refresh').set('Host', PLATFORM).set('Cookie', rotated.cookies).set('X-CSRF-Token', rotated.csrf).expect(401);
      await authed(app, rotated).get('/api/v1/auth/me').expect(401);
    });

    it('logout revokes the access token immediately', async () => {
      const { session } = await registerCreator(app);
      await authed(app, session).post('/api/v1/auth/logout').expect(200);
      await authed(app, session).get('/api/v1/auth/me').expect(401);
      await api(app).post('/api/v1/auth/refresh').set('Host', PLATFORM).set('Cookie', session.cookies).set('X-CSRF-Token', session.csrf).expect(401);
    });

    it('lists devices and revokes another session', async () => {
      const { body, session: s1 } = await registerCreator(app);
      const { session: s2 } = await login(app, PLATFORM, body.email, body.password);
      const list = await authed(app, s1).get('/api/v1/auth/sessions').expect(200);
      expect(list.body.data).toHaveLength(2);
      const other = list.body.data.find((s: { current: boolean }) => !s.current);
      await authed(app, s1).delete(`/api/v1/auth/sessions/${other.id}`).expect(200);
      await authed(app, s2).get('/api/v1/auth/me').expect(401);
      await authed(app, s1).get('/api/v1/auth/me').expect(200);
    });

    it("cannot revoke someone else's session", async () => {
      const a = await registerCreator(app);
      const b = await registerCreator(app);
      const bSessions = await authed(app, b.session).get('/api/v1/auth/sessions').expect(200);
      await authed(app, a.session).delete(`/api/v1/auth/sessions/${bSessions.body.data[0].id}`).expect(404);
    });
  });

  describe('password reset and change', () => {
    it('resets via emailed link, signs out other sessions and clears lockout', async () => {
      const { body, session } = await registerCreator(app);
      for (let i = 0; i < 5; i++) await login(app, PLATFORM, body.email, 'wrong-password-123');
      await api(app).post('/api/v1/auth/password/forgot').set('Host', PLATFORM).send({ email: body.email }).expect(200);
      const mail = await lastEmail(app, body.email);
      expect(mail?.tag).toBe('password-reset');
      const token = tokenFromEmail(mail!.text);
      await api(app).post('/api/v1/auth/password/reset').set('Host', PLATFORM).send({ token, password: 'brand-new-password-1' }).expect(200);
      await api(app).post('/api/v1/auth/password/reset').set('Host', PLATFORM).send({ token, password: 'another-password-22' }).expect(400);
      await authed(app, session).get('/api/v1/auth/me').expect(401);
      expect((await login(app, PLATFORM, body.email, body.password)).res.status).toBe(401);
      expect((await login(app, PLATFORM, body.email, 'brand-new-password-1')).res.status).toBe(200);
    });

    it('does not reveal whether an email is registered', async () => {
      const res = await api(app).post('/api/v1/auth/password/forgot').set('Host', PLATFORM).send({ email: 'ghost@example.test' }).expect(200);
      expect(res.body.data).toEqual({ sent: true });
      expect(await emailCount(app, 'ghost@example.test')).toBe(0);
    });

    it('changes password with the current password', async () => {
      const { body, session } = await registerCreator(app);
      const wrong = await authed(app, session).post('/api/v1/auth/password/change').send({ currentPassword: 'nope-nope-nope', newPassword: 'fresh-password-99' }).expect(422);
      expect(wrong.body.error.details[0].field).toBe('currentPassword');
      await authed(app, session).post('/api/v1/auth/password/change').send({ currentPassword: body.password, newPassword: 'fresh-password-99' }).expect(200);
      await authed(app, session).get('/api/v1/auth/me').expect(200); // current session stays
      expect((await login(app, PLATFORM, body.email, 'fresh-password-99')).res.status).toBe(200);
    });
  });

  describe('two-factor authentication', () => {
    it('enrols with TOTP and requires a code at sign-in', async () => {
      const { body, session } = await registerCreator(app);
      const setup = await authed(app, session).post('/api/v1/auth/2fa/setup').expect(200);
      const { secret, otpauthUrl } = setup.body.data;
      expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
      await authed(app, session).post('/api/v1/auth/2fa/enable').send({ code: '000000' }).expect(400);
      const enabled = await authed(app, session).post('/api/v1/auth/2fa/enable').send({ code: nextTotp(secret, 0) }).expect(200);
      expect(enabled.body.data.enabled).toBe(true);

      const first = await login(app, PLATFORM, body.email, body.password);
      expect(first.res.body.data).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
      expect(first.res.headers['set-cookie']).toBeUndefined();
      await api(app).post('/api/v1/auth/login/2fa').set('Host', PLATFORM).send({ mfaToken: first.res.body.data.mfaToken, code: '000000' }).expect(401);
      const ok = await api(app).post('/api/v1/auth/login/2fa').set('Host', PLATFORM).send({ mfaToken: first.res.body.data.mfaToken, code: nextTotp(secret, 1) }).expect(200);
      expect(ok.body.data.accessToken).toBeTruthy();
    });

    it('forces administrators to enrol before using anything else', async () => {
      const res = await login(app, PLATFORM, 'root@platform.test', 'Sup3r-Admin-Passw0rd!');
      expect(res.res.status).toBe(200);
      expect(res.res.body.data.mfaSetupRequired).toBe(true);
      const restricted = await authed(app, res.session).get('/api/v1/auth/sessions').expect(403);
      expect(restricted.body.error.code).toBe('MFA_SETUP_REQUIRED');
      const me = await authed(app, res.session).get('/api/v1/auth/me').expect(200);
      expect(me.body.data.platformRoles).toEqual(['SUPER_ADMIN']);

      const setup = await authed(app, res.session).post('/api/v1/auth/2fa/setup').expect(200);
      const enabled = await authed(app, res.session).post('/api/v1/auth/2fa/enable').send({ code: nextTotp(setup.body.data.secret, 0) }).expect(200);
      const full = parseSession(enabled, PLATFORM);
      await authed(app, full).get('/api/v1/auth/sessions').expect(200);
      await authed(app, res.session).get('/api/v1/auth/me').expect(401); // restricted session was replaced
      await authed(app, full).post('/api/v1/auth/2fa/disable').send({ password: 'Sup3r-Admin-Passw0rd!', code: nextTotp(setup.body.data.secret, 1) }).expect(403);
      expect(await prisma.auditLog.count({ where: { action: 'auth.admin_login' } })).toBeGreaterThan(0);
    });
  });

  describe('students (academy realm)', () => {
    it('only registers on live academies, and accounts are independent per academy', async () => {
      const a = await registerCreator(app);
      const b = await registerCreator(app);
      const email = uniqueEmail('student');
      const student = { fullName: 'Sam Student', email, password: 'student-password-1' };

      await api(app).post('/api/v1/auth/register/student').set('Host', tenantHost(a.tenant.slug)).send(student).expect(403);
      await prisma.tenant.updateMany({ where: { id: { in: [a.tenant.id, b.tenant.id] } }, data: { status: 'ACTIVE' } });
      const { HostResolverService } = await import('../src/core/tenancy/host-resolver.service.js');
      await app.get(HostResolverService).invalidate(tenantHost(a.tenant.slug), tenantHost(b.tenant.slug));

      const regA = await api(app).post('/api/v1/auth/register/student').set('Host', tenantHost(a.tenant.slug)).send(student).expect(201);
      // Same email, different academy → separate account with its own password.
      await api(app).post('/api/v1/auth/register/student').set('Host', tenantHost(b.tenant.slug)).send({ ...student, password: 'other-password-22' }).expect(201);

      const sA = parseSession(regA, tenantHost(a.tenant.slug));
      const me = await authed(app, sA).get('/api/v1/auth/me').expect(200);
      expect(me.body.data.realm).toBe('TENANT');
      expect(me.body.data.permissions).toEqual([]);
      expect(me.body.data.memberships).toEqual([]);

      expect((await login(app, tenantHost(b.tenant.slug), email, 'student-password-1')).res.status).toBe(401);
      expect((await login(app, tenantHost(b.tenant.slug), email, 'other-password-22')).res.status).toBe(200);
      expect((await login(app, PLATFORM, email, 'student-password-1')).res.status).toBe(401);

      const site = await api(app).get('/api/v1/public/site').set('Host', tenantHost(a.tenant.slug)).expect(200);
      expect(site.body.data).toMatchObject({ name: a.tenant.name, isLive: true });
    });
  });

  describe('Google sign-in', () => {
    it('reports not configured instead of faking a provider', async () => {
      const p = await api(app).get('/api/v1/auth/providers').set('Host', PLATFORM).expect(200);
      expect(p.body.data).toEqual({ google: false, sms: false });
      const res = await api(app).get('/api/v1/auth/google/start').set('Host', PLATFORM).expect(409);
      expect(res.body.error.code).toBe('INTEGRATION_NOT_CONFIGURED');
    });
  });
});
