import { isTimeZone, localDay, zonedToUtc } from './timezone.js';

describe('timezone helpers', () => {
  it('converts local wall time to UTC for fixed and DST zones', () => {
    expect(zonedToUtc(2026, 11, 9, 10 * 60, 'Asia/Kolkata').toISOString()).toBe('2026-11-09T04:30:00.000Z');
    expect(zonedToUtc(2026, 7, 1, 9 * 60, 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z'); // EDT
    expect(zonedToUtc(2026, 12, 1, 9 * 60, 'America/New_York').toISOString()).toBe('2026-12-01T14:00:00.000Z'); // EST
  });
  it('gives the local day and weekday, also across midnight', () => {
    expect(localDay(Date.parse('2026-11-08T20:00:00Z'), 'Asia/Kolkata')).toEqual({ y: 2026, m: 11, d: 9, weekday: 1 });
    expect(localDay(Date.parse('2026-11-08T20:00:00Z'), 'UTC', 2)).toEqual({ y: 2026, m: 11, d: 10, weekday: 2 });
  });
  it('validates zone names', () => {
    expect(isTimeZone('Asia/Kolkata')).toBe(true);
    expect(isTimeZone('Mars/Base')).toBe(false);
  });
});
