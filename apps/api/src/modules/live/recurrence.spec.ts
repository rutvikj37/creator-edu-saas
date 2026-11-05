import { describe, expect, it } from 'vitest';
import { mergedSeconds, occurrences, validRecurrence, zonedTimeToUtc } from './recurrence.js';

describe('zonedTimeToUtc', () => {
  it('converts local wall time to UTC', () => {
    expect(zonedTimeToUtc(2026, 11, 10, 19, 0, 'Asia/Kolkata').toISOString()).toBe('2026-11-10T13:30:00.000Z');
    expect(zonedTimeToUtc(2026, 7, 1, 9, 0, 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z'); // EDT
    expect(zonedTimeToUtc(2026, 12, 1, 9, 0, 'America/New_York').toISOString()).toBe('2026-12-01T14:00:00.000Z'); // EST
  });
});

describe('occurrences', () => {
  it('returns the single start without recurrence', () => {
    const d = new Date('2026-11-10T13:30:00Z');
    expect(occurrences(d, 'Asia/Kolkata', null, new Date('2027-01-01'))).toEqual([d]);
  });
  it('repeats on chosen weekdays with a count', () => {
    // Tue 10 Nov 2026, 19:00 IST; Tue + Thu, 4 sessions.
    const out = occurrences(new Date('2026-11-10T13:30:00Z'), 'Asia/Kolkata', { freq: 'WEEKLY', byDay: ['TU', 'TH'], count: 4 }, new Date('2027-06-01'));
    expect(out.map((d) => d.toISOString())).toEqual(['2026-11-10T13:30:00.000Z', '2026-11-12T13:30:00.000Z', '2026-11-17T13:30:00.000Z', '2026-11-19T13:30:00.000Z']);
  });
  it('keeps the local time across a DST change and stops at until/horizon', () => {
    const out = occurrences(new Date('2026-10-26T13:00:00Z'), 'America/New_York', { freq: 'WEEKLY', byDay: ['MO'], until: '2026-11-09' }, new Date('2027-01-01'));
    expect(out.map((d) => d.toISOString())).toEqual(['2026-10-26T13:00:00.000Z', '2026-11-02T14:00:00.000Z', '2026-11-09T14:00:00.000Z']);
    const capped = occurrences(new Date('2026-11-10T13:30:00Z'), 'Asia/Kolkata', { freq: 'WEEKLY', byDay: ['TU'], count: 50 }, new Date('2026-11-25T00:00:00Z'));
    expect(capped).toHaveLength(3);
  });
  it('keeps the exact start (with seconds) as the first session', () => {
    const first = new Date('2026-11-10T13:30:42.123Z');
    const out = occurrences(first, 'Asia/Kolkata', { freq: 'WEEKLY', byDay: ['TU'], count: 3 }, new Date('2027-01-01'));
    expect(out.map((d) => d.toISOString())).toEqual(['2026-11-10T13:30:42.123Z', '2026-11-17T13:30:00.000Z', '2026-11-24T13:30:00.000Z']);
  });
  it('validates recurrence input', () => {
    expect(validRecurrence({ freq: 'WEEKLY', byDay: ['MO'], count: 5 })).toBe(true);
    expect(validRecurrence({ freq: 'WEEKLY', byDay: ['MO'] })).toBe(false); // must end
    expect(validRecurrence({ freq: 'DAILY', byDay: ['MO'], count: 2 })).toBe(false);
    expect(validRecurrence({ freq: 'WEEKLY', byDay: ['XX'], count: 2 })).toBe(false);
  });
});

describe('mergedSeconds', () => {
  it('merges overlapping and adjacent intervals', () => {
    const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 10, m));
    expect(mergedSeconds([{ from: t(0), to: t(10) }, { from: t(5), to: t(20) }, { from: t(30), to: t(40) }])).toBe(30 * 60);
    expect(mergedSeconds([])).toBe(0);
  });
});
