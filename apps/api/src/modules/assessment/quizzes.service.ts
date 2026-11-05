import { Inject, Injectable } from '@nestjs/common';
import { AppException, type FieldError } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { LearningService } from '../learning/learning.service.js';
import type { AnswerDto, ManualGradeDto, QuestionDto, QuizSettingsDto } from './dto.js';
import { MANUAL_TYPES, scoreAttempt, shuffle, type GradableQuestion, type Response } from './grading.js';

const GRACE_MS = 30_000;

function validateQuestion(dto: QuestionDto): FieldError[] {
  const opts = dto.options ?? [];
  const correct = opts.filter((o) => o.isCorrect).length;
  switch (dto.type) {
    case 'MCQ_SINGLE':
    case 'TRUE_FALSE':
      if (opts.length < 2) return [{ field: 'options', message: 'Add at least two options' }];
      if (correct !== 1) return [{ field: 'options', message: 'Mark exactly one correct option' }];
      return [];
    case 'MCQ_MULTI':
      if (opts.length < 2) return [{ field: 'options', message: 'Add at least two options' }];
      if (correct < 1) return [{ field: 'options', message: 'Mark at least one correct option' }];
      return [];
    case 'FILL_BLANK':
      return dto.meta?.answers?.filter((a) => a.trim()).length ? [] : [{ field: 'meta', message: 'Add at least one accepted answer' }];
    case 'MATCHING':
      return opts.filter((o) => o.matchKey).length >= 2 ? [] : [{ field: 'options', message: 'Add at least two pairs' }];
    default:
      return [];
  }
}

@Injectable()
export class QuizzesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly learning: LearningService,
  ) {}

  // ── creator side ──────────────────────────────────────────
  async forLesson(courseId: string, lessonId: string) {
    const lesson = await this.db.courseLesson.findFirst({ where: { id: lessonId, courseId, type: 'QUIZ' } });
    if (!lesson) throw AppException.notFound('Quiz lesson not found');
    const quiz = (await this.db.quiz.findFirst({ where: { lessonId } })) ?? (await this.db.quiz.create({ data: { courseId, lessonId } as never }));
    const questions = await this.db.quizQuestion.findMany({ where: { quizId: quiz.id }, orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } });
    return { ...quiz, negativeMarkRatio: Number(quiz.negativeMarkRatio), questions: questions.map((q) => ({ ...q, points: Number(q.points) })) };
  }

  async updateSettings(courseId: string, lessonId: string, dto: QuizSettingsDto) {
    const quiz = await this.forLesson(courseId, lessonId);
    if (dto.randomPickCount && dto.randomPickCount > quiz.questions.length) throw AppException.validation([{ field: 'randomPickCount', message: 'Cannot pick more questions than the quiz has' }]);
    await this.db.quiz.update({ where: { id: quiz.id }, data: dto });
    return this.forLesson(courseId, lessonId);
  }

  private async writeOptions(questionId: string, dto: QuestionDto) {
    const tenantId = this.ctx.requireTenantId();
    await this.prisma.quizOption.deleteMany({ where: { tenantId, questionId } });
    const options = MANUAL_TYPES.has(dto.type) || dto.type === 'FILL_BLANK' ? [] : (dto.options ?? []);
    if (options.length) await this.prisma.quizOption.createMany({ data: options.map((o, i) => ({ tenantId, questionId, label: o.label, isCorrect: Boolean(o.isCorrect), matchKey: o.matchKey ?? null, position: i })) });
  }

  async addQuestion(courseId: string, lessonId: string, dto: QuestionDto) {
    const errors = validateQuestion(dto);
    if (errors.length) throw AppException.validation(errors);
    const quiz = await this.forLesson(courseId, lessonId);
    const q = await this.db.quizQuestion.create({
      data: { quizId: quiz.id, type: dto.type, prompt: dto.prompt, explanation: dto.explanation ?? null, points: dto.points ?? 1, position: quiz.questions.length, meta: dto.type === 'FILL_BLANK' ? (dto.meta as never) : undefined } as never,
    });
    await this.writeOptions(q.id, dto);
    return this.forLesson(courseId, lessonId);
  }

  async updateQuestion(courseId: string, lessonId: string, questionId: string, dto: QuestionDto) {
    const errors = validateQuestion(dto);
    if (errors.length) throw AppException.validation(errors);
    const quiz = await this.forLesson(courseId, lessonId);
    if (!quiz.questions.some((q) => q.id === questionId)) throw AppException.notFound('Question not found');
    await this.db.quizQuestion.update({ where: { id: questionId }, data: { type: dto.type, prompt: dto.prompt, explanation: dto.explanation ?? null, points: dto.points ?? 1, meta: dto.type === 'FILL_BLANK' ? (dto.meta as never) : null as never } });
    await this.writeOptions(questionId, dto);
    return this.forLesson(courseId, lessonId);
  }

  async removeQuestion(courseId: string, lessonId: string, questionId: string) {
    const quiz = await this.forLesson(courseId, lessonId);
    if (!quiz.questions.some((q) => q.id === questionId)) throw AppException.notFound('Question not found');
    await this.db.quizQuestion.delete({ where: { id: questionId } });
    return this.forLesson(courseId, lessonId);
  }

  async reorder(courseId: string, lessonId: string, ids: string[]) {
    const quiz = await this.forLesson(courseId, lessonId);
    const existing = quiz.questions.map((q) => q.id);
    if (ids.length !== existing.length || !ids.every((id) => existing.includes(id))) throw AppException.validation([{ field: 'ids', message: 'Question list changed; reload and try again' }]);
    const tenantId = this.ctx.requireTenantId();
    await this.prisma.$transaction(ids.map((id, i) => this.prisma.quizQuestion.update({ where: { tenantId_id: { tenantId, id } }, data: { position: i } })));
    return this.forLesson(courseId, lessonId);
  }

  async attemptsForQuiz(quizId: string) {
    const rows = await this.db.quizAttempt.findMany({ where: { quizId, status: { not: 'IN_PROGRESS' } }, orderBy: { submittedAt: 'desc' }, take: 500 });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, fullName: true, email: true } });
    return rows.map((r) => ({ ...r, score: r.score === null ? null : Number(r.score), maxScore: r.maxScore === null ? null : Number(r.maxScore), percent: r.percent === null ? null : Number(r.percent), student: users.find((u) => u.id === r.userId) }));
  }

  // ── student side ──────────────────────────────────────────
  private async quizForStudent(userId: string, lessonId: string) {
    const { lesson, enrollment } = await this.learning.accessibleLesson(userId, lessonId);
    if (lesson.type !== 'QUIZ') throw AppException.notFound('Quiz not found');
    if (!enrollment) throw AppException.forbidden('Enrol to take this quiz.');
    const quiz = await this.db.quiz.findFirst({ where: { lessonId } });
    if (!quiz) throw AppException.notFound('Quiz not found');
    return { quiz, enrollment, lesson };
  }

  private gradable(qs: Array<{ id: string; type: string; points: unknown; meta: unknown; options: Array<{ id: string; label: string; isCorrect: boolean; matchKey: string | null }> }>): GradableQuestion[] {
    return qs.map((q) => ({ id: q.id, type: q.type, points: Number(q.points), meta: (q.meta as GradableQuestion['meta']) ?? null, options: q.options }));
  }

  async overview(userId: string, lessonId: string) {
    const { quiz } = await this.quizForStudent(userId, lessonId);
    const [count, attempts] = await Promise.all([
      this.db.quizQuestion.count({ where: { quizId: quiz.id } }),
      this.db.quizAttempt.findMany({ where: { quizId: quiz.id, userId }, orderBy: { attemptNo: 'desc' } }),
    ]);
    const open = attempts.find((a) => a.status === 'IN_PROGRESS');
    return {
      quizId: quiz.id, instructions: quiz.instructions, timeLimitSeconds: quiz.timeLimitSeconds, passPercent: quiz.passPercent, maxAttempts: quiz.maxAttempts,
      questionCount: quiz.randomPickCount ? Math.min(quiz.randomPickCount, count) : count, negativeMarking: Number(quiz.negativeMarkRatio) > 0,
      attemptsUsed: attempts.length, openAttemptId: open?.id ?? null,
      bestPercent: attempts.reduce<number | null>((m, a) => (a.percent === null ? m : Math.max(m ?? 0, Number(a.percent))), null),
      passed: attempts.some((a) => a.passed),
      attempts: attempts.map((a) => ({ id: a.id, attemptNo: a.attemptNo, status: a.status, percent: a.percent === null ? null : Number(a.percent), passed: a.passed, submittedAt: a.submittedAt })),
    };
  }

  async start(userId: string, lessonId: string) {
    const { quiz, enrollment } = await this.quizForStudent(userId, lessonId);
    const open = await this.db.quizAttempt.findFirst({ where: { quizId: quiz.id, userId, status: 'IN_PROGRESS' } });
    if (open && (!open.expiresAt || open.expiresAt.getTime() + GRACE_MS > Date.now())) return this.attempt(userId, open.id);
    if (open) await this.submit(userId, open.id); // time ran out: finalise with saved answers
    const used = await this.db.quizAttempt.count({ where: { quizId: quiz.id, userId } });
    if (quiz.maxAttempts && used >= quiz.maxAttempts) throw AppException.forbidden(`You have used all ${quiz.maxAttempts} attempts.`);
    const questions = await this.db.quizQuestion.findMany({ where: { quizId: quiz.id }, orderBy: { position: 'asc' }, select: { id: true } });
    if (!questions.length) throw AppException.conflict('This quiz has no questions yet.');
    let ids = questions.map((q) => q.id);
    if (quiz.shuffleQuestions || quiz.randomPickCount) ids = shuffle(ids);
    if (quiz.randomPickCount) ids = ids.slice(0, quiz.randomPickCount);
    const attempt = await this.db.quizAttempt.create({
      data: { quizId: quiz.id, userId, enrollmentId: enrollment.id, attemptNo: used + 1, questionOrder: ids, expiresAt: quiz.timeLimitSeconds ? new Date(Date.now() + quiz.timeLimitSeconds * 1000) : null } as never,
    });
    return this.attempt(userId, attempt.id);
  }

  private async loadAttempt(userId: string, attemptId: string) {
    const a = await this.db.quizAttempt.findFirst({ where: { id: attemptId, userId }, include: { quiz: true, answers: true } });
    if (!a) throw AppException.notFound('Attempt not found');
    return a;
  }

  /** In progress: questions without answers. Finished: results (with correct answers if allowed). */
  async attempt(userId: string, attemptId: string) {
    const a = await this.loadAttempt(userId, attemptId);
    const order = a.questionOrder as string[];
    const rows = await this.db.quizQuestion.findMany({ where: { id: { in: order } }, include: { options: { orderBy: { position: 'asc' } } } });
    const byId = new Map(rows.map((q) => [q.id, q]));
    const answers = new Map(a.answers.map((x) => [x.questionId, x]));
    const done = a.status !== 'IN_PROGRESS';
    const reveal = done && a.quiz.showResults;
    const questions = order.map((id) => byId.get(id)).filter(Boolean).map((q) => {
      const ans = answers.get(q!.id);
      const left = q!.options.filter((o) => o.matchKey);
      const options = q!.type === 'MATCHING' ? left : a.quiz.shuffleOptions && !done ? shuffle(q!.options) : q!.options;
      return {
        id: q!.id, type: q!.type, prompt: q!.prompt, points: Number(q!.points),
        options: options.map((o) => ({ id: o.id, label: o.label, ...(reveal && q!.type !== 'MATCHING' ? { isCorrect: o.isCorrect } : {}), ...(reveal && q!.type === 'MATCHING' ? { matchKey: o.matchKey } : {}) })),
        matchTargets: q!.type === 'MATCHING' ? shuffle(left.map((o) => o.matchKey!)) : undefined,
        response: ans?.response ?? null,
        fileAssetId: ans?.fileAssetId ?? null,
        ...(done ? { isCorrect: ans?.isCorrect ?? null, pointsAwarded: ans?.pointsAwarded === null || ans?.pointsAwarded === undefined ? null : Number(ans.pointsAwarded), feedback: ans?.feedback ?? null } : {}),
        ...(reveal ? { explanation: q!.explanation, acceptedAnswers: q!.type === 'FILL_BLANK' ? ((q!.meta as { answers?: string[] })?.answers ?? []) : undefined } : {}),
      };
    });
    return {
      id: a.id, attemptNo: a.attemptNo, status: a.status, startedAt: a.startedAt, expiresAt: a.expiresAt, submittedAt: a.submittedAt,
      passPercent: a.quiz.passPercent, score: a.score === null ? null : Number(a.score), maxScore: a.maxScore === null ? null : Number(a.maxScore),
      percent: a.percent === null ? null : Number(a.percent), passed: a.passed, questions,
    };
  }

  async saveAnswer(userId: string, attemptId: string, dto: AnswerDto) {
    const a = await this.loadAttempt(userId, attemptId);
    if (a.status !== 'IN_PROGRESS') throw AppException.conflict('This attempt has been submitted.');
    if (a.expiresAt && a.expiresAt.getTime() + GRACE_MS < Date.now()) throw AppException.conflict('Time is up for this attempt.');
    if (!(a.questionOrder as string[]).includes(dto.questionId)) throw AppException.validation([{ field: 'questionId', message: 'Question is not part of this attempt' }]);
    if (dto.fileAssetId) {
      const f = await this.db.fileAsset.findFirst({ where: { id: dto.fileAssetId, ownerUserId: userId, status: 'READY', purpose: 'SUBMISSION' } });
      if (!f) throw AppException.validation([{ field: 'fileAssetId', message: 'File not found' }]);
    }
    const tenantId = this.ctx.requireTenantId();
    await this.db.quizAnswer.upsert({
      where: { tenantId_attemptId_questionId: { tenantId, attemptId, questionId: dto.questionId } },
      update: { response: (dto.response ?? null) as never, fileAssetId: dto.fileAssetId ?? null },
      create: { attemptId, questionId: dto.questionId, response: (dto.response ?? null) as never, fileAssetId: dto.fileAssetId ?? null } as never,
    });
    return { saved: true };
  }

  /** Grades auto questions; the attempt is GRADED once no manual grading is pending. */
  async submit(userId: string, attemptId: string) {
    const a = await this.loadAttempt(userId, attemptId);
    if (a.status !== 'IN_PROGRESS') return this.attempt(userId, attemptId);
    await this.finalize(a.id, a.quizId);
    const after = await this.db.quizAttempt.findUniqueOrThrow({ where: { id: a.id }, include: { quiz: true } });
    if (after.passed) await this.learning.complete(userId, a.quiz.lessonId, { system: true });
    return this.attempt(userId, attemptId);
  }

  private async finalize(attemptId: string, quizId: string) {
    const a = await this.db.quizAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { answers: true, quiz: true } });
    const qs = await this.db.quizQuestion.findMany({ where: { id: { in: a.questionOrder as string[] }, quizId }, include: { options: true } });
    const responses = Object.fromEntries(a.answers.map((x) => [x.questionId, x.response as Response]));
    const manual = Object.fromEntries(a.answers.filter((x) => x.gradedById).map((x) => [x.questionId, x.pointsAwarded === null ? null : Number(x.pointsAwarded)]));
    const result = scoreAttempt(this.gradable(qs), responses, Number(a.quiz.negativeMarkRatio), manual);
    const tenantId = this.ctx.requireTenantId();
    for (const q of qs) {
      if (MANUAL_TYPES.has(q.type) && manual[q.id] !== undefined) continue;
      const pq = result.perQuestion[q.id];
      await this.db.quizAnswer.upsert({
        where: { tenantId_attemptId_questionId: { tenantId, attemptId, questionId: q.id } },
        update: { isCorrect: pq.isCorrect, pointsAwarded: pq.points },
        create: { attemptId, questionId: q.id, isCorrect: pq.isCorrect, pointsAwarded: pq.points } as never,
      });
    }
    const graded = result.pendingManual === 0;
    await this.db.quizAttempt.update({
      where: { id: attemptId },
      data: { status: graded ? 'GRADED' : 'SUBMITTED', submittedAt: a.submittedAt ?? new Date(), score: result.score, maxScore: result.maxScore, percent: result.percent, passed: graded ? result.percent >= a.quiz.passPercent : null },
    });
  }

  /** Instructor view of a submitted attempt (answers + correct options). */
  async attemptForInstructor(attemptId: string) {
    const a = await this.db.quizAttempt.findFirst({ where: { id: attemptId } });
    if (!a) throw AppException.notFound('Attempt not found');
    const view = await this.attempt(a.userId, attemptId);
    const student = await this.prisma.user.findUnique({ where: { id: a.userId }, select: { fullName: true, email: true } });
    return { ...view, student };
  }

  /** Instructor grading of SHORT/LONG/FILE_UPLOAD answers; re-totals and may complete the lesson. */
  async grade(attemptId: string, dto: ManualGradeDto, graderId: string) {
    const a = await this.db.quizAttempt.findFirst({ where: { id: attemptId }, include: { quiz: true } });
    if (!a) throw AppException.notFound('Attempt not found');
    if (a.status === 'IN_PROGRESS') throw AppException.conflict('The student has not submitted this attempt yet.');
    const qs = await this.db.quizQuestion.findMany({ where: { id: { in: dto.grades.map((g) => g.questionId) }, quizId: a.quizId } });
    const tenantId = this.ctx.requireTenantId();
    for (const g of dto.grades) {
      const q = qs.find((x) => x.id === g.questionId);
      if (!q || !MANUAL_TYPES.has(q.type)) throw AppException.validation([{ field: 'questionId', message: 'Only open-ended questions can be graded manually' }]);
      if (g.points > Number(q.points)) throw AppException.validation([{ field: 'points', message: `Maximum ${Number(q.points)} points for this question` }]);
      await this.db.quizAnswer.upsert({
        where: { tenantId_attemptId_questionId: { tenantId, attemptId, questionId: q.id } },
        update: { pointsAwarded: g.points, isCorrect: g.points >= Number(q.points), feedback: g.feedback ?? null, gradedById: graderId },
        create: { attemptId, questionId: q.id, pointsAwarded: g.points, isCorrect: g.points >= Number(q.points), feedback: g.feedback ?? null, gradedById: graderId } as never,
      });
    }
    await this.finalize(attemptId, a.quizId);
    const after = await this.db.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (after.passed) {
      await this.ctx.run(tenantId, () => this.learning.complete(a.userId, a.quiz.lessonId, { system: true }));
    }
    return this.attempt(a.userId, attemptId);
  }
}
