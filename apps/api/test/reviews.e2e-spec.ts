import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { api, authed, createTestApp, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

describe('Course reviews (e2e)', () => {
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
  async function freeCourse(cs: Session, title: string) {
    const co = (await authed(app, cs).post('/api/v1/creator/courses').send({ title }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
    const l = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Intro', type: 'TEXT' }).expect(201)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}/lessons/${l.id}`).send({ content: doc('Hi'), isPublished: true }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}`).send({ isFree: true }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/publish`).send({}).expect(200);
    return co as { id: string; slug: string };
  }
  async function student(slug: string, name: string) {
    const host = tenantHost(slug);
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: name, email: uniqueEmail('rev'), password: 'student-password-1' }).expect(201);
    return parseSession(reg, host);
  }

  it('enrolled students rate once (editable); summary on catalogue and course page; academy replies and hides with a reason', async () => {
    const c = await academy();
    const cs = c.session;
    const host = tenantHost(c.tenant.slug);
    const course = await freeCourse(cs, 'Budgeting 101');

    const outsider = await student(c.tenant.slug, 'Not Enrolled');
    await authed(app, outsider).put(`/api/v1/learn/courses/${course.id}/review`).send({ rating: 5 }).expect(403);

    const s1 = await student(c.tenant.slug, 'Asha Rani Verma');
    const s2 = await student(c.tenant.slug, 'Bob');
    const s3 = await student(c.tenant.slug, 'Chitra Nair');
    for (const s of [s1, s2, s3]) await authed(app, s).post(`/api/v1/learn/courses/${course.id}/enroll`).expect(201);
    await authed(app, s1).put(`/api/v1/learn/courses/${course.id}/review`).send({ rating: 6 }).expect(422);
    expect((await authed(app, s1).get(`/api/v1/learn/courses/${course.id}/review`).expect(200)).body.data).toBeNull();
    await authed(app, s1).put(`/api/v1/learn/courses/${course.id}/review`).send({ rating: 4, title: 'Useful', body: '  Clear lessons on budgeting.  ' }).expect(200);
    const edited = (await authed(app, s1).put(`/api/v1/learn/courses/${course.id}/review`).send({ rating: 5, title: 'Excellent', body: 'Clear lessons on budgeting.' }).expect(200)).body.data;
    expect(edited).toMatchObject({ rating: 5, title: 'Excellent', status: 'PUBLISHED' });
    expect(await prisma.courseReview.count({ where: { courseId: course.id } })).toBe(1); // one review per student
    await authed(app, s2).put(`/api/v1/learn/courses/${course.id}/review`).send({ rating: 3 }).expect(200);
    await authed(app, s3).put(`/api/v1/learn/courses/${course.id}/review`).send({ rating: 1, body: 'Spam spam visit my site' }).expect(200);

    // Public summary and list: names shortened, no emails.
    let pub = (await api(app).get(`/api/v1/public/courses/${course.slug}/reviews`).set('Host', host).expect(200)).body.data;
    expect(pub.summary).toEqual({ average: 3, count: 3, distribution: { 1: 1, 2: 0, 3: 1, 4: 0, 5: 1 } });
    expect(pub.items.map((r: any) => r.author).sort()).toEqual(['Asha V.', 'Bob', 'Chitra N.']);
    expect(JSON.stringify(pub)).not.toMatch(/@/);
    expect((await api(app).get(`/api/v1/public/courses/${course.slug}/reviews?rating=5`).set('Host', host)).body.data.items).toHaveLength(1);
    const card = (await api(app).get('/api/v1/public/courses').set('Host', host).expect(200)).body.data.find((x: any) => x.id === course.id);
    expect(card).toMatchObject({ ratingAverage: 3, ratingCount: 3 });

    // Academy: list, reply, hide with a reason (the author sees it; the average excludes it).
    const list = (await authed(app, cs).get('/api/v1/creator/reviews').expect(200)).body.data;
    expect(list).toMatchObject({ total: 3, average: 3, publishedCount: 3 });
    const spam = list.items.find((r: any) => r.rating === 1);
    expect(spam.student).toMatchObject({ name: 'Chitra Nair', email: expect.stringContaining('@') });
    const good = list.items.find((r: any) => r.rating === 5);
    await authed(app, cs).post(`/api/v1/creator/reviews/${good.id}/reply`).send({ reply: 'Thank you, Asha!' }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/reviews/${spam.id}/status`).send({ status: 'HIDDEN' }).expect(422);
    await authed(app, cs).post(`/api/v1/creator/reviews/${spam.id}/status`).send({ status: 'HIDDEN', reason: 'Contains advertising' }).expect(200);
    pub = (await api(app).get(`/api/v1/public/courses/${course.slug}/reviews`).set('Host', host)).body.data;
    expect(pub.summary).toMatchObject({ average: 4, count: 2 });
    expect(pub.items.find((r: any) => r.author === 'Asha V.')).toMatchObject({ reply: 'Thank you, Asha!' });
    expect((await authed(app, s3).get(`/api/v1/learn/courses/${course.id}/review`)).body.data).toMatchObject({ status: 'HIDDEN', hiddenReason: 'Contains advertising' });
    // Editing a hidden review does not re-publish it.
    await authed(app, s3).put(`/api/v1/learn/courses/${course.id}/review`).send({ rating: 2, body: 'Not for me' }).expect(200);
    expect((await authed(app, s3).get(`/api/v1/learn/courses/${course.id}/review`)).body.data.status).toBe('HIDDEN');
    expect((await authed(app, cs).get('/api/v1/creator/reviews?status=UNANSWERED').expect(200)).body.data.total).toBe(2);
    expect((await api(app).get(`/api/v1/public/courses/${course.slug}`).set('Host', host)).body.data.rating).toMatchObject({ average: 4, count: 2 });

    // Students can delete their own review.
    await authed(app, s2).delete(`/api/v1/learn/courses/${course.id}/review`).expect(200);
    expect((await api(app).get(`/api/v1/public/courses/${course.slug}/reviews`).set('Host', host)).body.data.summary).toMatchObject({ average: 5, count: 1 });

    // Access lost → cannot review any more.
    const me = (await authed(app, s1).get('/api/v1/auth/me')).body.data.user.id;
    await prisma.enrollment.updateMany({ where: { userId: me, courseId: course.id }, data: { status: 'REVOKED' } });
    await authed(app, s1).put(`/api/v1/learn/courses/${course.id}/review`).send({ rating: 1 }).expect(403);

    // Another academy cannot see or moderate these reviews.
    const other = await academy();
    expect((await authed(app, other.session).get('/api/v1/creator/reviews').expect(200)).body.data.total).toBe(0);
    await authed(app, other.session).post(`/api/v1/creator/reviews/${good.id}/reply`).send({ reply: 'x' }).expect(404);
    await authed(app, other.session).post(`/api/v1/creator/reviews/${good.id}/status`).send({ status: 'HIDDEN', reason: 'x' }).expect(404);
    await api(app).get(`/api/v1/public/courses/${course.slug}/reviews`).set('Host', tenantHost(other.tenant.slug)).expect(404);
  });
});
