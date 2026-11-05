import { describe, expect, it } from 'vitest';
import { commissionMinor, computeQuote, proportional, computeLinesQuote } from './pricing.js';

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

describe('computeLinesQuote', () => {
  it('matches the single-line quote', () => {
    for (const tax of [null, { rate: 18, inclusive: true }, { rate: 18, inclusive: false }]) {
      for (const coupon of [null, { type: 'PERCENT' as const, value: 25 }, { type: 'FIXED' as const, value: 30_000 }]) {
        const one = computeQuote(99_900, coupon, tax);
        const many = computeLinesQuote([99_900], [true], coupon, tax);
        expect({ ...many, lines: undefined }).toEqual({ ...one, lines: undefined });
        expect(many.lines[0].total).toBe(one.total);
      }
    }
  });

  it('applies coupons to eligible lines only and keeps line totals equal to the order total', () => {
    const q = computeLinesQuote([50_000, 30_000, 20_000], [true, false, true], { type: 'PERCENT', value: 10 }, { rate: 18, inclusive: false });
    expect(q.lines.map((l) => l.discount)).toEqual([5_000, 0, 2_000]);
    expect(q.discount).toBe(7_000);
    expect(q.tax).toBe(Math.round(93_000 * 0.18));
    expect(q.total).toBe(93_000 + q.tax);
    expect(q.lines.reduce((a, l) => a + l.total, 0)).toBe(q.total);
  });

  it('caps a fixed coupon at the eligible amount and splits it by price', () => {
    const q = computeLinesQuote([10_000, 30_000, 5_000], [true, true, false], { type: 'FIXED', value: 100_000 }, null);
    expect(q.lines.map((l) => l.discount)).toEqual([10_000, 30_000, 0]);
    expect(q.total).toBe(5_000);
    const r = computeLinesQuote([10_001, 20_002], [true, true], { type: 'FIXED', value: 1_000 }, { rate: 18, inclusive: true });
    expect(r.lines.reduce((a, l) => a + l.discount, 0)).toBe(1_000);
    expect(r.lines.reduce((a, l) => a + l.total, 0)).toBe(r.total);
  });
});
