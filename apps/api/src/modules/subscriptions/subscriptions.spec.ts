import { addInterval } from './subscriptions.service.js';

describe('addInterval', () => {
  it('adds calendar months/years in UTC', () => {
    expect(addInterval(new Date('2026-01-15T00:00:00Z'), 'MONTH').toISOString()).toBe('2026-02-15T00:00:00.000Z');
    expect(addInterval(new Date('2026-03-01T00:00:00Z'), 'YEAR').toISOString()).toBe('2027-03-01T00:00:00.000Z');
  });
});
