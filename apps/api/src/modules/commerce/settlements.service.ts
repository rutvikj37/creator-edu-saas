import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { GatewayService } from './gateway.service.js';
import { fromMinor, toMinor } from './providers/money.js';
import { RazorpayAdapter } from './providers/razorpay.adapter.js';

const DAY = 86_400_000;

/**
 * Settlements: Razorpay pays academies directly, so payouts are read live from the academy's own
 * Razorpay account (settlements + daily reconciliation for the transaction count). Earnings come
 * from captured payments recorded here.
 */
@Injectable()
export class SettlementsService {
  private readonly log = new Logger(SettlementsService.name);
  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient, private readonly gateways: GatewayService, private readonly razorpay: RazorpayAdapter) {}

  async overview(params: { from?: string; to?: string; q?: string }) {
    const a = await this.db.paymentGatewayAccount.findFirst({ where: { provider: 'RAZORPAY' }, orderBy: { isActive: 'desc' } });
    const currency = 'INR';
    const [captured, refunds] = await Promise.all([
      this.db.payment.aggregate({ where: { status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, currency }, _sum: { amount: true, feeAmount: true } }),
      this.db.refund.aggregate({ where: { status: 'PROCESSED', order: { currency } }, _sum: { amount: true } }),
    ]);
    const earned = toMinor(captured._sum.amount ?? 0, currency) - toMinor(refunds._sum.amount ?? 0, currency);
    const fees = toMinor(captured._sum.feeAmount ?? 0, currency);
    if (!a) return { connected: false, currency, totals: { earnings: fromMinor(earned, currency), settled: '0.00', toBeSettled: fromMinor(Math.max(0, earned - fees), currency) }, items: [] };

    const creds = (await this.gateways.credentialsById(a.id))!.creds;
    const to = params.to ? new Date(`${params.to}T23:59:59Z`) : new Date();
    const from = params.from ? new Date(`${params.from}T00:00:00Z`) : new Date(to.getTime() - 365 * DAY);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw AppException.validation([{ field: 'from', message: 'Choose a valid date range' }]);
    let all: Awaited<ReturnType<RazorpayAdapter['settlements']>> = [];
    try {
      for (let skip = 0; skip < 500; skip += 100) {
        const page = await this.razorpay.settlements(creds, { from: Math.floor(from.getTime() / 1000), to: Math.floor(to.getTime() / 1000), count: 100, skip });
        all = all.concat(page);
        if (page.length < 100) break;
      }
    } catch (e) {
      this.log.warn(`settlements: ${(e as Error).message}`);
      throw AppException.conflict('Couldn’t load settlements from Razorpay. Check your Razorpay keys under Payments.');
    }
    // Transactions per settlement, from the daily reconciliation of the days shown.
    const counts = new Map<string, number>();
    const days = [...new Set(all.map((s) => s.createdAt.toISOString().slice(0, 10)))].slice(0, 31);
    for (const d of days) {
      const rows = await this.razorpay.settlementRecon(creds, new Date(`${d}T00:00:00Z`)).catch(() => []);
      for (const r of rows) if (r.settlementId && r.type !== 'settlement') counts.set(r.settlementId, (counts.get(r.settlementId) ?? 0) + 1);
    }
    const settled = all.filter((s) => s.status === 'processed').reduce((n, s) => n + s.amountMinor, 0);
    const q = params.q?.trim().toLowerCase();
    const items = all
      .filter((s) => !q || s.id.toLowerCase().includes(q) || (s.utr ?? '').toLowerCase().includes(q))
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
      .map((s) => ({ id: s.id, date: s.createdAt, amount: fromMinor(s.amountMinor, currency), fees: fromMinor(s.feesMinor, currency), status: s.status, utr: s.utr, transactions: counts.get(s.id) ?? null }));
    return {
      connected: true, currency,
      totals: { earnings: fromMinor(earned, currency), settled: fromMinor(settled, currency), toBeSettled: fromMinor(Math.max(0, earned - fees - settled), currency) },
      items,
    };
  }

  async csv(params: { from?: string; to?: string; q?: string }) {
    const o = await this.overview(params);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return ['Date,Settlement ID,Settled amount,Fees,Status,UTR,Transactions', ...o.items.map((i) => [i.date.toISOString(), i.id, i.amount, i.fees, i.status, i.utr, i.transactions ?? ''].map(esc).join(','))].join('\n');
  }
}
