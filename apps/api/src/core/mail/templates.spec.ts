import { emailTemplates, escapeHtml } from './templates.js';

describe('email templates', () => {
  it('escapes user-controlled values', () => {
    const e = emailTemplates.verifyEmail({ brand: 'A&B', name: '<script>x</script>', url: 'https://x.test/?a=1&b=2', code: '123456' });
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.html).toContain('a=1&amp;b=2');
    expect(escapeHtml(`"'`)).toBe('&quot;&#39;');
  });

  it('renders login details after guest checkout', () => {
    const e = emailTemplates.accountCredentials({ brand: 'Acme', name: 'Asha', email: 'asha@example.test', password: 'Kp7mX2qWa9', items: ['Algebra', 'Geometry'], url: 'https://acme.example.test/login' });
    expect(e.subject).toBe('Your Acme login details');
    expect(e.html).toContain('asha@example.test');
    expect(e.html).toContain('Kp7mX2qWa9');
    expect(e.html).toContain('<li>Algebra</li>');
    expect(e.html).toContain('https://acme.example.test/login');
    expect(e.text).toContain('Kp7mX2qWa9');
  });

  it('renders student invite with academy reset link and courses', () => {
    const e = emailTemplates.studentInvite({
      brand: 'Acme',
      name: 'Asha',
      url: 'https://acme.lvh.me:5173/reset-password?token=abc',
      courses: 'You have access to:\n\n- Algebra',
    });
    expect(e.subject).toBe('Your account at Acme');
    expect(e.html).toContain('https://acme.lvh.me:5173/reset-password?token=abc');
    expect(e.html).toContain('Algebra');
    expect(e.text).toContain('Set your password:');
  });
});
