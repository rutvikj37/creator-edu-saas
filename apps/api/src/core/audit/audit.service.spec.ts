import { redact } from './audit.service.js';

describe('audit redact', () => {
  it('removes secrets at any depth', () => {
    const out = redact({ name: 'Plan', gateway: { apiKey: 'sk_live_x', nested: [{ password: 'p' }] }, refreshTokenHash: 'h' }) as any;
    expect(out.name).toBe('Plan');
    expect(out.gateway.apiKey).toBe('[REDACTED]');
    expect(out.gateway.nested[0].password).toBe('[REDACTED]');
    expect(out.refreshTokenHash).toBe('[REDACTED]');
  });
});
