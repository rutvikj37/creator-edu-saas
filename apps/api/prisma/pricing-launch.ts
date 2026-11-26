/**
 * Pricing launch: Grow (₹16,999 / 6 months) + Rise (₹19,999 / year). Same features; GST extra.
 * Idempotent — safe to run on every deploy after migrate.
 */
import type { PrismaClient } from '../src/generated/prisma/client.js';

const SHARED = {
  'courses.max': null,
  'products.max': null,
  'students.max': null,
  'contacts.max': null,
  'staff.max': null,
  'storage.gb': null,
  'bandwidth.gb': null,
  'domains.custom': 1,
  'marketing.emails': 5000,
  website_builder: true,
  marketing: true,
  affiliates: true,
  live_classes: true,
  integrations: true,
  'analytics.advanced': true,
  // Disabled on launch plans — keep the key so Usage/plan UIs can omit it cleanly.
  'ai.credits': false,
  'commission.percent': 0,
  white_label: true,
} as const;

/** Feature map: boolean = flag, number|null = limit (null = unlimited). */
export type FeatureMap = Record<string, boolean | number | null>;

export type LaunchPrice = { interval: 'MONTH' | 'SIX_MONTH' | 'YEAR'; currency: string; amount: number };

export const LAUNCH_PLANS: Array<{
  code: string;
  name: string;
  description: string;
  isDefault: boolean;
  trialDays: number;
  sortOrder: number;
  isPublic: boolean;
  features: FeatureMap;
  prices: LaunchPrice[];
}> = [
  {
    code: 'grow',
    name: 'Grow',
    description: 'Same full academy toolkit billed every 6 months — courses, live classes, marketing and white label.',
    isDefault: false,
    trialDays: 0,
    sortOrder: 1,
    isPublic: true,
    features: { ...SHARED },
    prices: [{ interval: 'SIX_MONTH', currency: 'INR', amount: 16999 }],
  },
  {
    code: 'rise',
    name: 'Rise',
    description: 'The same modules as Grow, billed yearly — best value for established educators and institutes.',
    isDefault: false,
    trialDays: 0,
    sortOrder: 2,
    isPublic: true,
    features: { ...SHARED },
    prices: [{ interval: 'YEAR', currency: 'INR', amount: 19999 }],
  },
];

/** Flattened launch prices (for tests / callers that only need amounts). */
export const LAUNCH_PRICES: LaunchPrice[] = LAUNCH_PLANS.flatMap((p) => p.prices);

function featureRows(features: FeatureMap) {
  return Object.entries(features).map(([featureKey, v]) =>
    typeof v === 'boolean'
      ? { featureKey, enabled: v, limitValue: null as bigint | null }
      : { featureKey, enabled: true, limitValue: v === null ? null : BigInt(v) },
  );
}

function snapshotFromFeatures(features: FeatureMap) {
  return Object.fromEntries(
    featureRows(features).map((f) => [f.featureKey, { enabled: f.enabled, limit: f.limitValue === null ? null : f.limitValue.toString() }]),
  );
}

/** Replace a plan's feature rows with the shared launch map. */
async function applySharedFeatures(client: PrismaClient, planId: string) {
  await client.planFeature.deleteMany({ where: { planId } });
  await client.planFeature.createMany({
    data: featureRows(SHARED).map((f) => ({ ...f, planId })),
  });
}

/**
 * Refresh featureSnapshot on current subscriptions so Billing Usage picks up plan
 * entitlement changes without waiting for a re-assign. Complimentary Pro (no price)
 * and all Grow/Rise currents are included.
 */
async function refreshLaunchSnapshots(client: PrismaClient, planIds: string[]) {
  if (!planIds.length) return;
  const snapshot = snapshotFromFeatures(SHARED);
  await client.subscription.updateMany({
    where: {
      currentKey: 'current',
      planId: { in: planIds },
      status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE'] },
    },
    data: { featureSnapshot: snapshot as never },
  });
}

/** Upsert Grow/Rise with distinct intervals, shared features, and hide legacy public catalogue plans. */
export async function syncPricingLaunch(client: PrismaClient) {
  await client.subscriptionPlan.updateMany({
    where: { code: { in: ['growth', 'pro', 'campus'] } },
    data: { isPublic: false, isDefault: false },
  });
  const trial = await client.subscriptionPlan.findUnique({ where: { code: 'trial' } });
  if (trial) {
    await client.subscriptionPlan.update({
      where: { code: 'trial' },
      data: { isPublic: false, isDefault: true, status: 'ACTIVE' },
    });
  }

  const syncedPlanIds: string[] = [];

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

    await applySharedFeatures(client, plan.id);
    syncedPlanIds.push(plan.id);

    // Only this plan's launch price(s) stay active; deactivate month / other currencies / old intervals.
    await client.planPrice.updateMany({
      where: {
        planId: plan.id,
        NOT: { OR: p.prices.map((x) => ({ interval: x.interval, currency: x.currency })) },
      },
      data: { active: false },
    });
    for (const price of p.prices) {
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

  // Complimentary Pro (and other legacy Pro assigns) should show the same Usage entitlements.
  const pro = await client.subscriptionPlan.findUnique({ where: { code: 'pro' } });
  if (pro) {
    await applySharedFeatures(client, pro.id);
    syncedPlanIds.push(pro.id);
  }

  await refreshLaunchSnapshots(client, syncedPlanIds);

  console.log('Synced pricing launch: Grow ₹16,999 / 6 mo · Rise ₹19,999 / year (unlimited storage/bandwidth, 1 domain, 5k emails, no AI credits)');
}
