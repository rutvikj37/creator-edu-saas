import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service.js';

const DAY = 86_400_000;

export function resolveRange(from?: string, to?: string) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 29 * DAY);
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(23, 59, 59, 999);
  if (end.getTime() - start.getTime() > 366 * DAY) start.setTime(end.getTime() - 366 * DAY);
  return { start, end };
}

/** Builds a zero-filled per-day series (UTC dates) from grouped counts. */
export function dailySeries(start: Date, end: Date, rows: Array<{ day: string | Date; count: bigint | number }>) {
  const counts = new Map(rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.count)]));
  const out: Array<{ date: string; count: number }> = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY) {
    const key = new Date(t).toISOString().slice(0, 10);
    out.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

/** Platform KPIs computed from live data, including academy sales from the commerce ledger. */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async metrics(from?: string, to?: string) {
    const { start, end } = resolveRange(from, to);
    const [byStatus, creators, students, newTenants, newStudents, subs, planDist, expiring] = await Promise.all([
      this.prisma.tenant.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.tenantMember.count({ where: { role: { key: 'OWNER' }, status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { realm: 'TENANT', deletedAt: null } }),
      this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`SELECT DATE(createdAt) AS day, COUNT(*) AS count FROM Tenant WHERE createdAt BETWEEN ${start} AND ${end} GROUP BY DATE(createdAt)`,
      this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`SELECT DATE(createdAt) AS day, COUNT(*) AS count FROM User WHERE realm = 'TENANT' AND createdAt BETWEEN ${start} AND ${end} GROUP BY DATE(createdAt)`,
      this.prisma.subscription.findMany({ where: { currentKey: 'current' }, select: { status: true, planPrice: { select: { amount: true, currency: true, interval: true } } } }),
      this.prisma.subscription.groupBy({ by: ['planId'], where: { currentKey: 'current' }, _count: { _all: true } }),
      this.prisma.subscription.count({ where: { currentKey: 'current', status: { in: ['ACTIVE', 'TRIALING'] }, currentPeriodEnd: { gte: new Date(), lte: new Date(Date.now() + 7 * DAY) } } }),
    ]);
    const plans = await this.prisma.subscriptionPlan.findMany({ where: { id: { in: planDist.map((p) => p.planId) } }, select: { id: true, name: true } });
    const planName = new Map(plans.map((p) => [p.id, p.name]));

    // MRR per currency from paying (ACTIVE / PAST_DUE / GRACE) subscriptions with a price.
    const mrr: Record<string, number> = {};
    for (const s of subs) {
      if (!s.planPrice || !['ACTIVE', 'PAST_DUE', 'GRACE'].includes(s.status)) continue;
      const monthly = Number(s.planPrice.amount) / (s.planPrice.interval === 'YEAR' ? 12 : 1);
      mrr[s.planPrice.currency] = (mrr[s.planPrice.currency] ?? 0) + monthly;
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    const status = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
    const subStatus = subs.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {});

    return {
      range: { from: start.toISOString(), to: end.toISOString() },
      tenants: {
        total: Object.entries(status).filter(([k]) => k !== 'DELETED').reduce((a, [, v]) => a + v, 0),
        active: status.ACTIVE ?? 0,
        onboarding: status.ONBOARDING ?? 0,
        suspended: status.SUSPENDED ?? 0,
        pendingDeletion: status.PENDING_DELETION ?? 0,
      },
      creators,
      students,
      subscriptions: {
        byStatus: subStatus,
        active: (subStatus.ACTIVE ?? 0) + (subStatus.TRIALING ?? 0),
        expiringIn7Days: expiring,
        failed: (subStatus.PAST_DUE ?? 0) + (subStatus.GRACE ?? 0),
        mrr: Object.entries(mrr).map(([currency, amount]) => ({ currency, amount: round(amount) })),
        arr: Object.entries(mrr).map(([currency, amount]) => ({ currency, amount: round(amount * 12) })),
      },
      planDistribution: planDist.map((p) => ({ planId: p.planId, name: planName.get(p.planId) ?? 'Unknown', count: p._count._all })),
      series: { tenantRegistrations: dailySeries(start, end, newTenants), studentRegistrations: dailySeries(start, end, newStudents) },
      commerce: await this.commerce(start, end),
    };
  }

  /**
   * Academy sales from the ledger. Academies collect through their own Razorpay accounts, so this is
   * GMV (not platform cash); platformCommission is what academies owe the platform under their plan.
   */
  async commerce(start: Date, end: Date) {
    const [byType, paidOrders, sellingAcademies, daily] = await Promise.all([
      this.prisma.ledgerEntry.groupBy({ by: ['type', 'currency'], where: { createdAt: { gte: start, lte: end } }, _sum: { amount: true } }),
      this.prisma.order.count({ where: { paidAt: { gte: start, lte: end } } }),
      this.prisma.paymentGatewayAccount.count({ where: { isActive: true, status: 'VERIFIED' } }),
      this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`SELECT DATE(paidAt) AS day, COUNT(*) AS count FROM \`Order\` WHERE paidAt BETWEEN ${start} AND ${end} GROUP BY DATE(paidAt)`,
    ]);
    const cur: Record<string, Record<string, number>> = {};
    for (const r of byType) (cur[r.currency] ??= {})[r.type] = Number(r._sum.amount ?? 0);
    const round = (n: number) => Math.round(n * 100) / 100;
    const per = (fn: (t: Record<string, number>) => number) => Object.entries(cur).map(([currency, t]) => ({ currency, amount: round(fn(t)) }));
    return {
      available: true,
      paidOrders,
      sellingAcademies,
      gmv: per((t) => t.SALE ?? 0),
      refunds: per((t) => -(t.REFUND ?? 0)),
      platformCommission: per((t) => -((t.PLATFORM_COMMISSION ?? 0) + (t.COMMISSION_REVERSAL ?? 0))),
      series: dailySeries(start, end, daily),
    };
  }
}
