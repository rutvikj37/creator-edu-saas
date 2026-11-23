import type { NestExpressApplication } from '@nestjs/platform-express';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { EntitlementsService } from '../src/modules/subscriptions/entitlements.service.js';
import { api, authed, createTestApp, lastEmail, login, nextTotp, parseSession, PLATFORM, registerCreator, resetDatabase, type Session, tenantHost, tokenFromEmail, uniqueEmail, uploadFile } from './helpers.js';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const bytes = (res: any) => res.buffer(true).parse((r: any, cb: any) => { const b: Buffer[] = []; r.on('data', (d: Buffer) => b.push(d)); r.on('end', () => cb(null, Buffer.concat(b))); });

describe('Academy security settings (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(async () => app?.close());

  it('device limit signs out the oldest devices; team 2FA blocks members without it; PDFs are stamped; video watermark settings reach learners', async () => {
    const c = await registerCreator(app);
    let cs = c.session;
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    await prisma.tenantLimitOverride.create({ data: { tenantId: c.tenant.id, featureKey: 'staff.max', enabled: true, limitValue: 10n } });
    await app.get(EntitlementsService).invalidate(c.tenant.id);

    expect((await authed(app, cs).get('/api/v1/creator/settings/security').expect(200)).body.data).toEqual({
      deviceLimit: 0, teamTwoFactor: false, pdfWatermark: { enabled: false, color: '#100F0F', fixedPosition: false }, videoWatermark: { mode: 'off', showForSec: 10, everySec: 20 },
    });
    await authed(app, cs).put('/api/v1/creator/settings/security').send({ deviceLimit: 21 }).expect(422);
    await authed(app, cs).put('/api/v1/creator/settings/security').send({ pdfWatermark: { color: 'red' } }).expect(422);

    // ── Device limit: 2 → a third sign-in ends the oldest session.
    await authed(app, cs).put('/api/v1/creator/settings/security').send({ deviceLimit: 2 }).expect(200);
    const host = tenantHost(c.tenant.slug);
    const email = uniqueEmail('dev');
    await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: 'Device Learner', email, password: 'student-password-1' }).expect(201);
    const d1 = (await login(app, host, email, 'student-password-1')).session;
    const d2 = (await login(app, host, email, 'student-password-1')).session;
    await authed(app, d1).get('/api/v1/auth/me').expect(200);
    const d3 = (await login(app, host, email, 'student-password-1')).session;
    const user = await prisma.user.findFirstOrThrow({ where: { email, realmKey: c.tenant.id } });
    const families = new Set((await prisma.userSession.findMany({ where: { userId: user.id, revokedAt: null } })).map((s) => s.familyId));
    expect(families.size).toBe(2);
    expect(await prisma.userSession.count({ where: { userId: user.id, revokeReason: 'device_limit' } })).toBeGreaterThan(0);
    await authed(app, d2).get('/api/v1/auth/me').expect(200);
    await authed(app, d3).get('/api/v1/auth/me').expect(200);

    // ── Team 2FA: the owner must have 2FA first; then a member without it is blocked from the workspace.
    await authed(app, cs).put('/api/v1/creator/settings/security').send({ teamTwoFactor: true }).expect(422);
    const setup = await authed(app, cs).post('/api/v1/auth/2fa/setup').expect(200);
    const enabled = await authed(app, cs).post('/api/v1/auth/2fa/enable').send({ code: nextTotp(setup.body.data.secret, 0) }).expect(200);
    cs = parseSession(enabled, PLATFORM);
    await authed(app, cs).put('/api/v1/creator/settings/security').send({ teamTwoFactor: true }).expect(200);
    const mEmail = uniqueEmail('team');
    await authed(app, cs).post('/api/v1/creator/staff/invitations').send({ email: mEmail, roleKey: 'INSTRUCTOR' }).expect(201);
    const token = tokenFromEmail((await lastEmail(app, mEmail))!.text);
    const ms = parseSession(await api(app).post('/api/v1/invitations/register').set('Host', PLATFORM).send({ token, fullName: 'No Twofa', password: 'team-password-123' }).expect(201), PLATFORM) as Session;
    const blocked = await authed(app, ms).get('/api/v1/creator/courses').expect(403);
    expect(blocked.body.error.code).toBe('MFA_SETUP_REQUIRED');
    expect((await authed(app, ms).get('/api/v1/auth/me').expect(200)).body.data.workspaceRequiresTwoFactor).toBe(true);
    await authed(app, cs).get('/api/v1/creator/courses').expect(200);
    expect((await authed(app, cs).get('/api/v1/auth/me')).body.data.workspaceRequiresTwoFactor).toBe(false);
    await authed(app, cs).put('/api/v1/creator/settings/security').send({ teamTwoFactor: false }).expect(200);
    await authed(app, ms).get('/api/v1/creator/courses').expect(200);

    // ── PDF watermark on a lesson PDF.
    const original = await PDFDocument.create();
    const page = original.addPage([595, 842]);
    page.drawText('Chapter one', { x: 50, y: 780, size: 18, font: await original.embedFont(StandardFonts.Helvetica) });
    original.addPage([595, 842]);
    const pdfBytes = Buffer.from(await original.save());
    const file = (await uploadFile(app, cs, 'LESSON_FILE', 'notes.pdf', 'application/pdf', pdfBytes)).body.data;
    const co = (await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'Secure course' }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
    const l = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Notes', type: 'PDF' }).expect(201)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}/lessons/${l.id}`).send({ fileAssetId: file.id, isPublished: true }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}`).send({ isFree: true }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/publish`).send({}).expect(200);
    await authed(app, d3).post(`/api/v1/learn/courses/${co.id}/enroll`).expect((r) => expect([200, 201]).toContain(r.status));

    const plain = (await authed(app, d3).get(`/api/v1/learn/lessons/${l.id}`).expect(200)).body.data.file;
    expect(plain.url).not.toMatch(/\/public\/watermarked\//);
    expect(plain.watermarked).toBe(false);
    await authed(app, cs).put('/api/v1/creator/settings/security').send({ pdfWatermark: { enabled: true, color: '#AA0000', fixedPosition: true } }).expect(200);
    const stamped = (await authed(app, d3).get(`/api/v1/learn/lessons/${l.id}`).expect(200)).body.data.file;
    expect(stamped).toMatchObject({ watermarked: true, url: expect.stringMatching(/\/api\/v1\/public\/watermarked\//) });
    const u = new URL(stamped.url);
    const out = await bytes(api(app).get(u.pathname).set('Host', u.host)).expect(200).expect('Content-Type', /application\/pdf/);
    const outPdf = await PDFDocument.load(out.body as Buffer);
    expect(outPdf.getPageCount()).toBe(2);
    expect((out.body as Buffer).equals(pdfBytes)).toBe(false);
    await api(app).get('/api/v1/public/watermarked/not-a-real-token').expect(404);

    // ── Video watermark settings for the player.
    expect((await authed(app, d3).get('/api/v1/learn/watermark').expect(200)).body.data).toEqual({ mode: 'off' });
    await authed(app, cs).put('/api/v1/creator/settings/security').send({ videoWatermark: { mode: 'dynamic', showForSec: 5, everySec: 30 } }).expect(200);
    expect((await authed(app, d3).get('/api/v1/learn/watermark')).body.data).toEqual({ mode: 'dynamic', showForSec: 5, everySec: 30, text: email });

    // Another academy can't read these settings; learners can't change them.
    const other = await registerCreator(app);
    expect((await authed(app, other.session).get('/api/v1/creator/settings/security')).body.data.deviceLimit).toBe(0);
    await authed(app, d3).put('/api/v1/creator/settings/security').send({ deviceLimit: 0 }).expect((r) => expect([401, 403, 404]).toContain(r.status));
  });
});
