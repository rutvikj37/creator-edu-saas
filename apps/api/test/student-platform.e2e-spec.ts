import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import {
  api, authed, codeFromEmail, createTestApp, lastEmail, parseSession, PDF, PLATFORM, registerCreator, resetDatabase, tenantHost, uniqueEmail, type Session,
} from './helpers.js';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function liveAcademy(app: NestExpressApplication) {
  const c = await registerCreator(app);
  const prisma = app.get(PrismaService);
  await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
  await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
  return c;
}

async function student(app: NestExpressApplication, slug: string): Promise<Session & { email: string }> {
  const email = uniqueEmail('learner');
  const res = await api(app).post('/api/v1/auth/register/student').set('Host', tenantHost(slug)).send({ fullName: 'Lena Learner', email, password: 'learner-password-1' }).expect(201);
  return { ...parseSession(res, tenantHost(slug)), email };
}

describe('Student platform (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(async () => app?.close());

  it('full journey: catalog → enrol → learn → quiz (manual grading) → assignment → certificate → verify → revoke', async () => {
    const c = await liveAcademy(app);
    const cs = c.session;
    const course = (await authed(app, cs).post('/api/v1/creator/courses').send({ title: 'Data Science 101' }).expect(201)).body.data;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${course.id}/curriculum`)).body.data[0].id;
    const add = async (title: string, type: string) => (await authed(app, cs).post(`/api/v1/creator/courses/${course.id}/lessons`).send({ sectionId: sec, title, type }).expect(201)).body.data;
    const intro = await add('Introduction', 'TEXT');
    const preview = await add('Free taster', 'TEXT');
    const quiz = await add('Checkpoint quiz', 'QUIZ');
    const hw = await add('Homework', 'ASSIGNMENT');
    await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}/lessons/${intro.id}`).send({ content: doc('Welcome to data science.') }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}/lessons/${preview.id}`).send({ content: doc('A free sample.'), isFreePreview: true }).expect(200);

    // Quiz builder with validation
    const qbase = `/api/v1/creator/courses/${course.id}/lessons/${quiz.id}/quiz`;
    await authed(app, cs).post(`${qbase}/questions`).send({ type: 'MCQ_SINGLE', prompt: 'Bad', options: [{ label: 'A', isCorrect: true }, { label: 'B', isCorrect: true }] }).expect(422);
    await authed(app, cs).post(`${qbase}/questions`).send({ type: 'MCQ_SINGLE', prompt: 'Python is a…', points: 2, options: [{ label: 'Language', isCorrect: true }, { label: 'Snake only' }] }).expect(201);
    await authed(app, cs).post(`${qbase}/questions`).send({ type: 'FILL_BLANK', prompt: 'Function to print?', meta: { answers: ['print'] } }).expect(201);
    const q3 = await authed(app, cs).post(`${qbase}/questions`).send({ type: 'SHORT', prompt: 'Define a variable', points: 2 }).expect(201);
    await authed(app, cs).put(qbase).send({ passPercent: 60, maxAttempts: 2, negativeMarkRatio: 0.5 }).expect(200);
    expect(q3.body.data.questions).toHaveLength(3);
    await authed(app, cs).put(`/api/v1/creator/courses/${course.id}/lessons/${hw.id}/assignment`).send({ instructions: doc('Analyse the dataset.'), maxPoints: 10 }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${course.id}`).send({ isFree: true, certificateEnabled: true }).expect(200);
    await authed(app, cs).put('/api/v1/creator/certificates/template').send({ signatoryName: 'Asha Creator', signatoryRole: 'Founder', accentColor: '#0f766e' }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${course.id}/publish`).send({}).expect(200);

    // Catalog + preview are public
    const host = tenantHost(c.tenant.slug);
    const list = await api(app).get('/api/v1/public/courses').set('Host', host).expect(200);
    expect(list.body.data.map((x: any) => x.slug)).toEqual(['data-science-101']);
    const detail = await api(app).get('/api/v1/public/courses/data-science-101').set('Host', host).expect(200);
    expect(detail.body.data.sections[0].lessons).toHaveLength(4);
    expect(JSON.stringify(detail.body)).not.toContain('Welcome to data science'); // content not exposed
    await api(app).get(`/api/v1/public/courses/data-science-101/preview/${preview.id}`).set('Host', host).expect(200);
    await api(app).get(`/api/v1/public/courses/data-science-101/preview/${intro.id}`).set('Host', host).expect(404);

    // Student
    const s = await student(app, c.tenant.slug);
    await authed(app, s).get(`/api/v1/learn/lessons/${intro.id}`).expect(403);
    await authed(app, s).get(`/api/v1/learn/lessons/${preview.id}`).expect(200); // free preview without enrolment
    await authed(app, s).post(`/api/v1/learn/courses/${course.id}/enroll`).expect(201);
    const player = (await authed(app, s).get(`/api/v1/learn/courses/${course.id}/player`).expect(200)).body.data;
    expect(player.sections[0].lessons.map((l: any) => l.title)).toEqual(['Introduction', 'Free taster', 'Checkpoint quiz', 'Homework']);
    const content = (await authed(app, s).get(`/api/v1/learn/lessons/${intro.id}`).expect(200)).body.data;
    expect(content.content.content[0].content[0].text).toBe('Welcome to data science.');

    let p = (await authed(app, s).post(`/api/v1/learn/lessons/${intro.id}/complete`).expect(200)).body.data;
    expect(p.progressPercent).toBe(25);
    await authed(app, s).post(`/api/v1/learn/lessons/${preview.id}/complete`).expect(200);
    await authed(app, s).post(`/api/v1/learn/lessons/${quiz.id}/complete`).expect(422); // must pass the quiz

    // notes, bookmarks, comments
    const note = (await authed(app, s).post(`/api/v1/learn/lessons/${intro.id}/notes`).send({ body: 'Remember pandas' }).expect(201)).body.data;
    await authed(app, s).patch(`/api/v1/learn/notes/${note.id}`).send({ body: 'Remember pandas & numpy' }).expect(200);
    expect((await authed(app, s).post(`/api/v1/learn/lessons/${intro.id}/bookmark`).expect(200)).body.data.bookmarked).toBe(true);
    const thread = (await authed(app, s).post(`/api/v1/learn/lessons/${intro.id}/comments`).send({ body: 'Which Python version?' }).expect(201)).body.data;
    const unanswered = (await authed(app, cs).get('/api/v1/creator/discussions?unanswered=true').expect(200)).body.data;
    expect(unanswered.map((t: any) => t.id)).toContain(thread.id);
    await authed(app, cs).post(`/api/v1/creator/discussions/${thread.id}/replies`).send({ body: 'Python 3.12 or newer.' }).expect(201);
    const comments = (await authed(app, s).get(`/api/v1/learn/lessons/${intro.id}/comments`).expect(200)).body.data;
    expect(comments[0].replies[0]).toMatchObject({ isInstructor: true, body: 'Python 3.12 or newer.' });

    // Quiz attempt: questions served without answers; manual question pending
    const ov = (await authed(app, s).get(`/api/v1/learn/lessons/${quiz.id}/quiz`).expect(200)).body.data;
    expect(ov).toMatchObject({ questionCount: 3, attemptsUsed: 0, maxAttempts: 2 });
    const attempt = (await authed(app, s).post(`/api/v1/learn/lessons/${quiz.id}/quiz/attempts`).expect(201)).body.data;
    expect(JSON.stringify(attempt)).not.toMatch(/isCorrect|acceptedAnswers|"answers"/);
    const mcq = attempt.questions.find((q: any) => q.type === 'MCQ_SINGLE');
    const right = mcq.options.find((o: any) => o.label === 'Language');
    const fill = attempt.questions.find((q: any) => q.type === 'FILL_BLANK');
    const short = attempt.questions.find((q: any) => q.type === 'SHORT');
    await authed(app, s).put(`/api/v1/learn/quiz-attempts/${attempt.id}/answers`).send({ questionId: mcq.id, response: { optionId: right.id } }).expect(200);
    await authed(app, s).put(`/api/v1/learn/quiz-attempts/${attempt.id}/answers`).send({ questionId: fill.id, response: { text: ' Print ' } }).expect(200);
    await authed(app, s).put(`/api/v1/learn/quiz-attempts/${attempt.id}/answers`).send({ questionId: short.id, response: { text: 'A named value' } }).expect(200);
    const submitted = (await authed(app, s).post(`/api/v1/learn/quiz-attempts/${attempt.id}/submit`).expect(200)).body.data;
    expect(submitted).toMatchObject({ status: 'SUBMITTED', score: 3, maxScore: 5, passed: null });
    await authed(app, s).put(`/api/v1/learn/quiz-attempts/${attempt.id}/answers`).send({ questionId: mcq.id, response: { optionId: right.id } }).expect(409);

    const quizRow = await prisma.quiz.findFirstOrThrow({ where: { lessonId: quiz.id } });
    const attempts = (await authed(app, cs).get(`/api/v1/creator/quizzes/${quizRow.id}/attempts`).expect(200)).body.data;
    expect(attempts[0]).toMatchObject({ status: 'SUBMITTED', student: { email: s.email } });
    await authed(app, cs).post(`/api/v1/creator/quiz-attempts/${attempt.id}/grade`).send({ grades: [{ questionId: short.id, points: 5 }] }).expect(422);
    const graded = (await authed(app, cs).post(`/api/v1/creator/quiz-attempts/${attempt.id}/grade`).send({ grades: [{ questionId: short.id, points: 1.5, feedback: 'Close — mention assignment.' }] }).expect(200)).body.data;
    expect(graded).toMatchObject({ status: 'GRADED', score: 4.5, percent: 90, passed: true });
    const result = (await authed(app, s).get(`/api/v1/learn/quiz-attempts/${attempt.id}`).expect(200)).body.data;
    expect(result.questions.find((q: any) => q.id === short.id).feedback).toBe('Close — mention assignment.');
    expect(result.questions.find((q: any) => q.id === mcq.id).options.find((o: any) => o.label === 'Language').isCorrect).toBe(true);

    // Assignment with an uploaded file
    const begin = (await authed(app, s).post('/api/v1/learn/files').send({ purpose: 'SUBMISSION', fileName: 'analysis.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length }).expect(201)).body.data;
    await authed(app, s).post('/api/v1/learn/files').send({ purpose: 'LOGO', fileName: 'x.png', mimeType: 'image/png', sizeBytes: 10 }).expect(422);
    await request(app.getHttpServer()).put(new URL(begin.upload.url).pathname).set('Host', host).set('Content-Type', 'application/pdf').send(PDF).expect(200);
    await authed(app, s).post(`/api/v1/learn/files/${begin.fileId}/complete`).expect(200);
    await authed(app, s).post(`/api/v1/learn/lessons/${hw.id}/assignment/submission`).send({}).expect(422);
    const sub = (await authed(app, s).post(`/api/v1/learn/lessons/${hw.id}/assignment/submission`).send({ text: 'See attached.', fileAssetIds: [begin.fileId] }).expect(201)).body.data;
    expect(sub.submission).toMatchObject({ status: 'SUBMITTED', files: [expect.objectContaining({ fileName: 'analysis.pdf' })] });

    // Course complete → certificate
    const prog = (await authed(app, s).get(`/api/v1/learn/courses/${course.id}/player`).expect(200)).body.data;
    expect(prog.enrollment.progressPercent).toBe(100);
    expect(prog.enrollment.completedAt).not.toBeNull();
    const certs = (await authed(app, s).get('/api/v1/learn/certificates').expect(200)).body.data;
    expect(certs).toHaveLength(1);
    expect(certs[0]).toMatchObject({ recipientName: 'Lena Learner', courseTitle: 'Data Science 101', status: 'ISSUED' });
    const pdf = await request(app.getHttpServer()).get(`/api/v1/learn/certificates/${certs[0].id}/pdf`).set('Host', host).set('Authorization', `Bearer ${s.accessToken}`)
      .buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (x: Buffer) => d.push(x)); res.on('end', () => cb(null, Buffer.concat(d))); }).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const verified = (await api(app).get(`/api/v1/public/certificates/${certs[0].number}`).set('Host', PLATFORM).expect(200)).body.data;
    expect(verified).toMatchObject({ valid: true, recipientName: 'Lena Learner', academyName: c.tenant.name });
    await api(app).get('/api/v1/public/certificates/CE-2026-NOPE0000').set('Host', PLATFORM).expect(404);
    await authed(app, cs).post(`/api/v1/creator/certificates/${certs[0].id}/revoke`).send({ reason: 'Issued in error' }).expect(200);
    expect((await api(app).get(`/api/v1/public/certificates/${certs[0].number}`).set('Host', PLATFORM)).body.data).toMatchObject({ valid: false, status: 'REVOKED' });
    await authed(app, s).get(`/api/v1/learn/certificates/${certs[0].id}/pdf`).expect(403);

    // Creator views
    const subs = (await authed(app, cs).get(`/api/v1/creator/assignments/${sub.id}/submissions`).expect(200)).body.data;
    expect(subs[0].student.email).toBe(s.email);
    await authed(app, cs).post(`/api/v1/creator/submissions/${subs[0].id}/grade`).send({ points: 11, status: 'GRADED' }).expect(422);
    await authed(app, cs).post(`/api/v1/creator/submissions/${subs[0].id}/grade`).send({ points: 9, feedback: 'Great work', status: 'GRADED' }).expect(200);
    const students = (await authed(app, cs).get('/api/v1/creator/students?q=lena').expect(200)).body.data;
    expect(students[0]).toMatchObject({ email: s.email, enrollmentCount: 1 });
  });

  it('access rules: paid courses, drip, expiry and revocation', async () => {
    const c = await liveAcademy(app);
    const course = (await authed(app, c.session).post('/api/v1/creator/courses').send({ title: 'Paid Mastery' }).expect(201)).body.data;
    const cur = (await authed(app, c.session).get(`/api/v1/creator/courses/${course.id}/curriculum`)).body.data;
    const l1 = (await authed(app, c.session).post(`/api/v1/creator/courses/${course.id}/lessons`).send({ sectionId: cur[0].id, title: 'Day 1', type: 'TEXT' })).body.data;
    const s2 = (await authed(app, c.session).post(`/api/v1/creator/courses/${course.id}/sections`).send({ title: 'Week 2', dripOffsetDays: 7 }).expect(201)).body.data;
    const l2 = (await authed(app, c.session).post(`/api/v1/creator/courses/${course.id}/lessons`).send({ sectionId: s2.id, title: 'Day 8', type: 'TEXT' })).body.data;
    for (const l of [l1, l2]) await authed(app, c.session).patch(`/api/v1/creator/courses/${course.id}/lessons/${l.id}`).send({ content: doc('x') }).expect(200);
    await authed(app, c.session).patch(`/api/v1/creator/courses/${course.id}`).send({ priceAmount: 4999, dripType: 'DAYS_AFTER_ENROLL', accessType: 'FIXED_DAYS', accessDays: 30 }).expect(200);
    await authed(app, c.session).post(`/api/v1/creator/courses/${course.id}/publish`).send({}).expect(200);

    const s = await student(app, c.tenant.slug);
    await authed(app, s).post(`/api/v1/learn/courses/${course.id}/enroll`).expect(403); // paid
    // Manual grant by the creator (also used for purchases in Phase 7)
    const grant = (await authed(app, c.session).post(`/api/v1/creator/courses/${course.id}/enrollments`).send({ email: s.email }).expect(201)).body.data;
    expect(grant.invited).toBe(false);
    const player = (await authed(app, s).get(`/api/v1/learn/courses/${course.id}/player`).expect(200)).body.data;
    expect(player.enrollment.expiresAt).not.toBeNull();
    expect(player.sections[1].lessons[0]).toMatchObject({ locked: true });
    const locked = await authed(app, s).get(`/api/v1/learn/lessons/${l2.id}`).expect(403);
    expect(locked.body.error.message).toMatch(/unlocks on/);
    await authed(app, s).get(`/api/v1/learn/lessons/${l1.id}`).expect(200);

    await prisma.enrollment.update({ where: { id: grant.enrollmentId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await authed(app, s).get(`/api/v1/learn/lessons/${l1.id}`).expect(403);
    expect(expired.body.error.message).toMatch(/expired/);
    expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: grant.enrollmentId } })).status).toBe('EXPIRED');

    // Re-grant then revoke
    await authed(app, c.session).post(`/api/v1/creator/courses/${course.id}/enrollments`).send({ email: s.email }).expect(201);
    await authed(app, s).get(`/api/v1/learn/lessons/${l1.id}`).expect(200);
    await authed(app, c.session).delete(`/api/v1/creator/enrollments/${grant.enrollmentId}`).expect(200);
    await authed(app, s).get(`/api/v1/learn/lessons/${l1.id}`).expect(403);

    // Manual enrolment of a new email creates an invited account
    const newEmail = uniqueEmail('invitee');
    const inv = (await authed(app, c.session).post(`/api/v1/creator/courses/${course.id}/enrollments`).send({ email: newEmail }).expect(201)).body.data;
    expect(inv.invited).toBe(true);
    expect((await lastEmail(app, newEmail))?.tag).toBe('enrolled');
  });

  it('learning data is isolated between academies', async () => {
    const a = await liveAcademy(app);
    const b = await liveAcademy(app);
    const course = (await authed(app, a.session).post('/api/v1/creator/courses').send({ title: 'A-only' }).expect(201)).body.data;
    const cur = (await authed(app, a.session).get(`/api/v1/creator/courses/${course.id}/curriculum`)).body.data;
    const l = (await authed(app, a.session).post(`/api/v1/creator/courses/${course.id}/lessons`).send({ sectionId: cur[0].id, title: 'L', type: 'TEXT' })).body.data;
    await authed(app, a.session).patch(`/api/v1/creator/courses/${course.id}/lessons/${l.id}`).send({ content: doc('secret') }).expect(200);
    await authed(app, a.session).patch(`/api/v1/creator/courses/${course.id}`).send({ isFree: true }).expect(200);
    await authed(app, a.session).post(`/api/v1/creator/courses/${course.id}/publish`).send({}).expect(200);

    const sb = await student(app, b.tenant.slug);
    await authed(app, sb).post(`/api/v1/learn/courses/${course.id}/enroll`).expect(404);
    await authed(app, sb).get(`/api/v1/learn/lessons/${l.id}`).expect(404);
    await authed(app, sb).get(`/api/v1/learn/courses/${course.id}/player`).expect(404);
    await api(app).get('/api/v1/public/courses/a-only').set('Host', tenantHost(b.tenant.slug)).expect(404);
    await authed(app, b.session).get(`/api/v1/creator/courses/${course.id}/enrollments`).expect(200).then((r) => expect(r.body.data).toEqual([]));
    await authed(app, b.session).post(`/api/v1/creator/courses/${course.id}/enrollments`).send({ email: sb.email }).expect(404);
  });
});
