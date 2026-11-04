import { RESERVED_SLUGS } from '../../core/tenancy/host-resolver.service.js';

/** DNS-safe academy slug: lowercase letters, digits and single hyphens, 3–40 chars. */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base.length >= 3 ? base : `academy-${base || 'new'}`.slice(0, 40);
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug) && !slug.includes('--') && !RESERVED_SLUGS.has(slug);
}
