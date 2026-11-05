import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AppException } from '../../common/errors/app-exception.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { fromMinor, toMinor } from '../commerce/providers/money.js';

type Tx = Parameters<Parameters<TenantPrismaClient['$transaction']>[0]>[0];
const DAY = 86_400_000;

/**
 * Affiliate program: students share ?ref=CODE links; paid orders through a link earn a commission
 * on the net sale (excluding GST) that is held for the refund window, then approved and paid
 * out by the creator. Refunds reduce or reverse commissions.
 */
@Injectable()
export class AffiliatesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly audit: AuditService,
  ) {}

  // ── program (creator) ─────────────────────────────────────
  async program() {
    const p = await this.db.affiliateProgram.findFirst({});
    return p ? { ...p, defaultPercent: Number(p.defaultPercent) } : { enabled: false, defaultPercent: 20, cookieDays: 30, holdDays: 7, autoApprove: false, terms: null };
  }

  async saveProgram(input: { enabled?: boolean; defaultPercent?: number; cookieDays?: number; holdDays?: number; autoApprove?: boolean; terms?: string | null }, actorUserId: string) {
    const errors: { field: string; message: string }[] = [];
    if (input.defaultPercent !== undefined && (input.defaultPercent < 1 || input.defaultPercent > 90)) errors.push({ field: 'defaultPercent', message: '1–90%' });
    if (input.cookieDays !== undefined && (input.cookieDays < 1 || input.cookieDays > 365)) errors.push({ field: 'cookieDays', message: '1–365 days' });
    if (input.holdDays !== undefined && (input.holdDays < 0 || input.holdDays > 90)) errors.push({ field: 'holdDays', message: '0–90 days' });
    if (errors.length) throw AppException.validation(errors);
    const existing = await this.db.affiliateProgram.findFirst({});
    const data = { ...input, terms: input.terms === undefined ? undefined : input.terms?.trim() || null };
    if (existing) await this.db.affiliateProgram.update({ where: { id: existing.id }, data });
    else await this.db.affiliateProgram.create({ data: data as never });
    await this.audit.record({ action: 'affiliates.program', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'AffiliateProgram', after: input as never });
    return this.program();
  }

  async list() {
    const rows = await this.db.affiliate.findMany({ orderBy: { createdAt: 'desc' }, include: { conversions: { select: { status: true, commission: true } } } });
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, fullName: true, email: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    const clicks = await this.db.affiliateClick.groupBy({ by: ['affiliateId'], _count: { _all: true } });
    const clickMap = new Map(clicks.map((c) => [c.affiliateId, c._count._all]));
    return rows.map(({ conversions, ...a }) => ({
      ...a, commissionPercent: Number(a.commissionPercent), user: byId.get(a.userId) ?? null, clicks: clickMap.get(a.id) ?? 0, conversions: conversions.filter((c) => c.status !== 'REVERSED').length,
      owed: conversions.filter((c) => c.status === 'APPROVED').reduce((s, c) => s + Number(c.commission), 0).toFixed(2),
      pending: conversions.filter((c) => c.status === 'PENDING').reduce((s, c) => s + Number(c.commission), 0).toFixed(2),
    }));
  }

  async updateAffiliate(id: string, input: { status?: 'ACTIVE' | 'SUSPENDED'; commissionPercent?: number }, actorUserId: string) {
    const a = await this.db.affiliate.findFirst({ where: { id } });
    if (!a) throw AppException.notFound('Affiliate not found');
    if (input.commissionPercent !== undefined && (input.commissionPercent < 1 || input.commissionPercent > 90)) throw AppException.validation([{ field: 'commissionPercent', message: '1–90%' }]);
    await this.db.affiliate.update({
      where: { id },
      data: { ...(input.status ? { status: input.status, ...(input.status === 'ACTIVE' && !a.approvedAt ? { approvedAt: new Date() } : {}) } : {}), ...(input.commissionPercent !== undefined ? { commissionPercent: input.commissionPercent } : {}) },
    });
    await this.audit.record({ action: 'affiliates.update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Affiliate', targetId: id, after: input as never });
    return (await this.list()).find((x) => x.id === id);
  }

  async conversions(params: { affiliateId?: string; status?: string }) {
    const rows = await this.db.affiliateConversion.findMany({ where: { ...(params.affiliateId ? { affiliateId: params.affiliateId } : {}), ...(params.status ? { status: params.status } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
    const orders = await this.db.order.findMany({ where: { id: { in: rows.map((r) => r.orderId) } }, select: { id: true, number: true } });
    const num = new Map(orders.map((o) => [o.id, o.number]));
    return rows.map((r) => ({ ...r, saleAmount: r.saleAmount.toString(), commission: r.commission.toString(), orderNumber: num.get(r.orderId) ?? null }));
  }

  /** Records a payout made outside the platform (bank/UPI) for all approved commissions of an affiliate. */
  async markPaid(affiliateId: string, payoutRef: string, actorUserId: string) {
    const a = await this.db.affiliate.findFirst({ where: { id: affiliateId } });
    if (!a) throw AppException.notFound('Affiliate not found');
    const r = await this.db.affiliateConversion.updateMany({ where: { affiliateId, status: 'APPROVED' }, data: { status: 'PAID', paidAt: new Date(), payoutRef } });
    if (!r.count) throw AppException.conflict('Nothing approved to pay out yet.');
    await this.audit.record({ action: 'affiliates.payout', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Affiliate', targetId: affiliateId, after: { conversions: r.count, payoutRef } });
    return { paid: r.count };
  }

  // ── student side ──────────────────────────────────────────
  async join(userId: string, payoutDetails?: string | null) {
    const program = await this.program();
    if (!program.enabled) throw AppException.conflict('This academy does not run an affiliate program.');
    const existing = await this.db.affiliate.findFirst({ where: { userId } });
    if (existing) return this.me(userId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } });
    const base = user.fullName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 10) || 'ref';
    for (let i = 0; i < 5; i++) {
      try {
        await this.db.affiliate.create({
          data: { userId, code: `${base}${randomBytes(3).toString('hex')}`.toUpperCase(), commissionPercent: program.defaultPercent, status: program.autoApprove ? 'ACTIVE' : 'PENDING', approvedAt: program.autoApprove ? new Date() : null, payoutDetails: payoutDetails?.trim() || null } as never,
        });
        break;
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
      }
    }
    return this.me(userId);
  }

  /** The affiliate's dashboard. Buyer identities are never shown. */
  async me(userId: string) {
    const program = await this.program();
    const a = await this.db.affiliate.findFirst({ where: { userId } });
    if (!a) return { program: { enabled: program.enabled, defaultPercent: program.defaultPercent, cookieDays: program.cookieDays, holdDays: program.holdDays, terms: program.terms }, affiliate: null };
    const [clicks, conv] = await Promise.all([
      this.db.affiliateClick.count({ where: { affiliateId: a.id } }),
      this.db.affiliateConversion.findMany({ where: { affiliateId: a.id }, orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);
    const sum = (st: string) => conv.filter((c) => c.status === st).reduce((s, c) => s + Number(c.commission), 0).toFixed(2);
    return {
      program: { enabled: program.enabled, defaultPercent: program.defaultPercent, cookieDays: program.cookieDays, holdDays: program.holdDays, terms: program.terms },
      affiliate: { code: a.code, status: a.status, commissionPercent: Number(a.commissionPercent), payoutDetails: a.payoutDetails },
      stats: { clicks, conversions: conv.filter((c) => c.status !== 'REVERSED').length, pending: sum('PENDING'), approved: sum('APPROVED'), paid: sum('PAID'), currency: conv[0]?.currency ?? null },
      conversions: conv.map((c) => ({ id: c.id, date: c.createdAt, saleAmount: c.saleAmount.toString(), commission: c.commission.toString(), currency: c.currency, status: c.status, approvableAt: c.approvableAt })),
    };
  }

  async updatePayoutDetails(userId: string, payoutDetails: string | null) {
    const a = await this.db.affiliate.findFirst({ where: { userId } });
    if (!a) throw AppException.notFound('Join the affiliate program first');
    await this.db.affiliate.update({ where: { id: a.id }, data: { payoutDetails: payoutDetails?.trim() || null } });
    return this.me(userId);
  }

  // ── attribution ───────────────────────────────────────────
  async click(code: string, path: string, ip?: string | null) {
    const a = await this.activeByCode(code);
    if (!a) return { valid: false };
    await this.db.affiliateClick.create({ data: { affiliateId: a.id, path: path.slice(0, 300), ipHash: ip ? createHash('sha256').update(ip).digest('hex') : null } as never });
    const program = await this.program();
    return { valid: true, cookieDays: program.cookieDays };
  }

  private async activeByCode(code: string) {
    const program = await this.program();
    if (!program.enabled) return null;
    const a = await this.db.affiliate.findFirst({ where: { code: code.trim().toUpperCase(), status: 'ACTIVE' } });
    return a ?? null;
  }

  /** Affiliate to credit for a checkout, or null (unknown/inactive code, self-referral). */
  async attribute(code: string | null | undefined, buyerUserId: string) {
    if (!code) return null;
    const a = await this.activeByCode(code);
    return a && a.userId !== buyerUserId ? a.id : null;
  }

  /** Called inside the order-paid transaction. */
  async recordConversion(tx: Tx, order: { id: string; affiliateId: string | null; currency: string; totalAmount: unknown; taxAmount: unknown; paidAt: Date }) {
    if (!order.affiliateId) return null;
    const a = await tx.affiliate.findFirst({ where: { id: order.affiliateId } });
    if (!a || a.status !== 'ACTIVE') return null;
    const program = await tx.affiliateProgram.findFirst({});
    const net = toMinor(String(order.totalAmount), order.currency) - toMinor(String(order.taxAmount), order.currency);
    const commission = Math.round((net * Number(a.commissionPercent)) / 100);
    if (commission <= 0) return null;
    return tx.affiliateConversion.create({
      data: { affiliateId: a.id, orderId: order.id, currency: order.currency, saleAmount: fromMinor(net, order.currency), percent: a.commissionPercent, commission: fromMinor(commission, order.currency), approvableAt: new Date(order.paidAt.getTime() + (program?.holdDays ?? 7) * DAY) } as never,
    });
  }

  /** After a refund: commissions shrink with the remaining sale; a full refund reverses them. */
  async adjustForRefund(tx: Tx, orderId: string, refundedMinor: number, totalMinor: number) {
    const c = await tx.affiliateConversion.findFirst({ where: { orderId } });
    if (!c || c.status === 'REVERSED') return null;
    if (c.status === 'PAID') return { note: 'already paid out' };
    const remaining = Math.max(0, totalMinor - refundedMinor);
    if (remaining === 0) return tx.affiliateConversion.update({ where: { id: c.id }, data: { status: 'REVERSED', commission: '0' } });
    // Always from the original sale and rate, so several partial refunds never compound.
    const original = Math.round((toMinor(c.saleAmount.toString(), c.currency) * Number(c.percent)) / 100);
    const scaled = Math.round((original * remaining) / totalMinor);
    return tx.affiliateConversion.update({ where: { id: c.id }, data: { commission: fromMinor(scaled, c.currency) } });
  }

  /** Worker: approve commissions whose hold period has passed. */
  async approveDue(now = new Date()) {
    const r = await this.prisma.affiliateConversion.updateMany({ where: { status: 'PENDING', approvableAt: { lte: now } }, data: { status: 'APPROVED', approvedAt: now } });
    return { approved: r.count };
  }
}
