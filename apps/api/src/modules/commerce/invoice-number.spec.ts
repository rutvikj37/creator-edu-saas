import { financialYear, invoiceNumber } from './invoice-number.js';

describe('invoice numbering', () => {
  it('uses the Indian financial year', () => {
    expect(financialYear(new Date('2026-03-31T10:00:00Z'))).toBe('2025-26');
    expect(financialYear(new Date('2026-04-01T10:00:00Z'))).toBe('2026-27');
  });
  it('starts the serial at the chosen number', () => {
    expect(invoiceNumber('INV', '2026-27', 1, 1)).toBe('INV/2026-27/00001');
    expect(invoiceNumber('SPE', '2026-27', 10001, 1)).toBe('SPE/2026-27/10001');
    expect(invoiceNumber('SPE', '2026-27', 10001, 3)).toBe('SPE/2026-27/10003');
  });
});
