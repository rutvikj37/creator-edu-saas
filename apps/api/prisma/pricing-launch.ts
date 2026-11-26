/**
 * Pricing launch: Grow + Rise at ₹15,999 / 6 months and ₹19,999 / 12 months.
 * Idempotent — safe to run on every deploy after migrate.
 */
import type { PrismaClient } from '../src/generated/prisma/client.js';

export const LAUNCH_PRICES = [
  { interval: 'SIX_MONTH' as const, currency: 'INR', amount: 15999 },
  { interval: 'YEAR' as const, currency: 'INR', amount: 19999 },
];

const SHARED = {
  'courses.max': null,
  'products.max': null,
  'students.max': null,
  'contacts.max': null,
  'staff.max': null,
  'storage.gb': 1000,
  'bandwidth.gb': 5000,
  'domains.custom': null,
  'marketing.emails': 5000,
  website_builder: true,
  marketing: true,
  affiliates: true,
  live_classes: true,
  integrations: true,
  'analytics.advanced': true,
  'ai.credits': 5000,
  'commission.percent': 0,
} as const;

/** Feature map: boolean = flag, number|null = limit (null = unlimited). */
export type FeatureMap = Record<string, boolean | number | null>;

export const LAUNCH_PLANS: Array<{
  code: string;
  name: string;
  description: string;
  isDefault: boolean;
  trialDays: number;
  sortOrder: number;
  isPublic: boolean;
  features: FeatureMap;
}> = [
  {
    code: 'grow',
    name: 'Grow',
    description: 'For creators ready to sell courses, live classes and digital products under their own brand.',
    isDefault: false,
    trialDays: 0,
    sortOrder: 1,
    isPublic: true,
    features: { ...SHARED, white_label: false },
  },
  {
    code: 'rise',
    name: 'Rise',
    description: 'White-label academy for established educators and institutes that need full brand control.',
    isDefault: false,
    trialDays: 0,
    sortOrder: 2,
    isPublic: true,
    features: { ...SHARED, white_label: true },
  },
];

function featureRows(features: FeatureMap) {
  return Object.entries(features).map(([featureKey, v]) =>
    typeof v === 'boolean'
      ? { featureKey, enabled: v, limitValue: null as bigint | null }
      : { featureKey, enabled: true, limitValue: v === null ? null : BigInt(v) },
  );
}

/** Upsert Grow/Rise, activate launch prices, and hide legacy public catalogue plans. */
export async function syncPricingLaunch(client: PrismaClient) {
  // Hide legacy public plans so the sales page only shows Grow + Rise.
  await client.subscriptionPlan.updateMany({
    where: { code: { in: ['growth', 'pro', 'campus'] } },
    data: { isPublic: false, isDefault: false },
  });
  // Keep trial as the private signup default when it exists.
  const trial = await client.subscriptionPlan.findUnique({ where: { code: 'trial' } });
  if (trial) {
    await client.subscriptionPlan.update({
      where: { code: 'trial' },
      data: { isPublic: false, isDefault: true, status: 'ACTIVE' },
    });
  }

  for (const p of LAUNCH_PLANS) {
    const existing = await client.subscriptionPlan.findUnique({ where: { code: p.code } });
    const isDefault = trial ? false : p.isDefault;
    const plan = existing
      ? await client.subscriptionPlan.update({
          where: { code: p.code },
          data: {
            name: p.name,
            description: p.description,
            status: 'ACTIVE',
            isPublic: p.isPublic,
            isDefault,
            trialDays: p.trialDays,
            sortOrder: p.sortOrder,
          },
        })
      : await client.subscriptionPlan.create({
          data: {
            code: p.code,
            name: p.name,
            description: p.description,
            status: 'ACTIVE',
            isPublic: p.isPublic,
            isDefault,
            trialDays: p.trialDays,
            sortOrder: p.sortOrder,
          },
        });

    // Replace features with the launch set.
    await client.planFeature.deleteMany({ where: { planId: plan.id } });
    await client.planFeature.createMany({
      data: featureRows(p.features).map((f) => ({ ...f, planId: plan.id })),
    });

    // Deactivate non-launch prices; upsert SIX_MONTH + YEAR INR.
    await client.planPrice.updateMany({
      where: {
        planId: plan.id,
        NOT: { OR: LAUNCH_PRICES.map((x) => ({ interval: x.interval, currency: x.currency })) },
      },
      data: { active: false },
    });
    for (const price of LAUNCH_PRICES) {
      const row = await client.planPrice.findUnique({
        where: { planId_interval_currency: { planId: plan.id, interval: price.interval, currency: price.currency } },
      });
      if (row) {
        await client.planPrice.update({ where: { id: row.id }, data: { amount: price.amount, active: true } });
      } else {
        await client.planPrice.create({
          data: { planId: plan.id, interval: price.interval, currency: price.currency, amount: price.amount, active: true },
        });
      }
    }
  }

  // If growth/pro still exist with subscriptions, leave them; just keep them off the public page.
  console.log('Synced pricing launch: Grow + Rise (₹15,999 / 6 mo, ₹19,999 / 12 mo)');
}
