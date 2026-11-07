import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { api, authed, createTestApp, lastEmail, registerCreator, resetDatabase, uniqueEmail } from './helpers.js';

describe('Creator student management (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(async () => app?.close());

  it('adds a single student with courses and an invitation', async () => {
    const c = await registerCreator(app);
    const course = (await authed(app, c.session).post('/api/v1/creator/courses').send({ title: 'Algebra' }).expect(201)).body.data;
    const email = uniqueEmail('added');
    const r = (await authed(app, c.session).post('/api/v1/creator/students').send({ fullName: 'Asha Rao', email: email.toUpperCase(), phone: '+91 98765-43210', courseIds: [course.id] }).expect(201)).body.data;
    expect(r).toMatchObject({ invited: true, enrolled: 1 });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: r.id } });
    expect(user).toMatchObject({ email, fullName: 'Asha Rao', phone: '+919876543210', tenantId: c.tenant.id, realm: 'TENANT' });
    expect(await prisma.enrollment.count({ where: { userId: r.id, courseId: course.id, status: 'ACTIVE' } })).toBe(1);
    const mail = await lastEmail(app, email);
    expect(mail?.tag).toBe('student-invite');
    expect(await prisma.passwordReset.count({ where: { userId: r.id } })).toBe(1);

    const list = (await authed(app, c.session).get('/api/v1/creator/students').query({ q: 'Asha' }).expect(200)).body.data;
    expect(list).toHaveLength(1);
    expect(list[0].enrollmentCount).toBe(1);

    // duplicates and bad input
    const dup = await authed(app, c.session).post('/api/v1/creator/students').send({ fullName: 'Again', email }).expect(409);
    expect(dup.body.error.message).toMatch(/already exists/);
    await authed(app, c.session).post('/api/v1/creator/students').send({ fullName: 'Phone twin', email: uniqueEmail('twin'), phone: '+919876543210' }).expect(409);
    await authed(app, c.session).post('/api/v1/creator/students').send({ fullName: 'Bad phone', email: uniqueEmail('bp'), phone: 'call me' }).expect(422);
    await authed(app, c.session).post('/api/v1/creator/students').send({ fullName: '', email: 'not-an-email' }).expect(422);

    // no invitation when turned off
    const quiet = uniqueEmail('quiet');
    const q = (await authed(app, c.session).post('/api/v1/creator/students').send({ fullName: 'Quiet', email: quiet, sendInvite: false }).expect(201)).body.data;
    expect(q.invited).toBe(false);
    expect(await lastEmail(app, quiet)).toBeFalsy();
  });

  it('imports a CSV batch, reporting bad rows without blocking good ones', async () => {
    const c = await registerCreator(app);
    const course = (await authed(app, c.session).post('/api/v1/creator/courses').send({ title: 'Geometry' }).expect(201)).body.data;
    const existing = uniqueEmail('existing');
    await authed(app, c.session).post('/api/v1/creator/students').send({ fullName: 'Already Here', email: existing, sendInvite: false }).expect(201);
    const a = uniqueEmail('a');
    const b = uniqueEmail('b');
    const rows = [
      { fullName: 'A One', email: a, phone: '9876500001' },
      { fullName: '', email: b },
      { fullName: 'Existing', email: existing },
      { fullName: 'Broken', email: 'nope' },
      { fullName: 'Dup', email: a.toUpperCase() },
      { fullName: 'Bad phone', email: uniqueEmail('c'), phone: '12' },
    ];
    const r = (await authed(app, c.session).post('/api/v1/creator/students/import').send({ rows, courseIds: [course.id] }).expect(200)).body.data;
    expect(r).toMatchObject({ total: 6, created: 2, existing: 1 });
    expect(r.failed).toEqual([
      { row: 5, email: 'nope', reason: 'Invalid email address' },
      { row: 6, email: a.toUpperCase(), reason: 'Duplicate email in file' },
      { row: 7, email: expect.any(String), reason: 'Invalid phone number' },
    ]);
    const bUser = await prisma.user.findFirstOrThrow({ where: { email: b, tenantId: c.tenant.id } });
    expect(bUser.fullName).toBe(b.split('@')[0]);
    expect(await prisma.enrollment.count({ where: { courseId: course.id } })).toBe(3); // 2 new + existing
    const listed = (await authed(app, c.session).get('/api/v1/creator/courses').expect(200)).body.data.find((x: any) => x.id === course.id);
    expect(listed.studentCount).toBe(3);
    expect((await lastEmail(app, a))?.tag).toBe('student-invite');
    expect(await lastEmail(app, existing)).toBeFalsy(); // existing students aren't emailed

    await authed(app, c.session).post('/api/v1/creator/students/import').send({ rows: [] }).expect(422);

    // Learner list filters
    const old = await prisma.user.findFirstOrThrow({ where: { email: existing, tenantId: c.tenant.id } });
    await prisma.user.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 100 * 86_400_000), lastLoginAt: new Date() } });
    const list = async (query: Record<string, string>) => (await authed(app, c.session).get('/api/v1/creator/students').query(query).expect(200)).body.data.map((u: any) => u.email).sort();
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    expect(await list({ joinedFrom: weekAgo, joinedTo: today })).toEqual([a, b].sort());
    expect(await list({ activeFrom: weekAgo })).toEqual([existing]);
    expect(await list({ neverSignedIn: 'true' })).toEqual([a, b].sort());
    expect(await list({ courseId: course.id })).toEqual([a, b, existing].sort());
    await authed(app, c.session).get('/api/v1/creator/students').query({ joinedFrom: 'yesterday' }).expect(422);
  });

  it('keeps academies apart and requires sign-in', async () => {
    const a = await registerCreator(app);
    const b = await registerCreator(app);
    const course = (await authed(app, a.session).post('/api/v1/creator/courses').send({ title: 'A only' }).expect(201)).body.data;
    await authed(app, b.session).post('/api/v1/creator/students').send({ fullName: 'X', email: uniqueEmail('x'), courseIds: [course.id] }).expect(404);
    await authed(app, b.session).post('/api/v1/creator/students/import').send({ rows: [{ email: uniqueEmail('y') }], courseIds: [course.id] }).expect(404);
    // the same email can be a student at two academies
    const shared = uniqueEmail('shared');
    await authed(app, a.session).post('/api/v1/creator/students').send({ fullName: 'S', email: shared }).expect(201);
    await authed(app, b.session).post('/api/v1/creator/students').send({ fullName: 'S', email: shared }).expect(201);
    await api(app).post('/api/v1/creator/students').send({ fullName: 'S', email: shared }).expect(401);
  });
});
