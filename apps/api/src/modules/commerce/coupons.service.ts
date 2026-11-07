import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AppException } from '../../common/errors/app-exception.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { toMinor } from './providers/money.js';
import type { CouponRule } from './pricing.js';

export interface CouponInput {
  code?: string;
  description?: string | null;
  type?: 'PERCENT' | 'FIXED';
  value?: number;
  maxRedemptions?: number | null;
  perUserLimit?: number;
  minOrderAmount?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  courseIds?: string[] | null;
  isActive?: boolean;
  maxDiscountAmount?: number | null;
  showAtCheckout?: boolean;
}

/** Unambiguous characters only (no 0/O, 1/I/L). */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const randomCode = (length = 8) => Array.from({ length }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');

const invalid = (message: string) => AppException.validation([{ field: 'couponCode', message }], message);

@Injectable()
export class CouponsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly audit: AuditService,
    private readonly ctx: TenantContext,
  ) {}

  private view(c: any) {
    return {
      ...c, value: c.value.toString(), minOrderAmount: c.minOrderAmount?.toString() ?? null, maxDiscountAmount: c.maxDiscountAmount?.toString() ?? null, courseIds: (c.courseIds as string[] | null) ?? null,
      state: !c.isActive ? 'DISABLED' : c.endsAt && c.endsAt < new Date() ? 'EXPIRED' : c.startsAt && c.startsAt > new Date() ? 'SCHEDULED' : c.maxRedemptions !== null && c.redemptionCount >= c.maxRedemptions ? 'EXHAUSTED' : 'ACTIVE',
    };
  }

  async list(q?: string) {
    const rows = await this.db.coupon.findMany({ where: { deletedAt: null, ...(q ? { code: { contains: q.toUpperCase() } } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
    return rows.map((c) => this.view(c));
  }

  private async validate(input: CouponInput, current?: { type: string; value: unknown; startsAt: Date | null; endsAt: Date | null }) {
    const errors: { field: string; message: string }[] = [];
    const type = input.type ?? current?.type;
    const value = input.value ?? (current ? Number(current.value) : undefined);
    if (type === 'PERCENT' && (value === undefined || value <= 0 || value > 100)) errors.push({ field: 'value', message: 'Percent must be between 1 and 100' });
    if (type === 'FIXED' && (value === undefined || value <= 0)) errors.push({ field: 'value', message: 'Enter an amount above zero' });
    const starts = input.startsAt !== undefined ? (input.startsAt ? new Date(input.startsAt) : null) : (current?.startsAt ?? null);
    const ends = input.endsAt !== undefined ? (input.endsAt ? new Date(input.endsAt) : null) : (current?.endsAt ?? null);
    if (starts && ends && ends <= starts) errors.push({ field: 'endsAt', message: 'End must be after the start' });
    if (input.maxDiscountAmount != null && type !== 'PERCENT') errors.push({ field: 'maxDiscountAmount', message: 'A maximum discount only applies to percentage coupons' });
    if (input.courseIds?.length) {
      const found = await this.db.course.count({ where: { id: { in: input.courseIds }, deletedAt: null } });
      if (found !== new Set(input.courseIds).size) errors.push({ field: 'courseIds', message: 'Some courses were not found' });
    }
    if (errors.length) throw AppException.validation(errors);
  }

  private data(input: CouponInput) {
    return {
      ...(input.code !== undefined ? { code: input.code.trim().toUpperCase() } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.maxRedemptions !== undefined ? { maxRedemptions: input.maxRedemptions } : {}),
      ...(input.perUserLimit !== undefined ? { perUserLimit: input.perUserLimit } : {}),
      ...(input.minOrderAmount !== undefined ? { minOrderAmount: input.minOrderAmount } : {}),
      ...(input.startsAt !== undefined ? { startsAt: input.startsAt ? new Date(input.startsAt) : null } : {}),
      ...(input.endsAt !== undefined ? { endsAt: input.endsAt ? new Date(input.endsAt) : null } : {}),
      ...(input.courseIds !== undefined ? { courseIds: input.courseIds?.length ? [...new Set(input.courseIds)] : null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.maxDiscountAmount !== undefined ? { maxDiscountAmount: input.maxDiscountAmount } : {}),
      ...(input.type === 'FIXED' ? { maxDiscountAmount: null } : {}),
      ...(input.showAtCheckout !== undefined ? { showAtCheckout: input.showAtCheckout } : {}),
    } as Record<string, unknown>;
  }

  /** Leave `code` empty to get a random, unused 8-character code. */
  async create(input: Required<Pick<CouponInput, 'type' | 'value'>> & CouponInput, actorUserId: string) {
    await this.validate(input);
    let code = input.code?.trim().toUpperCase();
    if (code) {
      if (await this.db.coupon.findFirst({ where: { code } })) throw AppException.validation([{ field: 'code', message: 'A coupon with this code already exists' }]);
    } else {
      do code = randomCode(); while (await this.db.coupon.findFirst({ where: { code } }));
    }
    const c = await this.db.coupon.create({ data: { ...this.data({ ...input, code }), createdById: actorUserId } as never });
    await this.audit.record({ action: 'coupon.create', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Coupon', targetId: c.id, after: { code, type: input.type, value: input.value } });
    return this.view(c);
  }

  async update(id: string, input: CouponInput, actorUserId: string) {
    const c = await this.db.coupon.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw AppException.notFound('Coupon not found');
    // Codes and discount terms are fixed once used, so past orders stay explainable.
    if (c.redemptionCount > 0 && (input.code !== undefined || input.type !== undefined || input.value !== undefined)) {
      throw AppException.conflict('This coupon has been used; create a new coupon to change its code or discount.');
    }
    await this.validate(input, c);
    if (input.code && input.code.trim().toUpperCase() !== c.code && (await this.db.coupon.findFirst({ where: { code: input.code.trim().toUpperCase() } }))) {
      throw AppException.validation([{ field: 'code', message: 'A coupon with this code already exists' }]);
    }
    const u = await this.db.coupon.update({ where: { id }, data: this.data(input) as never });
    await this.audit.record({ action: 'coupon.update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Coupon', targetId: id, after: input as never });
    return this.view(u);
  }

  async remove(id: string, actorUserId: string) {
    const c = await this.db.coupon.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw AppException.notFound('Coupon not found');
    // Soft delete keeps redemption history; the code becomes reusable.
    await this.db.coupon.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, code: `${c.code.slice(0, 26)}~${Date.now().toString(36)}` } });
    await this.audit.record({ action: 'coupon.delete', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Coupon', targetId: id, before: { code: c.code } });
    return { deleted: true };
  }

  /** Checks a code for this buyer and course. Throws a VALIDATION_FAILED on `couponCode` with a buyer-friendly reason. */
  async evaluate(code: string, courseId: string, userId: string, subtotalMinor: number, currency: string): Promise<{ id: string; code: string; rule: CouponRule }> {
    return this.evaluateLines(code, [{ kind: 'course', id: courseId, unitMinor: subtotalMinor }], userId, currency);
  }

  /**
   * Checks a coupon against a cart. Coupons limited to courses apply to those course lines only
   * (bundles and memberships take unrestricted coupons); at least one line must be eligible.
   */
  async evaluateLines(code: string, lines: { kind: string; id: string; unitMinor: number }[], userId: string, currency: string): Promise<{ id: string; code: string; rule: CouponRule; eligible: boolean[] }> {
    const c = await this.db.coupon.findFirst({ where: { code: code.trim().toUpperCase(), deletedAt: null } });
    const now = new Date();
    if (!c || !c.isActive) throw invalid('This coupon code is not valid');
    if (c.startsAt && c.startsAt > now) throw invalid('This coupon is not active yet');
    if (c.endsAt && c.endsAt <= now) throw invalid('This coupon has expired');
    if (c.maxRedemptions !== null && c.redemptionCount >= c.maxRedemptions) throw invalid('This coupon has been fully used');
    const ids = c.courseIds as string[] | null;
    const eligible = lines.map((l) => !ids?.length || (l.kind === 'course' && ids.includes(l.id)));
    if (!eligible.some(Boolean)) throw invalid(lines.length > 1 ? 'This coupon does not apply to these items' : 'This coupon does not apply to this course');
    const subtotalMinor = lines.reduce((s2, l) => s2 + l.unitMinor, 0);
    if (c.minOrderAmount && subtotalMinor < toMinor(c.minOrderAmount, currency)) throw invalid('Order total is below this coupon’s minimum');
    const used = await this.db.couponRedemption.count({ where: { couponId: c.id, userId } });
    if (used >= c.perUserLimit) throw invalid('You have already used this coupon');
    return { id: c.id, code: c.code, rule: { type: c.type, value: c.type === 'PERCENT' ? Number(c.value) : toMinor(c.value, currency), maxMinor: c.type === 'PERCENT' && c.maxDiscountAmount ? toMinor(c.maxDiscountAmount, currency) : null }, eligible };
  }

  /**
   * Coupons the creator chose to offer on the checkout page for this course: active, in date,
   * not used up, and either unrestricted or limited to this course.
   */
  async offers(courseId: string | null) {
    const now = new Date();
    const rows = await this.db.coupon.findMany({
      where: { deletedAt: null, isActive: true, showAtCheckout: true, OR: [{ startsAt: null }, { startsAt: { lte: now } }], AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] },
      orderBy: { createdAt: 'desc' }, take: 20,
    });
    return rows
      .filter((c) => (c.maxRedemptions === null || c.redemptionCount < c.maxRedemptions) && (!(c.courseIds as string[] | null)?.length || (courseId && (c.courseIds as string[]).includes(courseId))))
      .slice(0, 5)
      .map((c) => ({ code: c.code, type: c.type, value: c.value.toString(), maxDiscountAmount: c.maxDiscountAmount?.toString() ?? null, minOrderAmount: c.minOrderAmount?.toString() ?? null, description: c.description, endsAt: c.endsAt }));
  }
}
