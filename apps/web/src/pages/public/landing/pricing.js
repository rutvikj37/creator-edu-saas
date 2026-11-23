import { FEATURES } from '@ce/shared';
import { formatNumber } from '../../../utils/format.js';

const DEFS = Object.values(FEATURES);

/** The currency to quote: rupees when any plan has a rupee price, otherwise the first one found. */
export function pricingCurrency(plans) {
  const all = plans.flatMap((p) => p.prices.map((x) => x.currency));
  return all.includes('INR') ? 'INR' : all[0] ?? null;
}

export function planPrice(plan, interval, currency) {
  return plan.prices.find((x) => x.interval === interval && x.currency === currency) ?? null;
}

/** Whole-percent saving of the yearly price against twelve monthly payments; null when there is none. */
export function yearlySaving(plan, currency) {
  const m = Number(planPrice(plan, 'MONTH', currency)?.amount ?? 0);
  const y = Number(planPrice(plan, 'YEAR', currency)?.amount ?? 0);
  if (!(m > 0 && y > 0) || y >= m * 12) return null;
  return Math.round((1 - y / (m * 12)) * 100);
}

/** Readable feature lines for a plan, in the registry's order. Disabled flags are left out. */
export function planFeatureLines(plan) {
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
