import { generatePassword } from './account-credentials.service.js';

describe('generatePassword', () => {
  it('makes 10-character passwords without look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(10);
      expect(p).not.toMatch(/[0O1lI]/);
      expect(p).toMatch(/^[A-Za-z2-9]+$/);
    }
  });

  it('does not repeat', () => {
    expect(new Set(Array.from({ length: 500 }, () => generatePassword())).size).toBe(500);
  });
});
