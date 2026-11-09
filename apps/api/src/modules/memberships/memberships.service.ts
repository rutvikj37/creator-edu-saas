import { Inject, Injectable, Optional } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { emailTemplates } from '../../core/mail/templates.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { addInterval } from '../subscriptions/subscriptions.service.js';
import { academyOrigin } from '../tenants/academy-origin.js';
import { FilesService } from '../files/files.service.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { FEATURES } from '@ce/shared';

type Tx = Parameters<Parameters<TenantPrismaClient['$transaction']>[0]>[0];
const DAY = 86_400_000;
/** Access end used for unlimited (lifetime) plans. */
export const LIFETIME_END = new Date('2999-12-31T00:00:00Z');

export interface PlanInput {
  name?: string;
  description?: string | null;
  priceAmount?: number;
  currency?: string;
  interval?: 'MONTH' | 'YEAR';
  courseIds?: string[];
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  compareAtAmount?: number | null;
  planName?: string | null;
  coverFileId?: string | null;
  faqs?: { question: string; answer: string }[];
  buttonText?: string | null;
  lifetime?: boolean;
  taxExclusive?: boolean | null;
}

/**
 * Memberships: prepaid access to a bundle of courses (and member-only communities) for a month or
 * a year. Paying again extends from the current end. Enrolments granted by a membership carry the
 * membership's end date, so access ends automatically when it is not renewed.
 */
@Injectable()
export class MembershipsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
    /** Absent in the worker, which never builds cover URLs. */
    @Optional() private readonly files?: FilesService,
    @Optional() private readonly entitlements?: EntitlementsService,
  ) {}

  private view(p: any, extra: Record<string, unknown> = {}) {
    return {
      id: p.id, name: p.name, description: p.description, priceAmount: p.priceAmount.toString(), compareAtAmount: p.compareAtAmount?.toString() ?? null, currency: p.currency, interval: p.interval,
      courseIds: p.courseIds as string[], status: p.status, planName: p.planName ?? null, buttonText: p.buttonText ?? null, lifetime: Boolean(p.lifetime), taxExclusive: p.taxExclusive ?? null, coverFileId: p.coverFileId ?? null, faqs: (p.faqs as unknown[] | null) ?? [], createdAt: p.createdAt, ...extra,
    };
  }

  private async cover(p: { coverFileId?: string | null }, apiOrigin?: string) {
    return apiOrigin && this.files ? this.files.urlFor(p.coverFileId ?? null, apiOrigin, 86_400) : null;
  }

  /** A plan can go on sale once it has a price and at least one course. */
  private assertSellable(p: { priceAmount: unknown; courseIds: unknown }) {
    const errors = [];
    if (!(Number(p.priceAmount) >= 1)) errors.push({ field: 'priceAmount', message: 'Set a price before publishing' });
    if (!(p.courseIds as string[]).length) errors.push({ field: 'courseIds', message: 'Add at least one course before publishing' });
    if (errors.length) throw AppException.validation(errors);
  }

  private async validate(input: PlanInput, draft = false) {
    const errors: { field: string; message: string }[] = [];
    if (input.compareAtAmount && input.priceAmount !== undefined && input.compareAtAmount <= input.priceAmount) errors.push({ field: 'compareAtAmount', message: 'The original price must be higher than the sale price' });
    if (input.buttonText && input.buttonText.trim().length > 40) errors.push({ field: 'buttonText', message: 'Up to 40 characters' });
    if (input.planName && input.planName.trim().length > 100) errors.push({ field: 'planName', message: 'Up to 100 characters' });
    if (input.faqs && (input.faqs.length > 30 || input.faqs.some((f) => !f.question?.trim() || !f.answer?.trim()))) errors.push({ field: 'faqs', message: 'Up to 30 questions, each with an answer' });
    if (input.coverFileId && this.files) await this.files.assertUsable(input.coverFileId, ['IMAGE', 'COURSE_THUMBNAIL', 'COURSE_BANNER']).catch(() => errors.push({ field: 'coverFileId', message: 'Upload an image' }));
    if (input.name !== undefined && (!input.name.trim() || input.name.length > 120)) errors.push({ field: 'name', message: '1–120 characters' });
    if (input.priceAmount !== undefined && (input.priceAmount < 1 || input.priceAmount > 10_000_000)) errors.push({ field: 'priceAmount', message: 'Enter a price' });
    if (input.currency !== undefined && !/^[A-Z]{3}$/.test(input.currency)) errors.push({ field: 'currency', message: 'Invalid currency' });
    if (input.courseIds !== undefined) {
      const ids = [...new Set(input.courseIds)];
      if (!ids.length && !draft) errors.push({ field: 'courseIds', message: 'Include at least one course' });
      else if (!ids.length) { /* drafts may start empty */ }
      else if ((await this.db.course.count({ where: { id: { in: ids }, deletedAt: null } })) !== ids.length) errors.push({ field: 'courseIds', message: 'Some courses were not found' });
    }
    if (errors.length) throw AppException.validation(errors);
  }

  async list(apiOrigin?: string) {
    const plans = await this.db.membershipPlan.findMany({ orderBy: { createdAt: 'desc' } });
    const counts = await this.db.membership.groupBy({ by: ['planId'], where: { status: 'ACTIVE', currentPeriodEnd: { gt: new Date() } }, _count: { _all: true } });
    const revenue = await this.db.orderItem.groupBy({ by: ['membershipPlanId'], where: { membershipPlanId: { in: plans.map((p) => p.id) }, order: { status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } }, _sum: { totalAmount: true } });
    return Promise.all(plans.map(async (p) => this.view(p, {
      activeMembers: counts.find((c) => c.planId === p.id)?._count._all ?? 0,
      revenue: revenue.find((r) => r.membershipPlanId === p.id)?._sum.totalAmount?.toString() ?? '0',
      coverUrl: await this.cover(p, apiOrigin),
    })));
  }

  async get(id: string, apiOrigin?: string) {
    const p = await this.db.membershipPlan.findFirst({ where: { id } });
    if (!p) throw AppException.notFound('Plan not found');
    return this.view(p, { coverUrl: await this.cover(p, apiOrigin) });
  }

  /** Totals for the Memberships page header. */
  async stats() {
    const [members, revenue, t] = await Promise.all([
      this.db.membership.count({ where: { status: 'ACTIVE', currentPeriodEnd: { gt: new Date() } } }),
      this.db.orderItem.aggregate({ where: { membershipPlanId: { not: null }, order: { status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } }, _sum: { totalAmount: true } }),
      this.prisma.tenant.findUniqueOrThrow({ where: { id: this.ctx.requireTenantId() }, select: { defaultCurrency: true } }),
    ]);
    const tenantId = this.ctx.requireTenantId();
    const [biz, ent] = await Promise.all([
      this.prisma.tenantBusinessProfile.findUnique({ where: { tenantId }, select: { gstRegistered: true, taxRate: true, pricesIncludeTax: true } }),
      this.entitlements ? this.entitlements.get(tenantId) : null,
    ]);
    return {
      totalMembers: members, totalRevenue: revenue._sum.totalAmount?.toString() ?? '0', currency: t.defaultCurrency,
      // What the pricing step needs to show the effective price and what the academy receives.
      pricing: {
        gstRegistered: Boolean(biz?.gstRegistered), taxRate: biz?.gstRegistered ? Number(biz.taxRate) : 0, pricesIncludeTax: biz?.pricesIncludeTax ?? true,
        commissionPercent: ent?.features[FEATURES.COMMISSION_PERCENT.key]?.limit ?? 0,
      },
    };
  }

  /**
   * Creates a plan. With price, interval and courses it goes on sale at once (as before); with just a
   * name it starts as a DRAFT that the builder fills in step by step and publishes.
   */
  async create(input: PlanInput & { name: string }, actorUserId: string, apiOrigin?: string) {
    const draft = input.priceAmount === undefined || input.courseIds === undefined || input.status === 'DRAFT';
    await this.validate({ courseIds: [], ...input }, draft);
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: this.ctx.requireTenantId() }, select: { defaultCurrency: true } });
    const p = await this.db.membershipPlan.create({
      data: {
        name: input.name.trim(), description: input.description?.trim() || null, priceAmount: input.priceAmount ?? 0, compareAtAmount: input.compareAtAmount ?? null, currency: input.currency ?? t.defaultCurrency,
        interval: input.interval ?? 'MONTH', courseIds: [...new Set(input.courseIds ?? [])], planName: input.planName?.trim() || null, coverFileId: input.coverFileId ?? null,
        faqs: (input.faqs ?? []).map((f) => ({ question: f.question.trim(), answer: f.answer.trim() })), status: draft ? 'DRAFT' : 'ACTIVE', createdById: actorUserId,
        buttonText: input.buttonText?.trim() || null, lifetime: input.lifetime ?? false, taxExclusive: input.taxExclusive ?? null,
      } as never,
    });
    await this.audit.record({ action: 'membership.plan_create', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'MembershipPlan', targetId: p.id });
    return this.view(p, { coverUrl: await this.cover(p, apiOrigin) });
  }

  async update(id: string, input: PlanInput, actorUserId: string, apiOrigin?: string) {
    const p = await this.db.membershipPlan.findFirst({ where: { id } });
    if (!p) throw AppException.notFound('Plan not found');
    const nextStatus = input.status ?? p.status;
    await this.validate({ ...input, ...(input.compareAtAmount && input.priceAmount === undefined ? { priceAmount: Number(p.priceAmount) } : {}) }, nextStatus === 'DRAFT');
    if (nextStatus === 'ACTIVE') this.assertSellable({ priceAmount: input.priceAmount ?? p.priceAmount, courseIds: input.courseIds ?? p.courseIds });
    // Price/interval changes apply to future purchases; current members keep what they paid for.
    const u = await this.db.membershipPlan.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.priceAmount !== undefined ? { priceAmount: input.priceAmount } : {}),
        ...(input.interval !== undefined ? { interval: input.interval } : {}),
        ...(input.courseIds !== undefined ? { courseIds: [...new Set(input.courseIds)] } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.compareAtAmount !== undefined ? { compareAtAmount: input.compareAtAmount } : {}),
        ...(input.planName !== undefined ? { planName: input.planName?.trim() || null } : {}),
        ...(input.coverFileId !== undefined ? { coverFileId: input.coverFileId } : {}),
        ...(input.faqs !== undefined ? { faqs: input.faqs.map((f) => ({ question: f.question.trim(), answer: f.answer.trim() })) } : {}),
        ...(input.buttonText !== undefined ? { buttonText: input.buttonText?.trim() || null } : {}),
        ...(input.lifetime !== undefined ? { lifetime: input.lifetime } : {}),
        ...(input.taxExclusive !== undefined ? { taxExclusive: input.taxExclusive } : {}),
      },
    });
    await this.audit.record({ action: 'membership.plan_update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'MembershipPlan', targetId: id, after: input as never });
    return this.view(u, { coverUrl: await this.cover(u, apiOrigin) });
  }

  async members(planId: string) {
    const rows = await this.db.membership.findMany({ where: { planId }, orderBy: { currentPeriodEnd: 'desc' } });
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, fullName: true, email: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((m) => ({ id: m.id, user: byId.get(m.userId) ?? null, status: m.currentPeriodEnd <= new Date() && m.status === 'ACTIVE' ? 'EXPIRED' : m.status, startedAt: m.startedAt, currentPeriodEnd: m.currentPeriodEnd }));
  }

  // ── public & student ──────────────────────────────────────
  async publicPlans(apiOrigin?: string) {
    const plans = await this.db.membershipPlan.findMany({ where: { status: 'ACTIVE' }, orderBy: { priceAmount: 'asc' } });
    const courseIds = [...new Set(plans.flatMap((p) => p.courseIds as string[]))];
    const courses = await this.db.course.findMany({ where: { id: { in: courseIds }, status: 'PUBLISHED', deletedAt: null }, select: { id: true, title: true, slug: true } });
    return Promise.all(plans.map(async (p) => this.view(p, { courses: (p.courseIds as string[]).map((id) => courses.find((c) => c.id === id)).filter(Boolean), coverUrl: await this.cover(p, apiOrigin) })));
  }

  async mine(userId: string) {
    const rows = await this.db.membership.findMany({ where: { userId }, include: { plan: true }, orderBy: { currentPeriodEnd: 'desc' } });
    return rows.map((m) => ({ id: m.id, plan: this.view(m.plan), active: m.status === 'ACTIVE' && m.currentPeriodEnd > new Date(), status: m.status, currentPeriodEnd: m.currentPeriodEnd, startedAt: m.startedAt }));
  }

  /** Sellable plan for checkout. */
  async sellable(planId: string) {
    const p = await this.db.membershipPlan.findFirst({ where: { id: planId, status: 'ACTIVE' } });
    if (!p) throw AppException.notFound('Membership plan not found');
    return p;
  }

  // ── fulfilment (inside the order transaction) ─────────────
  async applyPurchase(tx: Tx, userId: string, planId: string, orderId: string, now: Date) {
    const plan = await tx.membershipPlan.findFirstOrThrow({ where: { id: planId } });
    const existing = await tx.membership.findFirst({ where: { userId, planId } });
    const from = existing && existing.status === 'ACTIVE' && existing.currentPeriodEnd > now ? existing.currentPeriodEnd : now;
    const end = plan.lifetime ? LIFETIME_END : addInterval(from, plan.interval);
    if (existing) await tx.membership.update({ where: { id: existing.id }, data: { status: 'ACTIVE', currentPeriodEnd: end, lastOrderId: orderId, reminderSentFor: null, ...(from === now ? { startedAt: now } : {}) } });
    else await tx.membership.create({ data: { userId, planId, startedAt: now, currentPeriodEnd: end, lastOrderId: orderId } as never });
    for (const courseId of plan.courseIds as string[]) {
      const e = await tx.enrollment.findFirst({ where: { userId, courseId } });
      // Never shorten access the student already has (e.g. a lifetime purchase).
      if (e && e.status === 'ACTIVE' && (e.expiresAt === null || e.expiresAt >= end) && e.source !== 'MEMBERSHIP') continue;
      const expiresAt = plan.lifetime ? null : end;
      if (e) await tx.enrollment.update({ where: { id: e.id }, data: { status: 'ACTIVE', expiresAt, source: e.source === 'MEMBERSHIP' || !(e.status === 'ACTIVE') ? 'MEMBERSHIP' : e.source } });
      else await tx.enrollment.create({ data: { userId, courseId, source: 'MEMBERSHIP', expiresAt } as never });
    }
    return end;
  }

  /** Full refund with access removal: the membership ends now and its enrolments are revoked. */
  async revokeForRefund(tx: Tx, userId: string, planId: string) {
    const plan = await tx.membershipPlan.findFirst({ where: { id: planId } });
    await tx.membership.updateMany({ where: { userId, planId }, data: { status: 'CANCELLED', currentPeriodEnd: new Date() } });
    if (plan) await tx.enrollment.updateMany({ where: { userId, courseId: { in: plan.courseIds as string[] }, source: 'MEMBERSHIP' }, data: { status: 'REVOKED' } });
  }

  // ── renewal reminders and expiry (worker) ─────────────────
  async maintain(now = new Date()) {
    const soon = await this.prisma.membership.findMany({ where: { status: 'ACTIVE', currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + 7 * DAY) } }, include: { plan: true }, take: 1000 });
    let reminded = 0;
    for (const m of soon) {
      if (m.reminderSentFor && m.reminderSentFor.getTime() === m.currentPeriodEnd.getTime()) continue;
      const user = await this.prisma.user.findUnique({ where: { id: m.userId }, select: { email: true, fullName: true } });
      if (!user) continue;
      const { origin, name } = await academyOrigin(this.prisma, this.config, m.tenantId);
      await this.mail.send({
        to: user.email, tenantId: m.tenantId, tag: 'membership-renewal',
        ...emailTemplates.billingNotice({ brand: name, subject: `Your ${m.plan.name} membership ends soon`, heading: 'Keep your access', lines: [`Hi ${user.fullName},`, `Your ${m.plan.name} membership ends on ${m.currentPeriodEnd.toISOString().slice(0, 10)}. Renew to keep access to its courses.`], cta: { label: 'Renew membership', url: `${origin}/memberships` } }),
      });
      await this.prisma.membership.update({ where: { id: m.id }, data: { reminderSentFor: m.currentPeriodEnd } });
      reminded++;
    }
    const expired = await this.prisma.membership.updateMany({ where: { status: 'ACTIVE', currentPeriodEnd: { lte: now } }, data: { status: 'EXPIRED' } });
    return { reminded, expired: expired.count };
  }
}
