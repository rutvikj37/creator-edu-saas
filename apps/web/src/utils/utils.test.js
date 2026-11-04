import { formatDate, formatMoney, initials } from './format.js';
import { ApiError, toApiError } from '../services/api/client.js';

describe('format', () => {
  it('formats money using the record currency, not a hardcoded symbol', () => {
    expect(formatMoney(1499, 'INR', 'en-IN')).toBe('₹1,499.00');
    expect(formatMoney('20.5', 'USD', 'en-US')).toBe('$20.50');
    expect(formatMoney(10, null)).toBe('—');
  });
  it('formats dates in a given time zone', () => {
    expect(formatDate('2026-01-01T20:00:00Z', { locale: 'en-GB', timeZone: 'Asia/Kolkata' })).toBe('2 Jan 2026');
    expect(formatDate('garbage')).toBe('—');
  });
  it('builds initials', () => {
    expect(initials('Diya Patel')).toBe('DP');
  });
});

describe('toApiError', () => {
  it('reads the API error envelope', () => {
    const e = toApiError({ response: { status: 422, data: { success: false, error: { code: 'VALIDATION_FAILED', message: 'Invalid', details: [{ field: 'email', message: 'bad' }] } } } });
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 422, code: 'VALIDATION_FAILED', details: [{ field: 'email', message: 'bad' }] });
  });
  it('reports network failures distinctly', () => {
    expect(toApiError(new Error('Network Error')).code).toBe('NETWORK');
  });
});
