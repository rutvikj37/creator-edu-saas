import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { EntitlementsService } from '../src/modules/subscriptions/entitlements.service.js';
import { api, authed, createTestApp, lastEmail, parseSession, PLATFORM, PNG, registerCreator, resetDatabase, type Session, tokenFromEmail, uniqueEmail } from './helpers.js';

describe('Workspace hardening (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(async () => app?.close());

  async function owner() {
    const o = await registerCreator(app);
    await prisma.tenantLimitOverride.create({ data: { tenantId: o.tenant.id, featureKey: 'staff.max', enabled: true, limitValue: 10n } });
    await app.get(EntitlementsService).invalidate(o.tenant.id);
    return o;
  }
  async function join(inviter: Session, roleKey: string, name: string) {
    const email = uniqueEmail('team');
    await authed(app, inviter).post('/api/v1/creator/staff/invitations').send({ email, roleKey }).expect(201);
    const token = tokenFromEmail((await lastEmail(app, email))!.text);
    const reg = await api(app).post('/api/v1/invitations/register').set('Host', PLATFORM).send({ token, fullName: name, password: 'team-password-123' }).expect(201);
    return parseSession(reg, PLATFORM);
  }

  it('only the uploader can complete an upload or sign its parts; READY files are not re-issued to others', async () => {
    const o = await owner();
    const agent = await join(o.session, 'SUPPORT_AGENT', 'Sam Agent');
    const begin = await authed(app, o.session).post('/api/v1/creator/files').send({ purpose: 'COURSE_THUMBNAIL', fileName: 'a.png', mimeType: 'image/png', sizeBytes: PNG.length }).expect(201);
    const fileId = begin.body.data.fileId;
    await request(app.getHttpServer()).put(new URL(begin.body.data.upload.url).pathname).set('Host', PLATFORM).set('Content-Type', 'image/png').send(PNG).expect(200);

    await authed(app, agent).post(`/api/v1/creator/files/${fileId}/complete`).expect(404);
    await authed(app, agent).post(`/api/v1/creator/files/${fileId}/parts`).send({ partNumbers: [1] }).expect(404);
    const done = (await authed(app, o.session).post(`/api/v1/creator/files/${fileId}/complete`).expect(200)).body.data;
    expect(done).toMatchObject({ id: fileId, status: 'READY' });
    expect(done.url).toBeTruthy();
    await authed(app, agent).post(`/api/v1/creator/files/${fileId}/complete`).expect(404);
  });

  it('platform support tickets and chat need settings.manage; the dashboard activity feed is hidden from regular staff', async () => {
    const o = await owner();
    const agent = await join(o.session, 'SUPPORT_AGENT', 'Sid Agent');
    await authed(app, o.session).post('/api/v1/creator/support/tickets').send({ subject: 'Payout question', category: 'billing', priority: 'MEDIUM', body: 'When is the next payout scheduled?' }).expect(201);

    await authed(app, agent).get('/api/v1/creator/support/tickets').expect(403);
    await authed(app, agent).post('/api/v1/creator/support/tickets').send({ subject: 'Hello there', category: 'other', priority: 'LOW', body: 'Pretending to be the owner.' }).expect(403);
    await authed(app, agent).get('/api/v1/creator/support-chat').expect(403);
    await authed(app, agent).post('/api/v1/creator/support-chat/messages').send({ body: 'hi' }).expect(403);
    expect((await authed(app, o.session).get('/api/v1/creator/support/tickets').expect(200)).body.data).toHaveLength(1);
    await authed(app, o.session).get('/api/v1/creator/support-chat').expect(200);

    // The agent's own help desk access (support.manage) is unaffected.
    await authed(app, agent).get('/api/v1/creator/helpdesk/tickets').expect(200);

    const ownerDash = (await authed(app, o.session).get('/api/v1/creator/dashboard').expect(200)).body.data;
    expect(ownerDash.activity.length).toBeGreaterThan(0);
    expect((await authed(app, agent).get('/api/v1/creator/dashboard').expect(200)).body.data.activity).toEqual([]);
  });
});
