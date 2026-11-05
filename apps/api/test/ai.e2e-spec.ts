import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { AiClient, type AiCall } from '../src/modules/ai/ai.client.js';
import { EntitlementsService } from '../src/modules/subscriptions/entitlements.service.js';
import { api, authed, createTestApp, parseSession, registerCreator, resetDatabase, type Session, tenantHost, uniqueEmail } from './helpers.js';

const para = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const LESSON_TEXT = 'An index fund is a mutual fund that tracks a market index such as the Nifty 50. Because it simply copies the index, it has low costs and no fund-manager risk. Returns follow the market. SIPs let you invest a fixed amount every month, which averages your purchase price over time. '.repeat(2);

describe('AI features with monthly credits (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let ai: AiClient;
  let c: Awaited<ReturnType<typeof registerCreator>>;
  let cs: Session;
  let course: { id: string };
  let lessonId: string;
  const calls: AiCall<any>[] = [];
  let reply: (call: AiCall<any>) => Awaited<ReturnType<AiClient['generate']>> | Promise<never>;

  const setCredits = async (tenantId: string, limit: number | null, enabled = true) => {
    await prisma.tenantLimitOverride.deleteMany({ where: { tenantId, featureKey: 'ai.credits' } });
    await prisma.tenantLimitOverride.create({ data: { tenantId, featureKey: 'ai.credits', enabled, limitValue: limit, reason: 'test' } as never });
    await app.get(EntitlementsService).invalidate(tenantId);
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    ai = app.get(AiClient);
    // Replace only the network seam: the service, credits and validation run for real.
    Object.defineProperty(ai, 'configured', { get: () => true });
    ai.generate = (async (call: AiCall<any>) => { calls.push(call); return reply(call); }) as never;
    c = await registerCreator(app);
    cs = c.session;
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    course = (await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'Investing 101' }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${course.id}/curriculum`)).body.data[0].id;
    lessonId = (await authed(app, cs).post(`/api/v1/creator/courses/${course.id}/lessons`).send({ sectionId: sec, title: 'Index funds', type: 'TEXT' }).expect(201)).body.data.id;
    await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}/lessons/${lessonId}`).send({ content: para(LESSON_TEXT), isPublished: true }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}`).send({ isFree: true }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${course.id}/publish`).send({}).expect(200);
  });
  afterAll(async () => app?.close());

  it('outline → apply as drafts; credits reserved then settled to real usage; limits enforced', async () => {
    await setCredits(c.tenant.id, 100);
    reply = () => ({
      output: { sections: [{ title: 'Basics', lessons: [{ title: 'What is investing?', summary: 'Explain why money grows.' }, { title: '', summary: 'dropped: empty title' }] }, { title: 'Empty', lessons: [] }] },
      text: '', model: 'claude-opus-5-5', inputTokens: 1500, cachedTokens: 0, outputTokens: 900, stopReason: 'end_turn',
    });
    const out = (await authed(app, cs).post('/api/v1/creator/ai/course-outline').send({ topic: 'Personal investing for salaried people', level: 'Beginner', sections: 4 }).expect(200)).body.data;
    expect(out).toEqual({ sections: [{ title: 'Basics', lessons: [{ title: 'What is investing?', summary: 'Explain why money grows.' }] }], credits: 6 }); // 1500/1000 + 900/200 = 6
    expect(calls[0]).toMatchObject({ effort: 'medium', maxTokens: 8000 });
    expect((calls[0].messages[0].content as string)).toContain('Level: Beginner');

    const usage = (await authed(app, cs).get('/api/v1/creator/ai/usage').expect(200)).body.data;
    expect(usage).toMatchObject({ configured: true, limit: 100, used: 6, remaining: 94, byFeature: [{ feature: 'COURSE_OUTLINE', requests: 1, credits: 6 }] });
    expect(usage.recent[0]).toMatchObject({ feature: 'COURSE_OUTLINE', status: 'SUCCEEDED', credits: 6 });

    const applied = (await authed(app, cs).post(`/api/v1/creator/ai/courses/${course.id}/apply-outline`).send({ sections: out.sections }).expect(200)).body.data;
    expect(applied).toEqual({ sections: 1, lessons: 1 });
    const added = await prisma.courseLesson.findFirstOrThrow({ where: { courseId: course.id, title: 'What is investing?' } });
    expect(added).toMatchObject({ type: 'TEXT', isPublished: false });

    // Not enough credits for the reservation (max_tokens 8000 alone reserves 40).
    await setCredits(c.tenant.id, 40);
    const short = await authed(app, cs).post('/api/v1/creator/ai/course-outline').send({ topic: 'Another course idea' }).expect(403);
    expect(short.body.error).toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    expect(short.body.error.message).toMatch(/34 left; this needs up to 4\d/);
    // Not in plan at all.
    await setCredits(c.tenant.id, 0, false);
    expect((await authed(app, cs).post('/api/v1/creator/ai/course-outline').send({ topic: 'Another course idea' }).expect(403)).body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    expect(calls).toHaveLength(1);
  });

  it('lesson draft becomes safe rich text; quiz questions are validated; failures cost nothing; refusals are charged', async () => {
    await setCredits(c.tenant.id, null); // unlimited
    reply = () => ({
      output: { blocks: [{ kind: 'paragraph', text: 'Index funds copy an index.', items: [] }, { kind: 'heading', text: 'Why they are cheap', items: [] }, { kind: 'bullets', text: '', items: ['No stock picking', ' ', 'Low fees'] }] },
      text: '', model: 'claude-opus-5-5', inputTokens: 800, cachedTokens: 0, outputTokens: 400, stopReason: 'end_turn',
    });
    const draft = (await authed(app, cs).post('/api/v1/creator/ai/lesson-draft').send({ courseId: course.id, lessonId, notes: 'Use Indian examples' }).expect(200)).body.data;
    expect(draft.content).toEqual({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Index funds copy an index.' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Why they are cheap' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'No stock picking' }] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Low fees' }] }] }] },
    ] });
    // The draft saves through the normal lesson endpoint (allow-list validation passes).
    await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}/lessons/${lessonId}`).send({ content: draft.content }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}/lessons/${lessonId}`).send({ content: para(LESSON_TEXT) }).expect(200);

    reply = () => ({
      output: { questions: [
        { prompt: 'What does an index fund track?', options: ['A market index', 'A manager’s picks', 'Gold', 'Bonds only'], correctIndex: 0, explanation: 'It copies an index.' },
        { prompt: 'Broken', options: ['a', 'b'], correctIndex: 5, explanation: '' },
      ] },
      text: '', model: 'claude-opus-5-5', inputTokens: 300, cachedTokens: 0, outputTokens: 300, stopReason: 'end_turn',
    });
    const quiz = (await authed(app, cs).post('/api/v1/creator/ai/quiz-questions').send({ courseId: course.id, sourceLessonId: lessonId, count: 2 }).expect(200)).body.data;
    expect(quiz.questions).toEqual([{ type: 'MCQ_SINGLE', prompt: 'What does an index fund track?', explanation: 'It copies an index.', options: [{ label: 'A market index', isCorrect: true }, { label: 'A manager’s picks', isCorrect: false }, { label: 'Gold', isCorrect: false }, { label: 'Bonds only', isCorrect: false }] }]);
    expect(calls.at(-1)!.context).toContain('Lesson: Index funds');

    // Provider failure: request marked FAILED, 0 credits.
    reply = async () => { const { AppException } = await import('../src/common/errors/app-exception.js'); throw new AppException('RATE_LIMITED' as never, 'The AI service is busy. Please try again in a minute.', 503); };
    await authed(app, cs).post('/api/v1/creator/ai/lesson-draft').send({ courseId: course.id, lessonId }).expect(503);
    // Refusal: tokens were used, so it is charged, and the creator gets a clear message.
    reply = () => ({ output: null, text: '', model: 'claude-opus-5-5', inputTokens: 500, cachedTokens: 0, outputTokens: 10, stopReason: 'refusal' });
    expect((await authed(app, cs).post('/api/v1/creator/ai/lesson-draft').send({ courseId: course.id, lessonId }).expect(422)).body.error.message).toMatch(/declined/);
    const rows = await prisma.aiRequest.findMany({ where: { tenantId: c.tenant.id }, orderBy: { createdAt: 'desc' }, take: 2 });
    expect(rows.map((r) => [r.status, r.creditsCharged])).toEqual([['REFUSED', 1], ['FAILED', 0]]);
    expect((await authed(app, cs).get('/api/v1/creator/ai/usage')).body.data).toMatchObject({ limit: null, remaining: null });
  });

  it('student tutor: off by default, uses the lesson as cached context, needs access, daily limit; isolation', async () => {
    const host = tenantHost(c.tenant.slug);
    const reg = await api(app).post('/api/v1/auth/register/student').set('Host', host).send({ fullName: 'Tara Student', email: uniqueEmail('ai'), password: 'student-password-1' }).expect(201);
    const s = parseSession(reg, host);
    expect((await authed(app, s).get('/api/v1/learn/ai/tutor').expect(200)).body.data).toEqual({ enabled: false, remainingToday: 0 });
    await authed(app, s).post('/api/v1/learn/ai/tutor').send({ lessonId, question: 'What is an index fund?' }).expect(403);
    await authed(app, cs).put('/api/v1/creator/ai/settings').send({ enabled: true, dailyLimit: 2 }).expect(200);
    await authed(app, s).post('/api/v1/learn/ai/tutor').send({ lessonId, question: 'What is an index fund?' }).expect(403); // not enrolled
    await authed(app, s).post(`/api/v1/learn/courses/${course.id}/enroll`).expect((r) => expect([200, 201]).toContain(r.status));

    reply = () => ({ output: null, text: ' It tracks an index like the Nifty 50. ', model: 'claude-opus-5-5', inputTokens: 400, cachedTokens: 2000, outputTokens: 60, stopReason: 'end_turn' });
    const a1 = (await authed(app, s).post('/api/v1/learn/ai/tutor').send({ lessonId, question: 'What is an index fund?' }).expect(200)).body.data;
    expect(a1).toEqual({ answer: 'It tracks an index like the Nifty 50.', remainingToday: 1 });
    const call = calls.at(-1)!;
    expect(call).toMatchObject({ effort: 'low', maxTokens: 2000 });
    expect(call.context).toContain('SIPs let you invest');
    expect(call.system).toContain('Investing 101');
    await authed(app, s).post('/api/v1/learn/ai/tutor').send({ lessonId, question: 'And SIPs?', history: [{ role: 'user', content: 'What is an index fund?' }, { role: 'assistant', content: 'It tracks an index.' }] }).expect(200);
    expect(calls.at(-1)!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect((await authed(app, s).post('/api/v1/learn/ai/tutor').send({ lessonId, question: 'One more?' }).expect(429)).body.error.message).toMatch(/limit of 2/);
    expect((await prisma.aiRequest.findFirstOrThrow({ where: { feature: 'TUTOR' } })).creditsCharged).toBe(1); // 0.4 + 0.2 (cached) + 0.3

    // Another academy: no access to this course's lessons or usage.
    const other = await registerCreator(app);
    await setCredits(other.tenant.id, 100);
    expect((await authed(app, other.session).get('/api/v1/creator/ai/usage').expect(200)).body.data).toMatchObject({ used: 0, recent: [] });
    await authed(app, other.session).post('/api/v1/creator/ai/lesson-draft').send({ courseId: course.id, lessonId }).expect(404);
    await authed(app, other.session).post(`/api/v1/creator/ai/courses/${course.id}/apply-outline`).send({ sections: [{ title: 'x', lessons: [{ title: 'y' }] }] }).expect(404);
  });
});
