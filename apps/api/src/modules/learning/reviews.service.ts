import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { isEnrollmentUsable } from './access.js';

export interface ReviewInput {
  rating: number;
  title?: string | null;
  body?: string | null;
}

/** Public display name: first name and last initial (no full names or emails on public pages). */
export const publicName = (full: string | null | undefined) => {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Student';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
};

/**
 * Course ratings and reviews. Only students with access to the course can review it (one review
 * each, editable); only published reviews count towards the average. The academy can reply and
 * hide abusive reviews (with a reason the author sees), but cannot edit what students wrote.
 */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly audit: AuditService,
  ) {}

  /** Average, count and distribution of published ratings for each course id. */
  async summaries(courseIds: string[]) {
    const out = new Map<string, { average: number | null; count: number; distribution: Record<1 | 2 | 3 | 4 | 5, number> }>();
    for (const id of courseIds) out.set(id, { average: null, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
    if (!courseIds.length) return out;
    const rows = await this.db.courseReview.groupBy({ by: ['courseId', 'rating'], where: { courseId: { in: courseIds }, status: 'PUBLISHED' }, _count: { _all: true } });
    for (const r of rows) {
      const s = out.get(r.courseId)!;
      s.distribution[r.rating as 1 | 2 | 3 | 4 | 5] = r._count._all;
      s.count += r._count._all;
    }
    for (const s of out.values()) {
      if (s.count) s.average = Math.round((Object.entries(s.distribution).reduce((a, [k, n]) => a + Number(k) * n, 0) / s.count) * 10) / 10;
    }
    return out;
  }

  // ── student ───────────────────────────────────────────────
  private async assertCanReview(userId: string, courseId: string) {
    const course = await this.db.course.findFirst({ where: { id: courseId, deletedAt: null } });
    if (!course) throw AppException.notFound('Course not found');
    const e = await this.db.enrollment.findFirst({ where: { userId, courseId } });
    if (!isEnrollmentUsable(e)) throw AppException.forbidden('Only students with access to this course can review it.');
    return course;
  }

  async mine(userId: string, courseId: string) {
    const r = await this.db.courseReview.findFirst({ where: { courseId, userId } });
    return r ? this.ownView(r) : null;
  }

  async upsert(userId: string, courseId: string, input: ReviewInput) {
    await this.assertCanReview(userId, courseId);
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw AppException.validation([{ field: 'rating', message: 'Choose 1 to 5 stars' }]);
    const data = { rating: input.rating, title: input.title?.trim() || null, body: input.body?.trim() || null };
    const existing = await this.db.courseReview.findFirst({ where: { courseId, userId } });
    // Editing a hidden review keeps it hidden: the academy decides whether it comes back.
    const r = existing
      ? await this.db.courseReview.update({ where: { id: existing.id }, data })
      : await this.db.courseReview.create({ data: { courseId, userId, ...data } as never });
    return this.ownView(r);
  }

  async remove(userId: string, courseId: string) {
    await this.db.courseReview.deleteMany({ where: { courseId, userId } });
    return { deleted: true };
  }

  private ownView(r: { id: string; rating: number; title: string | null; body: string | null; status: string; hiddenReason: string | null; reply: string | null; repliedAt: Date | null; createdAt: Date; updatedAt: Date }) {
    return { id: r.id, rating: r.rating, title: r.title, body: r.body, status: r.status, hiddenReason: r.status === 'HIDDEN' ? r.hiddenReason : null, reply: r.reply, repliedAt: r.repliedAt, createdAt: r.createdAt, updatedAt: r.updatedAt };
  }

  // ── public ────────────────────────────────────────────────
  async publicList(courseSlug: string, params: { page?: number; rating?: number }) {
    const course = await this.db.course.findFirst({ where: { slug: courseSlug, status: 'PUBLISHED', visibility: { in: ['PUBLIC', 'UNLISTED'] }, deletedAt: null }, select: { id: true } });
    if (!course) throw AppException.notFound('Course not found');
    const page = Math.max(1, Math.min(100, Number(params.page) || 1));
    const where = { courseId: course.id, status: 'PUBLISHED' as const, ...(params.rating && params.rating >= 1 && params.rating <= 5 ? { rating: Number(params.rating) } : {}) };
    const [rows, total, summary] = await Promise.all([
      this.db.courseReview.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 10, take: 10 }),
      this.db.courseReview.count({ where }),
      this.summaries([course.id]),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, fullName: true } });
    return {
      summary: summary.get(course.id),
      items: rows.map((r) => ({ id: r.id, rating: r.rating, title: r.title, body: r.body, author: publicName(users.find((u) => u.id === r.userId)?.fullName), reply: r.reply, repliedAt: r.repliedAt, createdAt: r.createdAt, edited: r.updatedAt.getTime() - r.createdAt.getTime() > 60_000 })),
      page, total, pages: Math.max(1, Math.ceil(total / 10)),
    };
  }

  // ── creator ───────────────────────────────────────────────
  async list(params: { courseId?: string; status?: string; rating?: number; page?: number }) {
    const page = Math.max(1, Number(params.page) || 1);
    const where = {
      ...(params.courseId ? { courseId: params.courseId } : {}),
      ...(params.status === 'PUBLISHED' || params.status === 'HIDDEN' ? { status: params.status as 'PUBLISHED' | 'HIDDEN' } : {}),
      ...(params.rating ? { rating: Number(params.rating) } : {}),
      ...(params.status === 'UNANSWERED' ? { reply: null } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.courseReview.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 20, take: 20 }),
      this.db.courseReview.count({ where }),
    ]);
    const [users, courses] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, fullName: true, email: true } }),
      this.db.course.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.courseId))] } }, select: { id: true, title: true, slug: true } }),
    ]);
    const overall = await this.db.courseReview.aggregate({ where: { status: 'PUBLISHED', ...(params.courseId ? { courseId: params.courseId } : {}) }, _avg: { rating: true }, _count: { _all: true } });
    return {
      items: rows.map((r) => {
        const u = users.find((x) => x.id === r.userId);
        const c = courses.find((x) => x.id === r.courseId);
        return { ...this.ownView(r), hiddenReason: r.hiddenReason, course: c ? { id: c.id, title: c.title, slug: c.slug } : null, student: { id: r.userId, name: u?.fullName ?? 'Student', email: u?.email ?? null } };
      }),
      total, page, pages: Math.max(1, Math.ceil(total / 20)),
      average: overall._avg.rating === null ? null : Math.round(overall._avg.rating * 10) / 10, publishedCount: overall._count._all,
    };
  }

  private async find(id: string) {
    const r = await this.db.courseReview.findFirst({ where: { id } });
    if (!r) throw AppException.notFound('Review not found');
    return r;
  }

  async reply(id: string, reply: string | null, actorUserId: string) {
    const r = await this.find(id);
    const text = reply?.trim() || null;
    const u = await this.db.courseReview.update({ where: { id: r.id }, data: { reply: text, repliedAt: text ? new Date() : null, repliedById: text ? actorUserId : null } });
    await this.audit.record({ action: 'review.reply', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'CourseReview', targetId: r.id });
    return this.ownView(u);
  }

  async setStatus(id: string, status: 'PUBLISHED' | 'HIDDEN', reason: string | null, actorUserId: string) {
    const r = await this.find(id);
    if (status === 'HIDDEN' && !reason?.trim()) throw AppException.validation([{ field: 'reason', message: 'Tell the student why it is hidden' }]);
    const u = await this.db.courseReview.update({ where: { id: r.id }, data: { status, hiddenReason: status === 'HIDDEN' ? reason!.trim().slice(0, 200) : null } });
    await this.audit.record({ action: status === 'HIDDEN' ? 'review.hide' : 'review.show', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'CourseReview', targetId: r.id, after: { reason } });
    return { ...this.ownView(u), hiddenReason: u.hiddenReason };
  }
}
