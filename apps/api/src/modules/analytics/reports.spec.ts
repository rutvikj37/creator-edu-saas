import { change, MOBILE_UA, sessionSeconds } from './reports.js';

describe('reports helpers', () => {
  it('counts session time with a 4-hour cap', () => {
    const t = new Date('2026-11-09T10:00:00Z');
    expect(sessionSeconds(t, new Date('2026-11-09T10:12:30Z'))).toBe(750);
    expect(sessionSeconds(t, new Date('2026-11-10T10:00:00Z'))).toBe(4 * 3600);
    expect(sessionSeconds(t, new Date('2026-11-09T09:00:00Z'))).toBe(0);
  });
  it('computes change vs the previous period', () => {
    expect(change(2, 1)).toBe(100);
    expect(change(3, 4)).toBe(-25);
    expect(change(5, 0)).toBe(100);
    expect(change(0, 0)).toBeNull();
  });
  it('tells mobile browsers from desktop ones', () => {
    expect(MOBILE_UA.test('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
    expect(MOBILE_UA.test('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130')).toBe(false);
  });
});
