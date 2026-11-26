import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Queue } from 'bullmq';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { QUEUES } from '../src/core/queue/queue.constants.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { api, authed, createTestApp, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function freeCourse(app: NestExpressApplication, cs: Session, title: string) {
  const c = (await authed(app, cs).post('/api/v1/creator/courses').send({ title }).expect(201)).body.data;
  const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${c.id}/curriculum`)).body.data[0].id;
  const l = (await authed(app, cs).post(`/api/v1/creator/courses/${c.id}/lessons`).send({ sectionId: sec, title: 'Welcome', type: 'TEXT' }).expect(201)).body.data;
  await authed(app, cs).patch(`/api/v1/creator/courses/${c.id}/lessons/${l.id}`).send({ content: doc('Hello'), isPublished: true }).expect(200);
  await authed(app, cs).patch(`/api/v1/creator/courses/${c.id}`).send({ isFree: true }).expect(200);
  await authed(app, cs).post(`/api/v1/creator/courses/${c.id}/publish`).send({}).expect(200);
  return { course: c as { id: string; slug: string }, lessonId: l.id as string };
}

describe('Graphy parity: learner filters, team, settings (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let cs: Session;
  let host: string;
  let tenantId: string;
  let course: { id: string; slug: string };
  let lessonId: string;

  const jobs = async (to: string) => (await app.get<Queue>(getQueueToken(QUEUES.NOTIFICATIONS)).getJobs(['waiting', 'delayed', 'active', 'completed', 'failed'])).filter((j) => j.data.to === to);
  const register = (email: string, extra: Record<string, unknown> = {}, password = 'student-password-1') =>
    api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: 'Learner', email, password, ...extra });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    const c = await registerCreator(app);
    cs = c.session;
    tenantId = c.tenant.id;
    await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
    host = tenantHost(c.tenant.slug);
    await app.get(HostResolverService).invalidate(host);
    ({ course, lessonId } = await freeCourse(app, cs, 'Starter course'));
  });
  afterAll(async () => app?.close());

  it('learner filters: verified email, source, deactivated, consent', async () => {
    const web = uniqueEmail('web');
    await register(web).expect(201);
    const guest = uniqueEmail('guest');
    await api(app).post('/api/v1/auth/register/checkout').set('Host', host).send({ fullName: 'Guest', email: guest }).expect(200);
    const added = uniqueEmail('added');
    await authed(app, cs).post('/api/v1/creator/students').send({ fullName: 'Added', email: added, sendInvite: false }).expect(201);
    await prisma.user.updateMany({ where: { email: web }, data: { emailVerifiedAt: new Date() } });
    await prisma.user.updateMany({ where: { email: added }, data: { status: 'SUSPENDED' } });
    await prisma.lead.upsert({ where: { tenantId_email: { tenantId, email: guest } }, update: { tags: ['vip'], marketingConsent: true }, create: { tenantId, email: guest, source: 'checkout', tags: ['vip'], marketingConsent: true } as never });

    const emails = async (q: Record<string, string>) => (await authed(app, cs).get('/api/v1/creator/students').query(q).expect(200)).body.data.map((u: any) => u.email).sort();
    expect(await emails({ verifiedEmail: 'yes' })).toEqual([web]);
    expect(await emails({ source: 'website' })).toEqual([web]);
    expect(await emails({ source: 'checkout' })).toEqual([guest]);
    expect(await emails({ source: 'added' })).toEqual([added]);
    expect(await emails({ deactivated: 'yes' })).toEqual([added]);
    expect(await emails({ marketingConsent: 'yes' })).toEqual([guest]);
    expect(await emails({ tag: 'vip', source: 'checkout' })).toEqual([guest]);
    expect(await emails({ tag: 'vip', source: 'website' })).toEqual([]);
    await authed(app, cs).get('/api/v1/creator/students').query({ source: 'nope' }).expect(422);
    expect((await authed(app, cs).get('/api/v1/creator/students/filter-options').expect(200)).body.data.tags).toEqual(['vip']);
  });

  it('team list carries how many courses each member teaches', async () => {
    const owner = (await authed(app, cs).get('/api/v1/creator/staff').expect(200)).body.data.members[0];
    expect(owner.courseCount).toBeGreaterThanOrEqual(0);
  });

  it('custom fields: settings CRUD, required on sign-up, learner answers and the learner filter', async () => {
    await authed(app, cs).post('/api/v1/creator/settings/custom-fields').send({ label: 'City', type: 'SELECT', options: ['Pune'] }).expect(422);
    const city = (await authed(app, cs).post('/api/v1/creator/settings/custom-fields').send({ label: 'City', type: 'SELECT', options: ['Pune', 'Surat'], required: true }).expect(201)).body.data;
    const roll = (await authed(app, cs).post('/api/v1/creator/settings/custom-fields').send({ label: 'Roll number', type: 'NUMBER', showInSignup: false, askBeforeCourse: true }).expect(201)).body.data;
    expect((await api(app).get('/api/v1/public/site').set('Host', host)).body.data.signup.fields.map((f: any) => f.label)).toEqual(['City']);

    const missing = await register(uniqueEmail('cf')).expect(422);
    expect(missing.body.error.details[0]).toMatchObject({ field: `customFields.${city.id}`, message: 'City is required' });
    await register(uniqueEmail('cf'), { customFields: { [city.id]: 'Delhi' } }).expect(422);
    const email = uniqueEmail('cf');
    const reg = await register(email, { customFields: { [city.id]: 'Surat' } }).expect(201);
    const s = parseSession(reg, host);

    const mine = (await authed(app, s).get('/api/v1/learn/custom-fields').expect(200)).body.data;
    expect(mine.beforeCourse.map((f: any) => f.label)).toEqual(['Roll number']);
    await authed(app, s).put('/api/v1/learn/custom-fields').send({ values: { [roll.id]: 'abc' } }).expect(422);
    const saved = (await authed(app, s).put('/api/v1/learn/custom-fields').send({ values: { [roll.id]: '42' } }).expect(200)).body.data;
    expect(saved.beforeCourse).toEqual([]);

    const found = (await authed(app, cs).get('/api/v1/creator/students').query({ customFieldId: city.id, customValue: 'Sur' }).expect(200)).body.data;
    expect(found.map((u: any) => u.email)).toEqual([email]);
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    expect((await authed(app, cs).get(`/api/v1/creator/settings/custom-fields/answers/${user.id}`).expect(200)).body.data.find((f: any) => f.label === 'City').value).toBe('Surat');

    await authed(app, cs).put('/api/v1/creator/settings/custom-fields/order').send({ ids: [roll.id, city.id] }).expect(200);
    expect((await authed(app, cs).get('/api/v1/creator/settings/custom-fields').expect(200)).body.data.map((f: any) => f.label)).toEqual(['Roll number', 'City']);
    await authed(app, cs).delete(`/api/v1/creator/settings/custom-fields/${city.id}`).expect(200);
    await authed(app, cs).delete(`/api/v1/creator/settings/custom-fields/${roll.id}`).expect(200);
  });

  it('signup & login: secure password policy and the Google switch', async () => {
    await authed(app, cs).put('/api/v1/creator/settings/preferences/signup').send({ securePasswordPolicy: 'yes' }).expect(422);
    expect((await authed(app, cs).put('/api/v1/creator/settings/preferences/signup').send({ securePasswordPolicy: true, googleEnabled: false }).expect(200)).body.data).toEqual({ googleEnabled: false, securePasswordPolicy: true });
    const weak = await register(uniqueEmail('pw'), {}, 'alllowercase1').expect(422);
    expect(weak.body.error.details[0].field).toBe('password');
    await register(uniqueEmail('pw'), {}, 'Stronger-Pass1').expect(201);
    expect((await api(app).get('/api/v1/auth/providers').set('Host', host)).body.data.google).toBe(false);
    await api(app).get('/api/v1/auth/google/start').set('Host', host).expect(404);
    await authed(app, cs).put('/api/v1/creator/settings/preferences/signup').send({ securePasswordPolicy: false, googleEnabled: true }).expect(200);
    await authed(app, cs).get('/api/v1/creator/settings/preferences/nope').expect(404);
  });

  it('communications: switched-off emails are skipped, sender name and reply-to apply', async () => {
    const res = (await authed(app, cs).put('/api/v1/creator/settings/preferences/communications').send({ senderName: 'Speak Academy', replyTo: 'hello@speak.test', emails: { enrolled: false } }).expect(200)).body.data;
    expect(res.emailTypes.map((e: any) => e.tag)).toContain('enrolled');
    await authed(app, cs).put('/api/v1/creator/settings/preferences/communications').send({ emails: { 'verify-email': false } }).expect(422);
    await authed(app, cs).put('/api/v1/creator/settings/preferences/communications').send({ purchaseAlertEmails: ['not-an-email'] }).expect(422);

    const a = uniqueEmail('mail');
    await authed(app, cs).post(`/api/v1/creator/courses/${course.id}/enrollments`).send({ email: a }).expect(201);
    expect((await jobs(a)).map((j) => j.data.tag)).not.toContain('enrolled');

    await authed(app, cs).put('/api/v1/creator/settings/preferences/communications').send({ emails: { enrolled: true }, purchaseAlertEmails: ['owner-alerts@speak.test'] }).expect(200);
    const b = uniqueEmail('mail');
    await authed(app, cs).post(`/api/v1/creator/courses/${course.id}/enrollments`).send({ email: b }).expect(201);
    const sent = (await jobs(b)).find((j) => j.data.tag === 'enrolled');
    expect(sent?.data).toMatchObject({ fromName: 'Speak Academy', replyTo: 'hello@speak.test' });
  });

  it('user experience: email verification gate, cookie notice and default form on the public site', async () => {
    await authed(app, cs).put('/api/v1/creator/settings/preferences/experience').send({ defaultForm: 'maybe' }).expect(422);
    await authed(app, cs).put('/api/v1/creator/settings/preferences/experience').send({ requireEmailVerification: true, cookieBanner: true, defaultForm: 'login' }).expect(200);
    const site = (await api(app).get('/api/v1/public/site').set('Host', host)).body.data;
    expect(site).toMatchObject({ cookieBanner: true, defaultForm: 'login' });

    const email = uniqueEmail('gate');
    const s = parseSession(await register(email).expect(201), host);
    await authed(app, s).post(`/api/v1/learn/courses/${course.id}/enroll`).expect(201);
    const blocked = await authed(app, s).get(`/api/v1/learn/lessons/${lessonId}`).expect(403);
    expect(blocked.body.error.details[0].message).toBe('EMAIL_NOT_VERIFIED');
    await prisma.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
    await authed(app, s).get(`/api/v1/learn/lessons/${lessonId}`).expect(200);
    await authed(app, cs).put('/api/v1/creator/settings/preferences/experience').send({ requireEmailVerification: false, cookieBanner: false, defaultForm: 'signup' }).expect(200);
  });

  it('another academy cannot see or change this academy’s settings, fields, learners or reports', async () => {
    const other = await registerCreator(app);
    const os = other.session;
    const field = (await authed(app, cs).post('/api/v1/creator/settings/custom-fields').send({ label: 'Secret field', type: 'TEXT' }).expect(201)).body.data;
    await authed(app, cs).put('/api/v1/creator/settings/preferences/communications').send({ senderName: 'Academy A only' }).expect(200);
    const learner = await prisma.user.findFirstOrThrow({ where: { tenantId, realm: 'TENANT' } });

    expect((await authed(app, os).get('/api/v1/creator/settings/custom-fields').expect(200)).body.data).toEqual([]);
    await authed(app, os).patch(`/api/v1/creator/settings/custom-fields/${field.id}`).send({ label: 'Hijacked' }).expect(404);
    await authed(app, os).delete(`/api/v1/creator/settings/custom-fields/${field.id}`).expect(404);
    await authed(app, os).put('/api/v1/creator/settings/custom-fields/order').send({ ids: [field.id] }).expect(200);
    expect((await prisma.customField.findUniqueOrThrow({ where: { id: field.id } })).label).toBe('Secret field');
    expect((await authed(app, os).get(`/api/v1/creator/settings/custom-fields/answers/${learner.id}`).expect(200)).body.data).toEqual([]);
    expect((await authed(app, os).get('/api/v1/creator/settings/preferences/communications').expect(200)).body.data.senderName).toBe('');
    await authed(app, os).put('/api/v1/creator/settings/preferences/communications').send({ senderName: 'Academy B' }).expect(200);
    expect((await authed(app, cs).get('/api/v1/creator/settings/preferences/communications').expect(200)).body.data.senderName).toBe('Academy A only');
    expect((await authed(app, os).get('/api/v1/creator/students/filter-options').expect(200)).body.data).toEqual({ utmSources: [], tags: [] });
    expect((await authed(app, os).get('/api/v1/creator/students').query({ source: 'website' }).expect(200)).body.data).toEqual([]);
    expect((await authed(app, os).get('/api/v1/creator/assessments/quizzes').expect(200)).body.data.totals.quizzes).toBe(0);
    expect((await authed(app, os).get('/api/v1/creator/assessments/quiz-attempts').expect(200)).body.data.items).toEqual([]);
    expect((await authed(app, os).get('/api/v1/creator/assessments/submissions').expect(200)).body.data.totals.submissions).toBe(0);
    expect((await authed(app, os).get('/api/v1/creator/live/webinars/report').expect(200)).body.data.items).toEqual([]);
    await authed(app, cs).delete(`/api/v1/creator/settings/custom-fields/${field.id}`).expect(200);
  });

  it('settings pages need permission', async () => {
    const s = parseSession(await register(uniqueEmail('nope')).expect(201), host);
    await authed(app, s).get('/api/v1/creator/settings/preferences/communications').expect((r) => expect([401, 403, 404]).toContain(r.status));
  });
});
