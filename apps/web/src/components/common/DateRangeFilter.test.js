import { presetRange } from './DateRangeFilter.jsx';

describe('presetRange', () => {
  const now = new Date('2026-03-15T10:00:00Z');
  it('computes presets in UTC', () => {
    expect(presetRange('today', now)).toEqual({ from: '2026-03-15', to: '2026-03-15' });
    expect(presetRange('7d', now)).toEqual({ from: '2026-03-09', to: '2026-03-15' });
    expect(presetRange('month', now)).toEqual({ from: '2026-03-01', to: '2026-03-15' });
    expect(presetRange('lastMonth', now)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});
