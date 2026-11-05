import { describe, expect, it } from 'vitest';
import { prorationCredit, startOfMonthUtc } from './billing.service.js';

const d = (s: string) => new Date(s);

describe('prorationCredit', () => {
  it('credits the unused share of a paid period', () => {
    expect(prorationCredit(299900, d('2026-11-01T00:00:00Z'), d('2026-12-01T00:00:00Z'), d('2026-11-16T00:00:00Z'))).toBe(149950);
    expect(prorationCredit(299900, d('2026-11-01T00:00:00Z'), d('2026-12-01T00:00:00Z'), d('2026-11-01T00:00:00Z'))).toBe(299900);
  });
  it('gives nothing once the period is over or for a broken period', () => {
    expect(prorationCredit(299900, d('2026-11-01T00:00:00Z'), d('2026-12-01T00:00:00Z'), d('2026-12-02T00:00:00Z'))).toBe(0);
    expect(prorationCredit(299900, d('2026-12-01T00:00:00Z'), d('2026-11-01T00:00:00Z'), d('2026-11-15T00:00:00Z'))).toBe(0);
  });
});

describe('startOfMonthUtc', () => {
  it('returns the first instant of the month in UTC', () => {
    expect(startOfMonthUtc(d('2026-11-05T13:20:00Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(startOfMonthUtc(d('2027-01-01T00:00:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
