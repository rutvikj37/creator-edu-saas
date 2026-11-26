import { FEATURES } from '@ce/shared';
import { formatNumber } from '../../../utils/format.js';

const DEFS = Object.values(FEATURES);

/** Launch marketing bullets — identical on Grow and Rise (period/price differ only). */
export const LAUNCH_MODULES = [
  'Unlimited Contacts',
  'Unlimited Admin Accounts',
  'Unlimited Live Classes & Webinars',
  '5,000 Marketing Emails/Month',
  'Third Party Integrations',
  'Unlimited Products',
  '1 custom domain',
  'White label',
];

/** Same module list for Grow and Rise; other plans fall back to catalogue features. */
export function launchModulesFor(plan) {
  const code = plan?.code;
  if (code === 'rise' || code === 'grow') return LAUNCH_MODULES;
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

/** Each launch plan exposes one active interval (Grow = 6 months, Rise = year). Monthly is not offered. */
export function publicPlanPrice(plan, currency) {
  const priced = (plan.prices ?? []).filter((x) => x.currency === currency && Number(x.amount) > 0);
  return (
    priced.find((x) => x.interval === 'SIX_MONTH')
    ?? priced.find((x) => x.interval === 'YEAR')
    ?? priced.find((x) => x.interval !== 'MONTH')
    ?? null
  );
}

/** Interval tabs for pricing UI — Grow (6 months) and Rise (yearly) only; no Monthly. */
export function preferredIntervals(plans, currency) {
  const has = (iv) => plans.some((p) => planPrice(p, iv, currency));
  return [
    has('SIX_MONTH') && ['SIX_MONTH', '6 months'],
    has('YEAR') && ['YEAR', 'Yearly'],
  ].filter(Boolean);
}

export function yearlySaving(plan, currency) {
  const six = Number(planPrice(plan, 'SIX_MONTH', currency)?.amount ?? 0);
  const y = Number(planPrice(plan, 'YEAR', currency)?.amount ?? 0);
  if (!(six > 0 && y > 0) || y >= six * 2) return null;
  return Math.round((1 - y / (six * 2)) * 100);
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
