import { FEATURES } from '@ce/shared';
import { formatNumber } from '../../../utils/format.js';

const DEFS = Object.values(FEATURES);

/** Launch marketing bullets for Grow / Rise pricing cards. */
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

/** Rise includes white label; Grow shows the rest. */
export function launchModulesFor(plan) {
  const code = plan?.code;
  if (code === 'rise') return LAUNCH_MODULES;
  if (code === 'grow') return LAUNCH_MODULES.filter((m) => m !== 'White label');
  return null;
}

export function intervalLabel(interval) {
  if (interval === 'YEAR') return 'year';
  if (interval === 'SIX_MONTH') return '6 months';
  if (interval === 'MONTH') return 'month';
  return String(interval || '').toLowerCase();
}

export function pricingCurrency(plans) {
  const all = plans.flatMap((p) => p.prices.map((x) => x.currency));
  return all.includes('INR') ? 'INR' : all[0] ?? null;
}

export function planPrice(plan, interval, currency) {
  return plan.prices.find((x) => x.interval === interval && x.currency === currency) ?? null;
}

/** Public launch pricing uses yearly only. */
export function publicPlanPrice(plan, currency) {
  return planPrice(plan, 'YEAR', currency) ?? plan.prices.find((x) => x.currency === currency && Number(x.amount) > 0) ?? null;
}

export function preferredIntervals(plans, currency) {
  const has = (iv) => plans.some((p) => planPrice(p, iv, currency));
  if (has('YEAR')) return [['YEAR', 'Yearly']];
  return [has('MONTH') && ['MONTH', 'Monthly']].filter(Boolean);
}

export function yearlySaving(plan, currency) {
  const m = Number(planPrice(plan, 'MONTH', currency)?.amount ?? 0);
  const y = Number(planPrice(plan, 'YEAR', currency)?.amount ?? 0);
  if (!(m > 0 && y > 0) || y >= m * 12) return null;
  return Math.round((1 - y / (m * 12)) * 100);
}

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
