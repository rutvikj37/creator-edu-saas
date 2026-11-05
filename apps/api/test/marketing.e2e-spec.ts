import type { NestExpressApplication } from '@nestjs/platform-express';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { DOMAIN_EVENT_JOB } from '../src/core/events/app-events.service.js';
import { QUEUES } from '../src/core/queue/queue.constants.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { AutomationsService } from '../src/modules/marketing/automations.service.js';
import { CampaignsService } from '../src/modules/marketing/campaigns.service.js';
import { EntitlementsService } from '../src/modules/subscriptions/entitlements.service.js';
import { api, authed, createTestApp, emailCount, lastEmail, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

describe('Marketing: leads, consent, campaigns, automations (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let marketingQ: Queue;
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    marketingQ = app.get<Queue>(getQueueToken(QUEUES.MARKETING));
  });
  afterAll(async () => app?.close());

  async function academy(withMarketing = true) {
    const c = await registerCreator(app);
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    if (withMarketing) await prisma.tenantLimitOverride.create({ data: { tenantId: c.tenant.id, featureKey: 'marketing', enabled: true, reason: 'test' } });
    await app.get(EntitlementsService).invalidate(c.tenant.id);
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    return c;
  }
  async function student(slug: string) {
    const host = tenantHost(slug);
    const email = uniqueEmail('mk');
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: 'Lead Student', email, password: 'student-password-1' }).expect(201);
    const s = parseSession(reg, host);
    return { s, email, id: (await authed(app, s).get('/api/v1/auth/me')).body.data.user.id as string };
  }
  async function freeCourse(cs: Session) {
    const co = (await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'Automated course' }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
    const l = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Intro', type: 'TEXT' }).expect(201)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}/lessons/${l.id}`).send({ content: doc('Hi'), isPublished: true }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}`).send({ isFree: true }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/publish`).send({}).expect(200);
    return co;
  }

  it('captures leads with consent, sends campaigns only to consented contacts, honours unsubscribe', async () => {
    const gated = await academy(false);
    expect((await authed(app, gated.session).get('/api/v1/creator/campaigns').expect(403)).body.error.code).toBe('FEATURE_NOT_IN_PLAN');

    const c = await academy();
    const cs = c.session;
    const host = tenantHost(c.tenant.slug);
    const st = await student(c.tenant.slug);

    // Sign-up creates a contact without consent; the public form records explicit consent; honeypot is ignored.
    await api(app).post('/api/v1/public/leads').set('Host', host).send({ email: 'Fan@Example.test', name: 'Fan', consent: true, source: 'newsletter' }).expect(200);
    await api(app).post('/api/v1/public/leads').set('Host', host).send({ email: 'bot@example.test', consent: true, website: 'http://spam' }).expect(200);
    await api(app).post('/api/v1/public/leads').set('Host', host).send({ email: 'quiet@example.test', consent: false }).expect(200);
    const leads = (await authed(app, cs).get('/api/v1/creator/leads').expect(200)).body;
    expect(leads.data.map((l: any) => [l.email, l.canEmail]).sort()).toEqual([[st.email, false], ['fan@example.test', true], ['quiet@example.test', false]].sort());
    const fan = leads.data.find((l: any) => l.email === 'fan@example.test');
    expect((await authed(app, cs).get(`/api/v1/creator/leads/${fan.id}`)).body.data.consentHistory).toEqual([expect.objectContaining({ action: 'GRANTED', source: 'form:newsletter' })]);

    // Import: consent only when the creator confirms it.
    const imp = (await authed(app, cs).post('/api/v1/creator/leads/import').send({ rows: [{ email: 'a@example.test', tags: ['VIP'] }, { email: 'not-an-email' }], consentConfirmed: true }).expect(200)).body.data;
    expect(imp).toEqual({ created: 1, updated: 0, invalid: ['not-an-email'] });
    await authed(app, cs).post('/api/v1/creator/leads/import').send({ rows: [{ email: 'b@example.test', tags: ['vip'] }], consentConfirmed: false }).expect(200);
    expect((await authed(app, cs).get('/api/v1/creator/leads?consent=yes')).body.meta.total).toBe(2);
    expect((await authed(app, cs).get('/api/v1/creator/leads?tag=vip')).body.meta.total).toBe(2);

    // Campaign to everyone: only the 2 consented contacts; the rest are counted as excluded.
    await authed(app, cs).post('/api/v1/creator/campaigns').send({ name: 'x', subject: 'y', content: { type: 'doc', content: [{ type: 'image' }] } }).expect(422);
    const camp = (await authed(app, cs).post('/api/v1/creator/campaigns').send({ name: 'November news', subject: 'New course out now', previewText: 'Early-bird inside', content: doc('Our new SQL course is live.'), segment: { type: 'all' } }).expect(201)).body.data;
    expect(camp.audience).toEqual({ recipients: 2, excludedWithoutConsent: 3 });
    await authed(app, cs).post(`/api/v1/creator/campaigns/${camp.id}/test`).expect(200);
    expect(await lastEmail(app, c.body.email)).toMatchObject({ subject: '[Test] New course out now' });
    const sched = (await authed(app, cs).post(`/api/v1/creator/campaigns/${camp.id}/schedule`).send({}).expect(200)).body.data;
    expect(sched.status).toBe('SCHEDULED');
    await authed(app, cs).patch(`/api/v1/creator/campaigns/${camp.id}`).send({ subject: 'changed' }).expect(409);
    expect(await app.get(CampaignsService).send(c.tenant.id, camp.id)).toEqual({ sent: 2 });
    expect(await app.get(CampaignsService).send(c.tenant.id, camp.id)).toEqual({ skipped: true });
    expect((await authed(app, cs).get(`/api/v1/creator/campaigns/${camp.id}`)).body.data).toMatchObject({ status: 'SENT', stats: { recipients: 2, queued: 2 } });
    const sent = (await lastEmail(app, 'fan@example.test')) as any;
    expect(sent).toMatchObject({ subject: 'New course out now' });
    expect(sent.headers['List-Unsubscribe']).toMatch(/\/api\/v1\/public\/unsubscribe\?t=/);
    expect(sent.html).toContain('<p>Our new SQL course is live.</p>');
    expect(await emailCount(app, 'quiet@example.test')).toBe(0);
    expect((await lastEmail(app, st.email))?.subject).not.toBe('New course out now');

    // Unsubscribe works from any host, logs the withdrawal and excludes the contact from now on.
    const path = new URL(sent.headers['List-Unsubscribe'].slice(1, -1)).pathname + new URL(sent.headers['List-Unsubscribe'].slice(1, -1)).search;
    const page = await request(app.getHttpServer()).get(path).expect(200);
    expect(page.text).toContain("You're unsubscribed");
    await request(app.getHttpServer()).get('/api/v1/public/unsubscribe?t=x.y.z').expect(404);
    expect((await authed(app, cs).get(`/api/v1/creator/leads/${fan.id}`)).body.data).toMatchObject({ canEmail: false, consentHistory: [expect.objectContaining({ action: 'WITHDRAWN' }), expect.objectContaining({ action: 'GRANTED' })] });
    const tagged = (await authed(app, cs).post('/api/v1/creator/campaigns').send({ name: 'VIP', subject: 'VIP offer', content: doc('Thanks'), segment: { type: 'tag', tag: 'VIP' } }).expect(201)).body.data;
    expect(tagged.audience.recipients).toBe(1);
    const none = (await authed(app, cs).post('/api/v1/creator/campaigns').send({ name: 'Fan only', subject: 'x', content: doc('x'), segment: { type: 'tag', tag: 'form:newsletter' } }).expect(201)).body.data;
    await authed(app, cs).post(`/api/v1/creator/campaigns/${none.id}/schedule`).send({}).expect(422);

    // Erasure and isolation.
    const other = await academy();
    await authed(app, other.session).get(`/api/v1/creator/leads/${fan.id}`).expect(404);
    await authed(app, cs).delete(`/api/v1/creator/leads/${fan.id}`).expect(200);
    expect(await prisma.consentEvent.count({ where: { leadId: fan.id } })).toBe(0);
  });

  it('automations: enrolment trigger runs notify → tag → wait → email once per occurrence; lead emails need consent', async () => {
    const c = await academy();
    const cs = c.session;
    const course = await freeCourse(cs);
    const autos = app.get(AutomationsService);
    await authed(app, cs).post('/api/v1/creator/automations').send({ name: 'bad', trigger: 'lead.created', steps: [{ type: 'enroll', courseId: course.id }] }).expect(422);
    const a = (await authed(app, cs).post('/api/v1/creator/automations').send({
      name: 'Welcome', trigger: 'course.enrolled', filter: { courseId: course.id },
      steps: [{ type: 'notify', title: 'Welcome aboard', body: 'Start with lesson 1' }, { type: 'tag', tag: 'onboarding' }, { type: 'wait', minutes: 60 }, { type: 'email', subject: 'How is it going?', content: doc('Reply if you need help.') }],
    }).expect(201)).body.data;
    const leadAuto = (await authed(app, cs).post('/api/v1/creator/automations').send({ name: 'Lead nurture', trigger: 'lead.created', steps: [{ type: 'email', subject: 'Free guide', content: doc('Here it is') }] }).expect(201)).body.data;

    await marketingQ.obliterate({ force: true });
    const st = await student(c.tenant.slug);
    await authed(app, st.s).post(`/api/v1/learn/courses/${course.id}/enroll`).expect(201);
    // Feed the queued domain events to the worker logic.
    const events = (await marketingQ.getJobs(['waiting', 'delayed'])).filter((j) => j.name === DOMAIN_EVENT_JOB);
    expect(events.map((e) => e.data.name).sort()).toEqual(['course.enrolled', 'lead.created', 'student.registered']);
    for (const e of events) await autos.onEvent(e.data.name, e.data.payload);
    for (const e of events) await autos.onEvent(e.data.name, e.data.payload); // duplicates are ignored
    const runs = await prisma.automationRun.findMany({ where: { tenantId: c.tenant.id } });
    expect(runs.map((r) => r.automationId).sort()).toEqual([a.id, leadAuto.id].sort());

    const run = runs.find((r) => r.automationId === a.id)!;
    for (let i = 0; i < 4; i++) await autos.runStep(run.id);
    const done = (await authed(app, cs).get(`/api/v1/creator/automations/${a.id}`)).body.data.runs[0];
    expect(done).toMatchObject({ status: 'DONE', stepIndex: 4 });
    expect(done.log.map((l: any) => l.result)).toEqual(['notified', expect.stringMatching(/^tagged onboarding/), 'waited 60 min', 'email queued']);
    expect((await authed(app, st.s).get('/api/v1/notifications')).body.data.items.map((n: any) => n.title)).toContain('Welcome aboard');
    expect(await lastEmail(app, st.email)).toMatchObject({ subject: 'How is it going?' });
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId: c.tenant.id, email: st.email } });
    expect(lead.tags).toContain('onboarding');

    // The lead-created automation does not email a contact without marketing consent.
    const leadRun = runs.find((r) => r.automationId === leadAuto.id)!;
    await autos.runStep(leadRun.id);
    expect((await prisma.automationRun.findUniqueOrThrow({ where: { id: leadRun.id } })).log).toEqual([expect.objectContaining({ result: 'skipped: no consent' })]);

    // Pausing cancels running runs.
    await authed(app, cs).patch(`/api/v1/creator/automations/${leadAuto.id}`).send({ status: 'PAUSED' }).expect(200);
    expect((await authed(app, cs).get('/api/v1/creator/automations')).body.data.find((x: any) => x.id === leadAuto.id).status).toBe('PAUSED');
  });
});
