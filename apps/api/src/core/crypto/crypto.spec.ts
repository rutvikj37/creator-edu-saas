import { base32Decode, base32Encode, hotp, verifyTotp, totp, generateTotpSecret } from './totp.js';
import { CryptoService, randomDigits, sha256 } from './crypto.service.js';

describe('TOTP (RFC 6238)', () => {
  // RFC 4226 Appendix D test vectors for secret "12345678901234567890"
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches RFC 4226 HOTP vectors', () => {
    expect(['755224', '287082', '359152', '969429', '338314'].map((_, i) => hotp(secret, i))).toEqual(['755224', '287082', '359152', '969429', '338314']);
  });
  it('round-trips base32', () => {
    expect(base32Decode(base32Encode(Buffer.from('hello world'))).toString()).toBe('hello world');
  });
  it('verifies within ±1 step and rejects others', () => {
    const s = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(s, totp(s, now - 30_000), now)).not.toBeNull();
    expect(verifyTotp(s, totp(s, now - 120_000), now)).toBeNull();
    expect(verifyTotp(s, 'abcdef', now)).toBeNull();
  });
});

describe('CryptoService', () => {
  const svc = new CryptoService({ get: () => Buffer.alloc(32, 9).toString('base64') } as any);
  it('encrypts and decrypts', () => {
    const c = svc.encrypt('secret-value');
    expect(c).not.toContain('secret-value');
    expect(svc.decrypt(c)).toBe('secret-value');
  });
  it('detects tampering', () => {
    const c = svc.encrypt('x');
    const parts = c.split('.');
    parts[3] = Buffer.from('y').toString('base64url');
    expect(() => svc.decrypt(parts.join('.'))).toThrow();
  });
  it('helpers', () => {
    expect(randomDigits(6)).toMatch(/^\d{6}$/);
    expect(sha256('a')).toHaveLength(64);
  });
});
