/**
 * Order pricing in minor units (integers — no floating point money).
 * Tax applies only when the seller is GST-registered. Inclusive prices extract the tax
 * from the amount paid; exclusive prices add it on top.
 */
export interface CouponRule {
  type: 'PERCENT' | 'FIXED';
  /** Percent (0–100) or a fixed amount in minor units. */
  value: number;
}

export interface TaxRule {
  rate: number;
  inclusive: boolean;
}

export interface Quote {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  /** Amount excluding tax (basis for platform commission). */
  net: number;
}

export function computeQuote(unitMinor: number, coupon: CouponRule | null, tax: TaxRule | null): Quote {
  const subtotal = unitMinor;
  let discount = 0;
  if (coupon) discount = coupon.type === 'PERCENT' ? Math.round((subtotal * Math.min(100, coupon.value)) / 100) : Math.min(coupon.value, subtotal);
  const afterDiscount = subtotal - discount;
  if (!tax || tax.rate <= 0 || afterDiscount === 0) return { subtotal, discount, tax: 0, total: afterDiscount, net: afterDiscount };
  if (tax.inclusive) {
    const taxAmount = Math.round(afterDiscount - afterDiscount / (1 + tax.rate / 100));
    return { subtotal, discount, tax: taxAmount, total: afterDiscount, net: afterDiscount - taxAmount };
  }
  const taxAmount = Math.round((afterDiscount * tax.rate) / 100);
  return { subtotal, discount, tax: taxAmount, total: afterDiscount + taxAmount, net: afterDiscount };
}

export function commissionMinor(net: number, percent: number | null | undefined) {
  if (!percent || percent <= 0) return 0;
  return Math.round((net * percent) / 100);
}

/** Share of `part` that a partial refund of `refund` out of `total` carries (tax, commission reversals). */
export function proportional(part: number, refund: number, total: number) {
  return total === 0 ? 0 : Math.round((part * refund) / total);
}

export interface LineQuote {
  unit: number;
  discount: number;
  /** What the buyer pays for the line (includes tax when prices exclude it). Lines sum to the order total. */
  total: number;
}

/** Splits `amount` across `weights` proportionally; rounding remainder goes to the largest weight. */
export function allocate(amount: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || !amount) return weights.map(() => 0);
  const parts = weights.map((w) => Math.floor((amount * w) / sum));
  const rest = amount - parts.reduce((a, b) => a + b, 0);
  const big = weights.indexOf(Math.max(...weights));
  parts[big] += rest;
  return parts;
}

/**
 * Quote for several lines (cart). The coupon applies to `eligible` lines only (percent per line;
 * fixed amounts split by price). Tax is computed on the order after discount, exactly like a
 * single-line quote, and allocated back to lines so line totals add up to the order total.
 * With one eligible line this equals `computeQuote`.
 */
export function computeLinesQuote(units: number[], eligible: boolean[], coupon: CouponRule | null, tax: TaxRule | null): Quote & { lines: LineQuote[] } {
  const subtotal = units.reduce((a, b) => a + b, 0);
  let discounts = units.map(() => 0);
  if (coupon) {
    const base = units.map((u, i) => (eligible[i] ? u : 0));
    const eligibleSum = base.reduce((a, b) => a + b, 0);
    discounts = coupon.type === 'PERCENT'
      ? allocate(Math.round((eligibleSum * Math.min(100, coupon.value)) / 100), base)
      : allocate(Math.min(coupon.value, eligibleSum), base);
  }
  const discount = discounts.reduce((a, b) => a + b, 0);
  const after = units.map((u, i) => u - discounts[i]);
  const q = computeQuote(subtotal - discount, null, tax);
  // computeQuote on the discounted amount gives the order's tax/total; express it against the real subtotal.
  const order: Quote = { subtotal, discount, tax: q.tax, total: q.total, net: q.net };
  const extra = tax && !tax.inclusive ? allocate(q.tax, after) : after.map(() => 0);
  return { ...order, lines: units.map((u, i) => ({ unit: u, discount: discounts[i], total: after[i] + extra[i] })) };
}
