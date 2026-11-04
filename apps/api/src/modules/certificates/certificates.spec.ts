import { certificateNumber } from './certificates.service.js';

describe('certificateNumber', () => {
  it('is well-formed, unambiguous and unique enough', () => {
    const n = certificateNumber(2026);
    expect(n).toMatch(/^CE-2026-[A-HJ-NP-Z2-9]{8}$/);
    expect(new Set(Array.from({ length: 2000 }, () => certificateNumber())).size).toBe(2000);
  });
});
