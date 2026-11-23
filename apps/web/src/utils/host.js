/**
 * Which surface this page is served on. The API makes the authoritative decision from
 * the Host header; this only chooses which UI to render.
 */
const root = (import.meta.env.VITE_PLATFORM_ROOT_DOMAIN || 'lvh.me').toLowerCase();

/** The platform's brand domain academies get subdomains on, e.g. platform.com. */
export const PLATFORM_ROOT = root;
// VITE_APP_HOST mirrors the API's APP_HOST: an extra platform host outside the root (e.g. a separate admin domain).
const appHost = (import.meta.env.VITE_APP_HOST || '').toLowerCase();
const PLATFORM_HOSTS = new Set([root, `www.${root}`, `app.${root}`, `admin.${root}`, 'localhost', '127.0.0.1', ...(appHost ? [appHost] : [])]);

export function getSurface(hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost') {
  if (typeof window !== 'undefined') {
    const override = new URLSearchParams(window.location.search).get('surface');
    if (override === 'academy' || override === 'platform') return override;
  }
  return PLATFORM_HOSTS.has(hostname.toLowerCase()) ? 'platform' : 'academy';
}

export const isAcademy = () => getSurface() === 'academy';
