import { creditsFor, monthStart, reserveFor } from './credits.js';

describe('AI credits', () => {
  it('charges input and output with output weighted 5×, minimum 1', () => {
    expect(creditsFor(0, 0)).toBe(1);
    expect(creditsFor(1000, 0)).toBe(1);
    expect(creditsFor(1000, 200)).toBe(2);
    expect(creditsFor(2500, 1001)).toBe(8); // 2.5 + 5.005 → 8
    expect(creditsFor(1000, 0, 20_000)).toBe(3); // 20k cached tokens count as 2k
  });
  it('reserves an upper bound from prompt size and max_tokens', () => {
    expect(reserveFor(3000, 2000)).toBe(11);
    expect(reserveFor(0, 8000)).toBe(40);
    expect(reserveFor(3000, 2000)).toBeGreaterThanOrEqual(creditsFor(1000, 2000));
  });
  it('finds the calendar month in the academy time zone', () => {
    // 31 Oct 2026 20:00 UTC is already 1 Nov in India.
    const { start, next } = monthStart(new Date('2026-10-31T20:00:00Z'), 'Asia/Kolkata');
    expect(start.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(next.toISOString()).toBe('2026-11-30T18:30:00.000Z');
    const dec = monthStart(new Date('2026-12-15T00:00:00Z'), 'UTC');
    expect(dec.next.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
