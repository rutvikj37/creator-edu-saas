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
