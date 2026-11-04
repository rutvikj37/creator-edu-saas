import { dailySeries, resolveRange } from './dashboard.service.js';

describe('dashboard helpers', () => {
  it('zero-fills daily series', () => {
    const { start, end } = resolveRange('2026-01-01', '2026-01-03');
    expect(dailySeries(start, end, [{ day: '2026-01-02', count: 4n }])).toEqual([
      { date: '2026-01-01', count: 0 },
      { date: '2026-01-02', count: 4 },
      { date: '2026-01-03', count: 0 },
    ]);
  });
  it('caps ranges to one year', () => {
    const { start, end } = resolveRange('2020-01-01', '2026-01-01');
    expect((end.getTime() - start.getTime()) / 86_400_000).toBeLessThanOrEqual(367);
  });
});
