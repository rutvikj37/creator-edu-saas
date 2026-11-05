import { describe, expect, it } from 'vitest';
import { commissionMinor, computeQuote, proportional } from './pricing.js';

describe('computeQuote', () => {
  it('returns the price when there is no coupon or tax', () => {
    expect(computeQuote(49900, null, null)).toEqual({ subtotal: 49900, discount: 0, tax: 0, total: 49900, net: 49900 });
  });
  it('applies percent and fixed coupons, never below zero', () => {
    expect(computeQuote(49900, { type: 'PERCENT', value: 20 }, null).total).toBe(39920);
    expect(computeQuote(49900, { type: 'FIXED', value: 10000 }, null).total).toBe(39900);
    expect(computeQuote(49900, { type: 'FIXED', value: 99900 }, null).total).toBe(0);
    expect(computeQuote(49900, { type: 'PERCENT', value: 100 }, { rate: 18, inclusive: false })).toMatchObject({ total: 0, tax: 0 });
  });
  it('extracts inclusive GST from the amount paid', () => {
    // ₹1180 incl. 18% GST = ₹1000 + ₹180
    expect(computeQuote(118000, null, { rate: 18, inclusive: true })).toEqual({ subtotal: 118000, discount: 0, tax: 18000, total: 118000, net: 100000 });
  });
  it('adds exclusive GST on top of the discounted price', () => {
    expect(computeQuote(100000, { type: 'PERCENT', value: 10 }, { rate: 18, inclusive: false })).toEqual({ subtotal: 100000, discount: 10000, tax: 16200, total: 106200, net: 90000 });
  });
});

describe('commission and proportional reversals', () => {
  it('computes commission on the net amount', () => {
    expect(commissionMinor(100000, 5)).toBe(5000);
    expect(commissionMinor(100000, null)).toBe(0);
  });
  it('splits partial refunds proportionally', () => {
    expect(proportional(18000, 59000, 118000)).toBe(9000);
    expect(proportional(18000, 118000, 118000)).toBe(18000);
  });
});
