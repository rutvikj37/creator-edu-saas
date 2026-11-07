import { normalizePhone } from './creator-learning.service.js';

describe('normalizePhone', () => {
  it('strips formatting characters', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalizePhone('(022) 2345.6789')).toBe('02223456789');
  });
  it('returns null for blank values', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('  ')).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
  it('returns false for values that are not phone numbers', () => {
    expect(normalizePhone('abc')).toBe(false);
    expect(normalizePhone('12345')).toBe(false);
    expect(normalizePhone('+1234567890123456')).toBe(false);
  });
});
