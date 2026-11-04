import { emailTemplates, escapeHtml } from './templates.js';

describe('email templates', () => {
  it('escapes user-controlled values', () => {
    const e = emailTemplates.verifyEmail({ brand: 'A&B', name: '<script>x</script>', url: 'https://x.test/?a=1&b=2', code: '123456' });
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.html).toContain('a=1&amp;b=2');
    expect(escapeHtml(`"'`)).toBe('&quot;&#39;');
  });
});
