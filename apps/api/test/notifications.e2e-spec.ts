import type { NestExpressApplication } from '@nestjs/platform-express';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { QUEUES } from '../src/core/queue/queue.constants.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { api, authed, createTestApp, emailCount, lastEmail, parseSession, registerCreator, resetDatabase, tenantHost, uniqueEmail } from './helpers.js';

describe('Notifications (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(async () => app?.close());

  it('in-app list, read state, per-category channel preferences, unconfigured channels never pretend', async () => {
    const c = await registerCreator(app);
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    const host = tenantHost(c.tenant.slug);
    const email = uniqueEmail('n');
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: 'Nisha', email, password: 'student-password-1' }).expect(201);
    const s = parseSession(reg, host);
    const userId = (await authed(app, s).get('/api/v1/auth/me')).body.data.user.id;
    const svc = app.get(NotificationsService);
    const messaging = app.get<Queue>(getQueueToken(QUEUES.MESSAGING));
    await messaging.obliterate({ force: true });

    expect((await authed(app, s).get('/api/v1/notifications').expect(200)).body.data).toEqual({ items: [], nextCursor: null, unread: 0 });
    const prefs = (await authed(app, s).get('/api/v1/notifications/preferences').expect(200)).body.data;
    expect(prefs.categories.find((x: any) => x.category === 'learning')).toEqual({ category: 'learning', email: true, sms: false, whatsapp: false, push: true });
    expect(prefs.channels).toEqual({ email: true, sms: false, whatsapp: false, push: false });

    await svc.notify({ userId, tenantId: c.tenant.id, category: 'learning', title: 'New lesson', body: 'Lesson 3 is out', link: '/learn', brand: 'Acme' });
    const list = (await authed(app, s).get('/api/v1/notifications')).body.data;
    expect(list).toMatchObject({ unread: 1, items: [{ title: 'New lesson', body: 'Lesson 3 is out', link: '/learn', readAt: null }] });
    expect(await lastEmail(app, email)).toMatchObject({ tag: 'notify-learning', subject: 'New lesson' });

    // Turning email off for a category stops emails but keeps in-app; marketing never emails here.
    await authed(app, s).put('/api/v1/notifications/preferences').send({ items: [{ category: 'learning', email: false, sms: true, whatsapp: true }] }).expect(200);
    await authed(app, s).put('/api/v1/notifications/preferences').send({ items: [{ category: 'nope', email: true }] }).expect(422);
    const before = await emailCount(app, email);
    await svc.notify({ userId, tenantId: c.tenant.id, category: 'learning', title: 'Quiz graded', body: 'You scored 9/10', brand: 'Acme' });
    await svc.notify({ userId, tenantId: c.tenant.id, category: 'marketing', title: 'Sale', body: '20% off', brand: 'Acme' });
    expect(await emailCount(app, email)).toBe(before);
    // SMS/WhatsApp chosen but not configured (and phone not verified): nothing is queued.
    expect(await messaging.getJobCounts('waiting', 'delayed')).toMatchObject({ waiting: 0, delayed: 0 });
    expect((await authed(app, s).get('/api/v1/notifications')).body.data.unread).toBe(3);

    // Read state; another user cannot touch these.
    const first = (await authed(app, s).get('/api/v1/notifications')).body.data.items[0];
    await authed(app, c.session).post(`/api/v1/notifications/${first.id}/read`).expect(404);
    await authed(app, s).post(`/api/v1/notifications/${first.id}/read`).expect(200);
    expect((await authed(app, s).get('/api/v1/notifications')).body.data.unread).toBe(2);
    expect((await authed(app, s).post('/api/v1/notifications/read-all').expect(200)).body.data.read).toBe(2);
    expect((await authed(app, c.session).get('/api/v1/notifications').expect(200)).body.data.items).toEqual([]);

    // Web push needs VAPID keys.
    await authed(app, s).post('/api/v1/notifications/push/subscriptions').send({ endpoint: 'https://push.example.test/abc123', keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(8) } }).expect(409);
    await api(app).get('/api/v1/notifications').set('Host', host).expect(401);
  });
});
