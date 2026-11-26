import { FEATURES } from '@ce/shared';
import { formatNumber } from '../../../utils/format.js';

const DEFS = Object.values(FEATURES);

/** Launch marketing bullets (shown on public pricing cards for Grow / Rise). */
export const LAUNCH_MODULES = [
  'Unlimited Contacts',
  'Unlimited Admin Accounts',
  'Unlimited Live Classes & Webinars',
  '5,000 Marketing Emails/Month',
  'Third Party Integrations',
  'Unlimited Products',
  'Custom domains',
  'White label',
];

/** Modules for a plan: Rise includes white label; Grow lists everything except white label. */
export function launchModulesFor(plan) {
  const code = plan?.code;
  if (code === 'rise') return LAUNCH_MODULES;
  if (code === 'grow') return LAUNCH_MODULES.filter((m) => m !== 'White label');
  return null;
}

export function intervalLabel(interval) {
  if (interval === 'YEAR') return '12 months';
  if (interval === 'SIX_MONTH') return '6 months';
  if (interval === 'MONTH') return 'month';
  return String(interval || '').toLowerCase();
}

/** The currency to quote: rupees when any plan has a rupee price, otherwise the first one found. */
export function pricingCurrency(plans) {
  const all = plans.flatMap((p) => p.prices.map((x) => x.currency));
  return all.includes('INR') ? 'INR' : all[0] ?? null;
}

export function planPrice(plan, interval, currency) {
  return plan.prices.find((x) => x.interval === interval && x.currency === currency) ?? null;
}

/** Prefer 6-month / 12-month launch billing; fall back to month / year. */
export function preferredIntervals(plans, currency) {
  const has = (iv) => plans.some((p) => planPrice(p, iv, currency));
  if (has('SIX_MONTH') || has('YEAR')) {
    return [
      has('SIX_MONTH') && ['SIX_MONTH', '6 months'],
      has('YEAR') && ['YEAR', '12 months'],
    ].filter(Boolean);
  }
  return [
    has('MONTH') && ['MONTH', 'Monthly'],
    has('YEAR') && ['YEAR', 'Yearly'],
  ].filter(Boolean);
}

/** Whole-percent saving of the yearly price against two 6-month payments (or 12 months). */
export function yearlySaving(plan, currency) {
  const six = Number(planPrice(plan, 'SIX_MONTH', currency)?.amount ?? 0);
  const y = Number(planPrice(plan, 'YEAR', currency)?.amount ?? 0);
  if (six > 0 && y > 0 && y < six * 2) return Math.round((1 - y / (six * 2)) * 100);
  const m = Number(planPrice(plan, 'MONTH', currency)?.amount ?? 0);
  if (!(m > 0 && y > 0) || y >= m * 12) return null;
  return Math.round((1 - y / (m * 12)) * 100);
}

/** Readable feature lines for a plan, in the registry's order. Disabled flags are left out. */
export function planFeatureLines(plan) {
  const launch = launchModulesFor(plan);
  if (launch) return launch;
  const byKey = new Map(plan.features.map((f) => [f.featureKey, f]));
  const lines = [];
  for (const def of DEFS) {
    const f = byKey.get(def.key);
    if (!f || !f.enabled) continue;
    if (def.kind === 'flag') lines.push(def.label);
    else if (def.key === 'commission.percent') lines.push(f.limitValue ? `${f.limitValue}% transaction commission` : 'No transaction commission');
    else if (f.limitValue === null) lines.push(`Unlimited ${def.label.toLowerCase()}`);
    else if (f.limitValue > 0) lines.push(`${formatNumber(f.limitValue)} ${def.label.replace(/^(.)/, (c) => c.toLowerCase()).replace(/^aI/, 'AI')}`);
  }
  return lines;
}

export function priceLabel(price) {
  if (!price) return null;
  const n = Number(price.amount);
  if (n === 0) return 'Free';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: price.currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
}
