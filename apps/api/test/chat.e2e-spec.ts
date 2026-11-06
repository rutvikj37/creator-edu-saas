import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { adminWithRoles, api, authed, createTestApp, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';

describe('Live chat (e2e)', () => {
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
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: name, email: uniqueEmail('chat'), password: 'student-password-1' }).expect(201);
    return parseSession(reg, host) as Session;
  }

  it('student ↔ academy: send, unread counts, reply with notification, long poll wakes, close/reopen, validation, rate limit, isolation', async () => {
    const c = await academy();
    const cs = c.session;
    const s = await student(c.tenant.slug);

    // Empty thread; nothing listed for staff until the first message.
    expect((await authed(app, s).get('/api/v1/learn/chat').expect(200)).body.data).toMatchObject({ messages: [], hasMore: false, unread: 0 });
    expect((await authed(app, cs).get('/api/v1/creator/chat/conversations').expect(200)).body.data.items).toEqual([]);

    await authed(app, s).post('/api/v1/learn/chat/messages').send({ body: '   ' }).expect(422);
    await authed(app, s).post('/api/v1/learn/chat/messages').send({ body: 'x'.repeat(2001) }).expect(422);
    const m1 = (await authed(app, s).post('/api/v1/learn/chat/messages').send({ body: '  How do I get my certificate?  ' }).expect(201)).body.data;
    expect(m1).toMatchObject({ side: 'customer', body: 'How do I get my certificate?', senderName: 'Riya Student' });

    const inbox = (await authed(app, cs).get('/api/v1/creator/chat/conversations').expect(200)).body.data;
    expect(inbox).toMatchObject({ total: 1, unreadConversations: 1 });
    expect(inbox.items[0]).toMatchObject({ status: 'OPEN', unread: 1, lastMessagePreview: 'How do I get my certificate?', customer: { name: 'Riya Student' } });
    const convId = inbox.items[0].id;
    expect((await authed(app, cs).get('/api/v1/creator/chat/conversations?unread=1')).body.data.total).toBe(1);

    // Long poll: the student waits; the staff reply wakes it well before the 25 s timeout.
    const started = Date.now();
    const waiting = authed(app, s).get(`/api/v1/learn/chat/messages?after=${m1.id}&wait=1`).then((r) => r);
    await new Promise((r) => setTimeout(r, 300));
    const reply = (await authed(app, cs).post(`/api/v1/creator/chat/conversations/${convId}/messages`).send({ body: 'Finish all lessons, then open Certificates.' }).expect(201)).body.data;
    const woke = await waiting;
    expect(woke.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(woke.body.data.messages.map((m: any) => m.id)).toEqual([reply.id]);
    expect(woke.body.data.messages[0]).toMatchObject({ side: 'agent', body: 'Finish all lessons, then open Certificates.' });
    // Poll without wait returns immediately; nothing newer than the reply.
    expect((await authed(app, s).get(`/api/v1/learn/chat/messages?after=${reply.id}`).expect(200)).body.data.messages).toEqual([]);

    const sUser = await prisma.user.findFirstOrThrow({ where: { id: (await prisma.chatConversation.findUniqueOrThrow({ where: { id: convId } })).customerUserId! } });
    const notes = await prisma.notification.findMany({ where: { userId: sUser.id } });
    expect(notes.some((n) => n.link === '/learn/chat' && n.body.includes('Finish all lessons'))).toBe(true);

    expect((await authed(app, s).get('/api/v1/learn/chat')).body.data).toMatchObject({ unread: 1 });
    await authed(app, s).post('/api/v1/learn/chat/read').expect(200);
    expect((await authed(app, s).get('/api/v1/learn/chat')).body.data.unread).toBe(0);
    await authed(app, cs).post(`/api/v1/creator/chat/conversations/${convId}/read`).expect(200);
    expect((await authed(app, cs).get('/api/v1/creator/chat/conversations')).body.data.unreadConversations).toBe(0);

    // Close; the student's message reopens it.
    await authed(app, cs).post(`/api/v1/creator/chat/conversations/${convId}/status`).send({ status: 'CLOSED' }).expect(200);
    expect((await authed(app, cs).get('/api/v1/creator/chat/conversations?status=CLOSED')).body.data.total).toBe(1);
    await authed(app, cs).post(`/api/v1/creator/chat/conversations/${convId}/status`).send({ status: 'NOPE' }).expect(422);
    const m3 = (await authed(app, s).post('/api/v1/learn/chat/messages').send({ body: 'Thanks!' }).expect(201)).body.data;
    expect((await authed(app, cs).get(`/api/v1/creator/chat/conversations/${convId}`).expect(200)).body.data).toMatchObject({ conversation: { status: 'OPEN' } });
    const hist = (await authed(app, cs).get(`/api/v1/creator/chat/conversations/${convId}`)).body.data.messages;
    expect(hist.map((m: any) => m.id)).toEqual([m1.id, reply.id, m3.id]);

    // A second student has their own thread and cannot see the first.
    const s2 = await student(c.tenant.slug, 'Other Student');
    expect((await authed(app, s2).get('/api/v1/learn/chat')).body.data.messages).toEqual([]);

    // Isolation: another academy's staff can't open or reply; students can't use staff routes.
    const other = await academy();
    expect((await authed(app, other.session).get('/api/v1/creator/chat/conversations')).body.data.total).toBe(0);
    await authed(app, other.session).get(`/api/v1/creator/chat/conversations/${convId}`).expect(404);
    await authed(app, other.session).post(`/api/v1/creator/chat/conversations/${convId}/messages`).send({ body: 'hi' }).expect(404);
    await authed(app, other.session).get(`/api/v1/creator/chat/conversations/${convId}/messages?wait=1`).expect(404);
    await authed(app, s).get('/api/v1/creator/chat/conversations').expect((r) => expect([401, 403, 404]).toContain(r.status));
    // A student of the other academy can't reach this academy's chat with their token.
    const s3 = await student(other.tenant.slug);
    await authed(app, { ...s3, host: tenantHost(c.tenant.slug) }).get('/api/v1/learn/chat').expect((r) => expect([401, 403, 404]).toContain(r.status));

    // Rate limit: 30 messages a minute per sender.
    const s4 = await student(c.tenant.slug, 'Fast Typer');
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await authed(app, s4).post('/api/v1/learn/chat/messages').send({ body: `msg ${i}` })).status;
    expect(last).toBe(409);
    const page = (await authed(app, s4).get('/api/v1/learn/chat')).body.data;
    expect(page.messages).toHaveLength(30);
  });

  it('academy ↔ platform support: creator writes, support sees academy name, replies, owner is notified; permissions enforced', async () => {
    const c = await academy();
    const cs = c.session;
    const m = (await authed(app, cs).post('/api/v1/creator/support-chat/messages').send({ body: 'My payouts are not showing.' }).expect(201)).body.data;
    expect(m.side).toBe('customer');

    const support = await adminWithRoles(app, ['SUPPORT_ADMIN']);
    const list = (await authed(app, support.session).get('/api/v1/platform/support-chat/conversations').expect(200)).body.data;
    const row = list.items.find((i: any) => i.customer.slug === c.tenant.slug);
    expect(row).toMatchObject({ unread: 1, lastMessagePreview: 'My payouts are not showing.' });

    const waiting = authed(app, cs).get(`/api/v1/creator/support-chat/messages?after=${m.id}&wait=1`).then((r) => r);
    await new Promise((r) => setTimeout(r, 300));
    await authed(app, support.session).post(`/api/v1/platform/support-chat/conversations/${row.id}/messages`).send({ body: 'Checking it now.' }).expect(201);
    expect((await waiting).body.data.messages[0]).toMatchObject({ side: 'agent', body: 'Checking it now.' });
    expect((await authed(app, cs).get('/api/v1/creator/support-chat')).body.data.unread).toBe(1);
    const owner = await prisma.tenantMember.findFirstOrThrow({ where: { tenantId: c.tenant.id } });
    expect((await prisma.notification.findMany({ where: { userId: owner.userId } })).some((n) => n.link === '/creator/support-chat')).toBe(true);
    await authed(app, support.session).post(`/api/v1/platform/support-chat/conversations/${row.id}/status`).send({ status: 'CLOSED' }).expect(200);

    // Academy ACADEMY threads are not visible to platform support, and vice versa.
    const s = await student(c.tenant.slug);
    await authed(app, s).post('/api/v1/learn/chat/messages').send({ body: 'hello academy' }).expect(201);
    const academyConv = await prisma.chatConversation.findFirstOrThrow({ where: { tenantId: c.tenant.id, kind: 'ACADEMY' } });
    await authed(app, support.session).get(`/api/v1/platform/support-chat/conversations/${academyConv.id}`).expect(404);
    await authed(app, cs).get(`/api/v1/creator/chat/conversations/${row.id}`).expect(404);
    // Another academy only sees its own support thread.
    const other = await academy();
    expect((await authed(app, other.session).get('/api/v1/creator/support-chat')).body.data.messages).toEqual([]);
    // Platform admins without the support permission, and creators, can't use the support inbox.
    const fin = await adminWithRoles(app, ['FINANCE_ADMIN']);
    await authed(app, fin.session).get('/api/v1/platform/support-chat/conversations').expect(403);
    await authed(app, cs).get('/api/v1/platform/support-chat/conversations').expect((r) => expect([401, 403, 404]).toContain(r.status));
  });
});
