import { percentChange } from './dashboard.controller.js';

describe('percentChange', () => {
  it('compares with the previous period, rounded', () => {
    expect(percentChange(3, 1)).toBe(200);
    expect(percentChange(1, 3)).toBe(-67);
    expect(percentChange(5, 5)).toBe(0);
  });
  it('is null when there is nothing to compare against', () => {
    expect(percentChange(4, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });
});
