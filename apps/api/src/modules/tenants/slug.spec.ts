import { isValidSlug, slugify } from './slug.js';

describe('slugify', () => {
  it('produces DNS-safe slugs', () => {
    expect(slugify('Riya’s Coding Académie!!')).toBe('riya-s-coding-academie');
    expect(slugify('  ')).toBe('academy-new');
    expect(slugify('AB')).toBe('academy-ab');
    expect(slugify('x'.repeat(80))).toHaveLength(40);
  });
  it('rejects reserved and malformed slugs', () => {
    expect(isValidSlug('api')).toBe(false);
    expect(isValidSlug('-bad')).toBe(false);
    expect(isValidSlug('a--b')).toBe(false);
    expect(isValidSlug('good-slug')).toBe(true);
  });
});
