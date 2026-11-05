import { matchesSignature, multipartPlan, safeFileName } from './file-rules.js';
import { StorageService } from './storage.service.js';

describe('file signatures', () => {
  it('detects real file types and rejects mismatches', () => {
    expect(matchesSignature('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(true);
    expect(matchesSignature('application/pdf', Buffer.from('%PDF-1.7\n'))).toBe(true);
    expect(matchesSignature('image/png', Buffer.from('%PDF-1.7\n'))).toBe(false);
    expect(matchesSignature('image/svg+xml', Buffer.from('<svg>'))).toBe(false);
    expect(matchesSignature('text/plain', Buffer.from('hello'))).toBe(true);
    expect(matchesSignature('text/plain', Buffer.from([0x68, 0x00, 0x69]))).toBe(false);
  });
  it('sanitises file names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeFileName('My Notes (final).pdf')).toBe('My Notes _final_.pdf');
  });
});

describe('local storage tokens', () => {
  const svc = new StorageService({ get: (k: string) => ({ STORAGE_DRIVER: 'local', LOCAL_STORAGE_DIR: '/tmp/ce-test-storage', JWT_ACCESS_SECRET: 'x'.repeat(40) } as any)[k] } as any);
  it('verifies signature and expiry', () => {
    const t = svc.createLocalToken({ op: 'get', key: 'tenants/a/b.png', exp: Date.now() + 1000 });
    expect(svc.verifyLocalToken(t)?.key).toBe('tenants/a/b.png');
    expect(svc.verifyLocalToken(t.slice(0, -2) + 'xx')).toBeNull();
    expect(svc.verifyLocalToken(svc.createLocalToken({ op: 'get', key: 'k', exp: Date.now() - 1 }))).toBeNull();
  });
});

describe('multipartPlan', () => {
  it('uses 8 MiB parts and caps at 10,000 parts', () => {
    expect(multipartPlan(200 * 1024 * 1024)).toEqual({ partSize: 8 * 1024 * 1024, partCount: 25 });
    const big = multipartPlan(200 * 1024 ** 3);
    expect(big.partCount).toBeLessThanOrEqual(10_000);
  });
});
