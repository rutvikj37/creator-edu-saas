import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { api, authed, createTestApp, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const mcq = (prompt: string, right: string, wrong: string, tags: string[]) => ({ type: 'MCQ_SINGLE', prompt, points: 2, options: [{ label: right, isCorrect: true }, { label: wrong, isCorrect: false }], tags });

describe('Question bank (e2e)', () => {
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
  async function courseWithQuizzes(cs: Session) {
    const co = (await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'Algebra' }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
    const q1 = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Quiz 1', type: 'QUIZ' }).expect(201)).body.data;
    const q2 = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Quiz 2', type: 'QUIZ' }).expect(201)).body.data;
    return { course: co as { id: string }, q1: q1 as { id: string }, q2: q2 as { id: string } };
  }

  it('bank CRUD with tags; copy into quizzes by pick or random draw; copies are independent; save quiz questions to the bank', async () => {
    const c = await academy();
    const cs = c.session;
    const bad = await authed(app, cs).post('/api/v1/creator/question-bank').send({ type: 'MCQ_SINGLE', prompt: 'No right answer', options: [{ label: 'a' }, { label: 'b' }] }).expect(422);
    expect(bad.body.error.details[0]).toEqual({ field: 'options', message: 'Mark exactly one correct option' });

    const a = (await authed(app, cs).post('/api/v1/creator/question-bank').send(mcq('2 + 2 = ?', '4', '5', ['Arithmetic', 'chapter 1', 'arithmetic'])).expect(201)).body.data;
    expect(a).toMatchObject({ tags: ['arithmetic', 'chapter-1'], points: 2, usedInQuizzes: 0 });
    const b = (await authed(app, cs).post('/api/v1/creator/question-bank').send(mcq('3 × 3 = ?', '9', '6', ['arithmetic'])).expect(201)).body.data;
    const fill = (await authed(app, cs).post('/api/v1/creator/question-bank').send({ type: 'FILL_BLANK', prompt: 'x + 1 = 3, x = ___', meta: { answers: ['2'] }, tags: ['algebra'] }).expect(201)).body.data;
    for (let i = 0; i < 3; i++) await authed(app, cs).post('/api/v1/creator/question-bank').send(mcq(`${i} + 10 = ?`, String(i + 10), '0', ['drill'])).expect(201);

    expect((await authed(app, cs).get('/api/v1/creator/question-bank?tag=arithmetic').expect(200)).body.data.items.map((q: any) => q.id).sort()).toEqual([a.id, b.id].sort());
    expect((await authed(app, cs).get('/api/v1/creator/question-bank?type=FILL_BLANK').expect(200)).body.data.items.map((q: any) => q.id)).toEqual([fill.id]);
    expect((await authed(app, cs).get('/api/v1/creator/question-bank?q=%C3%97').expect(200)).body.data.items.map((q: any) => q.id)).toEqual([b.id]);
    expect((await authed(app, cs).get('/api/v1/creator/question-bank/tags').expect(200)).body.data).toEqual([
      { tag: 'algebra', count: 1 }, { tag: 'arithmetic', count: 2 }, { tag: 'chapter-1', count: 1 }, { tag: 'drill', count: 3 },
    ]);

    // Pick into Quiz 1 (options copied); picking again skips duplicates.
    const { course, q1, q2 } = await courseWithQuizzes(cs);
    const quizPath = `/api/v1/creator/courses/${course.id}/lessons/${q1.id}/quiz`;
    let r = (await authed(app, cs).post(`${quizPath}/questions/from-bank`).send({ questionIds: [a.id, fill.id] }).expect(200)).body.data;
    expect(r).toMatchObject({ added: 2, skipped: 0 });
    expect(r.quiz.questions.map((q: any) => [q.prompt, q.bankQuestionId, q.options.length])).toEqual([['2 + 2 = ?', a.id, 2], ['x + 1 = 3, x = ___', fill.id, 0]]);
    r = (await authed(app, cs).post(`${quizPath}/questions/from-bank`).send({ questionIds: [a.id, b.id] }).expect(200)).body.data;
    expect(r).toMatchObject({ added: 1, skipped: 1 });

    // Random draw from a tag into Quiz 2; asking for more than available is refused.
    const q2Path = `/api/v1/creator/courses/${course.id}/lessons/${q2.id}/quiz`;
    const tooMany = await authed(app, cs).post(`${q2Path}/questions/from-bank`).send({ tag: 'drill', count: 4 }).expect(422);
    expect(tooMany.body.error.details[0].message).toBe('Only 3 unused questions tagged “drill”');
    const drawn = (await authed(app, cs).post(`${q2Path}/questions/from-bank`).send({ tag: 'drill', count: 2 }).expect(200)).body.data;
    expect(drawn.added).toBe(2);
    const last = (await authed(app, cs).post(`${q2Path}/questions/from-bank`).send({ tag: 'drill', count: 1 }).expect(200)).body.data;
    expect(new Set(last.quiz.questions.map((q: any) => q.bankQuestionId)).size).toBe(3); // the third, unused one
    await authed(app, cs).post(`${q2Path}/questions/from-bank`).send({}).expect(422);

    // Editing or deleting the bank question does not change the quiz copy.
    await authed(app, cs).put(`/api/v1/creator/question-bank/${a.id}`).send({ ...mcq('2 + 2 equals?', '4', '22', ['arithmetic']) }).expect(200);
    await authed(app, cs).delete(`/api/v1/creator/question-bank/${b.id}`).expect(200);
    const quiz1 = (await authed(app, cs).get(quizPath).expect(200)).body.data;
    expect(quiz1.questions.map((q: any) => q.prompt)).toEqual(['2 + 2 = ?', 'x + 1 = 3, x = ___', '3 × 3 = ?']);
    expect((await authed(app, cs).get('/api/v1/creator/question-bank?tag=arithmetic').expect(200)).body.data.items).toEqual([expect.objectContaining({ id: a.id, prompt: '2 + 2 equals?', usedInQuizzes: 1 })]);

    // A question written in a quiz can be saved to the bank.
    const own = (await authed(app, cs).post(`${quizPath}/questions`).send({ type: 'TRUE_FALSE', prompt: 'Zero is even', options: [{ label: 'True', isCorrect: true }, { label: 'False', isCorrect: false }] }).expect(201)).body.data.questions.at(-1);
    const saved = (await authed(app, cs).post(`${quizPath}/questions/${own.id}/save-to-bank`).send({ tags: ['Number sense'] }).expect(200)).body.data;
    expect(saved).toMatchObject({ prompt: 'Zero is even', type: 'TRUE_FALSE', tags: ['number-sense'], options: [{ label: 'True', isCorrect: true }, { label: 'False', isCorrect: false }] });

    // Students take the quiz with copied questions and are graded normally.
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${course.id}/curriculum`)).body.data[0].id;
    const text = (await authed(app, cs).post(`/api/v1/creator/courses/${course.id}/lessons`).send({ sectionId: sec, title: 'Read me', type: 'TEXT' }).expect(201)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}/lessons/${text.id}`).send({ content: doc('Hi'), isPublished: true }).expect(200);
    for (const l of [q1, q2]) await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}/lessons/${l.id}`).send({ isPublished: true }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}`).send({ isFree: true }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${course.id}/publish`).send({}).expect(200);
    const host = tenantHost(c.tenant.slug);
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: 'Quiz Taker', email: uniqueEmail('qb'), password: 'student-password-1' }).expect(201);
    const s = parseSession(reg, host);
    await authed(app, s).post(`/api/v1/learn/courses/${course.id}/enroll`).expect(201);
    const attempt = (await authed(app, s).post(`/api/v1/learn/lessons/${q1.id}/quiz/attempts`).expect(201)).body.data;
    const two = attempt.questions.find((q: any) => q.prompt === '2 + 2 = ?');
    await authed(app, s).put(`/api/v1/learn/quiz-attempts/${attempt.id}/answers`).send({ questionId: two.id, response: { optionId: two.options.find((o: any) => o.label === '4').id } }).expect(200);
    const blank = attempt.questions.find((q: any) => q.type === 'FILL_BLANK');
    await authed(app, s).put(`/api/v1/learn/quiz-attempts/${attempt.id}/answers`).send({ questionId: blank.id, response: { text: '2' } }).expect(200);
    const result = (await authed(app, s).post(`/api/v1/learn/quiz-attempts/${attempt.id}/submit`).expect(200)).body.data;
    expect(Number(result.score)).toBe(3); // 2 points + 1 point; the 3 × 3 and true/false answers left blank

    // Another academy cannot read, edit, delete or use this bank.
    const other = await academy();
    expect((await authed(app, other.session).get('/api/v1/creator/question-bank').expect(200)).body.data.total).toBe(0);
    await authed(app, other.session).put(`/api/v1/creator/question-bank/${a.id}`).send(mcq('mine', 'x', 'y', [])).expect(404);
    await authed(app, other.session).delete(`/api/v1/creator/question-bank/${a.id}`).expect(404);
    const oc = await courseWithQuizzes(other.session);
    await authed(app, other.session).post(`/api/v1/creator/courses/${oc.course.id}/lessons/${oc.q1.id}/quiz/questions/from-bank`).send({ questionIds: [a.id] }).expect(422);
  });
});
