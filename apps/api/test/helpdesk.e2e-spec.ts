import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { adminWithRoles, api, authed, createTestApp, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';

describe('Student help desk (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(async () => app?.close());

  async function academy() {
    const c = await registerCreator(app);
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    return c;
  }
  async function student(slug: string, name = 'Riya Student') {
    const host = tenantHost(slug);
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: name, email: uniqueEmail('desk'), password: 'student-password-1' }).expect(201);
    return parseSession(reg, host) as Session;
  }

  it('student opens a request, team replies (internal notes hidden), student is notified, resolve/reopen, close', async () => {
    const c = await academy();
    const s = await student(c.tenant.slug);
    const studentId = (await prisma.user.findFirstOrThrow({ where: { fullName: 'Riya Student' } })).id;

    await authed(app, s).post('/api/v1/learn/support/tickets').send({ subject: 'Hi', category: 'course', body: 'short' }).expect(422);
    await authed(app, s).post('/api/v1/learn/support/tickets').send({ subject: 'Video will not play', category: 'nope', body: 'Lesson 3 video stays black.' }).expect(422);
    const t = (await authed(app, s).post('/api/v1/learn/support/tickets').send({ subject: 'Video will not play', category: 'technical', body: 'Lesson 3 video stays black on my phone.' }).expect(201)).body.data;
    expect(t).toMatchObject({ subject: 'Video will not play', status: 'OPEN', messages: [{ body: 'Lesson 3 video stays black on my phone.', isStaff: false }] });

    // The owner (support.manage) sees it and was notified in-app.
    const ownerId = (await prisma.tenantMember.findFirstOrThrow({ where: { tenantId: c.tenant.id } })).userId;
    expect(await prisma.notification.count({ where: { userId: ownerId, link: `/creator/helpdesk/${t.id}` } })).toBe(1);
    const inbox = (await authed(app, c.session).get('/api/v1/creator/helpdesk/tickets').expect(200)).body.data;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ id: t.id, requester: { fullName: 'Riya Student' }, assignee: null });
    expect((await authed(app, c.session).get('/api/v1/creator/helpdesk/summary').expect(200)).body.data).toMatchObject({ byStatus: { OPEN: 1 }, unassigned: 1, mine: 0 });

    await authed(app, c.session).post(`/api/v1/creator/helpdesk/tickets/${t.id}/messages`).send({ body: 'Check their device logs', internal: true }).expect(201);
    const replied = (await authed(app, c.session).post(`/api/v1/creator/helpdesk/tickets/${t.id}/messages`).send({ body: 'Please update the app and retry.' }).expect(201)).body.data;
    expect(replied).toMatchObject({ status: 'PENDING', assigneeId: ownerId });
    expect(replied.messages).toHaveLength(3);

    const seen = (await authed(app, s).get(`/api/v1/learn/support/tickets/${t.id}`).expect(200)).body.data;
    expect(seen.messages.map((m: { body: string }) => m.body)).toEqual(['Lesson 3 video stays black on my phone.', 'Please update the app and retry.']);
    expect(JSON.stringify(seen)).not.toContain('device logs');
    expect(await prisma.notification.count({ where: { userId: studentId, link: `/learn/support/${t.id}` } })).toBe(1);

    await authed(app, c.session).patch(`/api/v1/creator/helpdesk/tickets/${t.id}`).send({ status: 'RESOLVED' }).expect(200);
    const reopened = (await authed(app, s).post(`/api/v1/learn/support/tickets/${t.id}/messages`).send({ body: 'Still black, sorry.' }).expect(201)).body.data;
    expect(reopened.status).toBe('OPEN');
    await authed(app, s).post(`/api/v1/learn/support/tickets/${t.id}/close`).expect(200);
    await authed(app, s).post(`/api/v1/learn/support/tickets/${t.id}/messages`).send({ body: 'one more' }).expect(409);
    expect((await authed(app, s).get('/api/v1/learn/support/tickets').expect(200)).body.data[0]).toMatchObject({ id: t.id, status: 'CLOSED' });
  });

  it('isolation: other students, other academies and platform support cannot see academy tickets; assignee must handle support', async () => {
    const a = await academy();
    const b = await academy();
    const s1 = await student(a.tenant.slug, 'Student One');
    const s2 = await student(a.tenant.slug, 'Student Two');
    const t = (await authed(app, s1).post('/api/v1/learn/support/tickets').send({ subject: 'Refund question', category: 'payment', body: 'I was charged twice for the course.' }).expect(201)).body.data;

    await authed(app, s2).get(`/api/v1/learn/support/tickets/${t.id}`).expect(404);
    await authed(app, s2).post(`/api/v1/learn/support/tickets/${t.id}/messages`).send({ body: 'hijack' }).expect(404);
    expect((await authed(app, s2).get('/api/v1/learn/support/tickets').expect(200)).body.data).toEqual([]);
    await authed(app, b.session).get(`/api/v1/creator/helpdesk/tickets/${t.id}`).expect(404);
    expect((await authed(app, b.session).get('/api/v1/creator/helpdesk/tickets').expect(200)).body.data).toEqual([]);

    // Students cannot reach the team endpoints.
    await authed(app, s1).get('/api/v1/creator/helpdesk/tickets').expect((r) => expect([401, 403, 404]).toContain(r.status));

    // Platform support never sees student tickets, and creator→platform lists exclude them.
    const support = await adminWithRoles(app, ['SUPPORT_ADMIN']);
    expect((await authed(app, support.session).get('/api/v1/platform/support/tickets').expect(200)).body.data.map((x: { id: string }) => x.id)).not.toContain(t.id);
    await authed(app, support.session).get(`/api/v1/platform/support/tickets/${t.id}`).expect(404);
    expect((await authed(app, a.session).get('/api/v1/creator/support/tickets').expect(200)).body.data).toEqual([]);

    const s1Id = (await prisma.user.findFirstOrThrow({ where: { fullName: 'Student One' } })).id;
    await authed(app, a.session).patch(`/api/v1/creator/helpdesk/tickets/${t.id}`).send({ assigneeId: s1Id }).expect(422);
    const team = (await authed(app, a.session).get('/api/v1/creator/helpdesk/team').expect(200)).body.data;
    expect(team).toHaveLength(1);
    expect((await authed(app, a.session).patch(`/api/v1/creator/helpdesk/tickets/${t.id}`).send({ assigneeId: team[0].id, priority: 'HIGH' }).expect(200)).body.data).toMatchObject({ assigneeId: team[0].id, priority: 'HIGH' });
  });
});
