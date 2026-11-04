import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { EntitlementsService, type FeatureSnapshot } from './entitlements.service.js';

type Tx = Prisma.TransactionClient;

export function addInterval(from: Date, interval: 'MONTH' | 'YEAR'): Date {
  const d = new Date(from);
  if (interval === 'MONTH') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

/** Plan assignment. Exactly one non-terminal subscription per tenant (enforced by unique currentKey). */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async snapshotOf(tx: Tx, planId: string): Promise<FeatureSnapshot> {
    const features = await tx.planFeature.findMany({ where: { planId } });
    return Object.fromEntries(features.map((f) => [f.featureKey, { enabled: f.enabled, limit: f.limitValue === null ? null : f.limitValue.toString() }]));
  }

  /**
   * Starts a plan for a tenant, ending the current one.
   * - trial: uses plan.trialDays when the tenant never had a subscription before
   * - otherwise: active for one billing interval of the chosen price (or open-ended without a price,
   *   e.g. complimentary plans assigned by Super Admin)
   * Paid self-serve purchases go through the commerce/billing flow (Phase 7), which calls this after payment.
   */
  async assignPlan(tx: Tx, p: { tenantId: string; planId: string; planPriceId?: string | null; source: string; allowTrial?: boolean }) {
    const plan = await tx.subscriptionPlan.findUnique({ where: { id: p.planId }, include: { prices: true } });
    if (!plan || plan.status === 'ARCHIVED') throw AppException.notFound('Plan not found');
    const price = p.planPriceId ? plan.prices.find((x) => x.id === p.planPriceId && x.active) : undefined;
    if (p.planPriceId && !price) throw AppException.validation([{ field: 'planPriceId', message: 'Price not found for this plan' }]);

    const hadAny = (await tx.subscription.count({ where: { tenantId: p.tenantId } })) > 0;
    await tx.subscription.updateMany({
      where: { tenantId: p.tenantId, currentKey: 'current' },
      data: { currentKey: null, status: 'CANCELED', canceledAt: new Date() },
    });
    const now = new Date();
    const trial = p.allowTrial !== false && !hadAny && plan.trialDays > 0;
    const trialEndsAt = trial ? new Date(now.getTime() + plan.trialDays * 86_400_000) : null;
    const sub = await tx.subscription.create({
      data: {
        tenantId: p.tenantId,
        planId: plan.id,
        planPriceId: price?.id ?? null,
        status: trial ? 'TRIALING' : 'ACTIVE',
        currentKey: 'current',
        currentPeriodStart: now,
        currentPeriodEnd: trial ? trialEndsAt : price ? addInterval(now, price.interval) : null,
        trialEndsAt,
        featureSnapshot: (await this.snapshotOf(tx, plan.id)) as never,
        source: p.source,
      },
    });
    return sub;
  }

  /** Default plan for new academies (the plan flagged isDefault by Super Admin), if any. */
  async assignDefault(tx: Tx, tenantId: string) {
    const plan = await tx.subscriptionPlan.findFirst({ where: { isDefault: true, status: 'ACTIVE' } });
    if (!plan) return null;
    return this.assignPlan(tx, { tenantId, planId: plan.id, source: 'signup' });
  }

  async afterChange(tenantId: string) {
    await this.entitlements.invalidate(tenantId);
  }

  current(tenantId: string) {
    return this.prisma.subscription.findFirst({
      where: { tenantId, currentKey: 'current' },
      include: { plan: { select: { id: true, name: true, code: true } }, planPrice: true },
    });
  }
}
