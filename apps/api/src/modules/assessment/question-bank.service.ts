import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AppException } from '../../common/errors/app-exception.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import type { QuestionDto } from './dto.js';
import { MANUAL_TYPES } from './grading.js';
import { QuizzesService, validateQuestion } from './quizzes.service.js';

export interface BankQuestionInput extends QuestionDto {
  tags?: string[];
}

const MAX_TAGS = 10;
const normTags = (tags?: string[]) => [...new Set((tags ?? []).map((t) => t.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40)).filter(Boolean))].slice(0, MAX_TAGS);
const keepOptions = (dto: QuestionDto) => (MANUAL_TYPES.has(dto.type) || dto.type === 'FILL_BLANK' ? [] : (dto.options ?? []).map((o) => ({ label: o.label, isCorrect: Boolean(o.isCorrect), matchKey: o.matchKey ?? null })));

/**
 * Academy-wide question bank. Questions are written once and copied into quizzes (picked or drawn
 * at random by tag); copies are independent, so editing or deleting a bank question never changes
 * a quiz students have taken. Any quiz question can be saved back to the bank.
 */
@Injectable()
export class QuestionBankService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly quizzes: QuizzesService,
    private readonly audit: AuditService,
  ) {}

  private view(q: { id: string; type: string; prompt: string; explanation: string | null; points: unknown; options: unknown; meta: unknown; tags: unknown; createdAt: Date; updatedAt: Date }, used = 0) {
    return { id: q.id, type: q.type, prompt: q.prompt, explanation: q.explanation, points: Number(q.points), options: (q.options as unknown[]) ?? [], meta: q.meta ?? null, tags: (q.tags as string[]) ?? [], usedInQuizzes: used, createdAt: q.createdAt, updatedAt: q.updatedAt };
  }

  private async usage(ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const rows = await this.db.quizQuestion.groupBy({ by: ['bankQuestionId'], where: { bankQuestionId: { in: ids } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.bankQuestionId!, r._count._all]));
  }

  async list(params: { q?: string; tag?: string; type?: string; page?: number }) {
    const page = Math.max(1, Number(params.page) || 1);
    const where = {
      deletedAt: null,
      ...(params.q ? { prompt: { contains: params.q.slice(0, 100) } } : {}),
      ...(params.tag ? { tags: { array_contains: params.tag.trim().toLowerCase() } } : {}),
      ...(params.type ? { type: params.type as never } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.bankQuestion.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 25, take: 25 }),
      this.db.bankQuestion.count({ where }),
    ]);
    const used = await this.usage(rows.map((r) => r.id));
    return { items: rows.map((r) => this.view(r, used.get(r.id) ?? 0)), total, page, pages: Math.max(1, Math.ceil(total / 25)) };
  }

  /** Every tag with how many questions carry it. */
  async tags() {
    const rows = await this.db.bankQuestion.findMany({ where: { deletedAt: null }, select: { tags: true }, take: 10_000 });
    const counts = new Map<string, number>();
    for (const r of rows) for (const t of (r.tags as string[]) ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
  }

  private async find(id: string) {
    const q = await this.db.bankQuestion.findFirst({ where: { id, deletedAt: null } });
    if (!q) throw AppException.notFound('Question not found');
    return q;
  }

  async create(dto: BankQuestionInput, actorUserId: string) {
    const errors = validateQuestion(dto);
    if (errors.length) throw AppException.validation(errors);
    const q = await this.db.bankQuestion.create({
      data: { type: dto.type, prompt: dto.prompt, explanation: dto.explanation ?? null, points: dto.points ?? 1, options: keepOptions(dto) as never, meta: dto.type === 'FILL_BLANK' ? (dto.meta as never) : undefined, tags: normTags(dto.tags) as never, createdById: actorUserId } as never,
    });
    return this.view(q);
  }

  async update(id: string, dto: BankQuestionInput) {
    await this.find(id);
    const errors = validateQuestion(dto);
    if (errors.length) throw AppException.validation(errors);
    const q = await this.db.bankQuestion.update({
      where: { id },
      data: { type: dto.type, prompt: dto.prompt, explanation: dto.explanation ?? null, points: dto.points ?? 1, options: keepOptions(dto) as never, meta: dto.type === 'FILL_BLANK' ? (dto.meta as never) : (null as never), tags: normTags(dto.tags) as never },
    });
    return this.view(q, (await this.usage([id])).get(id) ?? 0);
  }

  async remove(id: string, actorUserId: string) {
    await this.find(id);
    await this.db.bankQuestion.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ action: 'question_bank.delete', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'BankQuestion', targetId: id });
    return { deleted: true };
  }

  /**
   * Copies bank questions into a quiz: the chosen ids, or `count` questions drawn at random from a
   * tag. Questions already copied into this quiz are skipped.
   */
  async addToQuiz(courseId: string, lessonId: string, input: { questionIds?: string[]; tag?: string; count?: number }) {
    const quiz = await this.quizzes.forLesson(courseId, lessonId);
    const already = new Set(quiz.questions.map((q) => q.bankQuestionId).filter(Boolean));
    let picked: Awaited<ReturnType<typeof this.db.bankQuestion.findMany>>;
    if (input.questionIds?.length) {
      const ids = [...new Set(input.questionIds)];
      const found = await this.db.bankQuestion.findMany({ where: { id: { in: ids }, deletedAt: null } });
      if (found.length !== ids.length) throw AppException.validation([{ field: 'questionIds', message: 'Some questions were not found in your bank' }]);
      picked = ids.map((id) => found.find((q) => q.id === id)!);
    } else if (input.tag && input.count) {
      const pool = (await this.db.bankQuestion.findMany({ where: { deletedAt: null, tags: { array_contains: input.tag.trim().toLowerCase() } } })).filter((q) => !already.has(q.id));
      if (pool.length < input.count) throw AppException.validation([{ field: 'count', message: `Only ${pool.length} unused question${pool.length === 1 ? '' : 's'} tagged “${input.tag}”` }]);
      for (let i = pool.length - 1; i > 0; i--) { const j = randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      picked = pool.slice(0, input.count);
    } else {
      throw AppException.validation([{ field: 'questionIds', message: 'Choose questions, or a tag and how many to draw' }]);
    }
    const toAdd = picked.filter((q) => !already.has(q.id));
    const tenantId = this.ctx.requireTenantId();
    let position = quiz.questions.length;
    for (const b of toAdd) {
      const q = await this.db.quizQuestion.create({ data: { quizId: quiz.id, type: b.type, prompt: b.prompt, explanation: b.explanation, points: b.points, position: position++, meta: (b.meta ?? undefined) as never, bankQuestionId: b.id } as never });
      const opts = (b.options as { label: string; isCorrect: boolean; matchKey: string | null }[] | null) ?? [];
      if (opts.length) await this.prisma.quizOption.createMany({ data: opts.map((o, i) => ({ tenantId, questionId: q.id, label: o.label, isCorrect: o.isCorrect, matchKey: o.matchKey ?? null, position: i })) });
    }
    return { added: toAdd.length, skipped: picked.length - toAdd.length, quiz: await this.quizzes.forLesson(courseId, lessonId) };
  }

  /** Saves a quiz question into the bank (a copy). */
  async saveFromQuiz(courseId: string, lessonId: string, questionId: string, tags: string[] | undefined, actorUserId: string) {
    const quiz = await this.quizzes.forLesson(courseId, lessonId);
    const q = quiz.questions.find((x) => x.id === questionId);
    if (!q) throw AppException.notFound('Question not found');
    const b = await this.db.bankQuestion.create({
      data: { type: q.type, prompt: q.prompt, explanation: q.explanation, points: q.points, options: q.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect, matchKey: o.matchKey })) as never, meta: (q.meta ?? undefined) as never, tags: normTags(tags) as never, createdById: actorUserId } as never,
    });
    await this.db.quizQuestion.update({ where: { id: q.id }, data: { bankQuestionId: b.id } });
    return this.view(b, 1);
  }
}
