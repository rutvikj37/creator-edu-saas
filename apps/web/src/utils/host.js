/**
 * Which surface this page is served on. The API makes the authoritative decision from
 * the Host header; this only chooses which UI to render.
 *
 * Surfaces:
 *   admin   — dedicated Super Admin host (e.g. lmsadmin.techxsolutions.io / admin.<root>)
 *   platform — agency / client panel host (e.g. lms.techxsolutions.io / app.<root>)
 *   academy  — tenant academy sites
 */
const root = (import.meta.env.VITE_PLATFORM_ROOT_DOMAIN || 'lvh.me').toLowerCase();

/** The platform's brand domain academies get subdomains on, e.g. platform.com. */
export const PLATFORM_ROOT = root;
// VITE_APP_HOST mirrors the API's APP_HOST: an extra platform host outside the root (e.g. a separate admin domain).
const appHost = (import.meta.env.VITE_APP_HOST || '').toLowerCase();
// Dedicated Super Admin host. Defaults to admin.<root>; production sets VITE_ADMIN_HOST=lmsadmin.…
const adminHost = (import.meta.env.VITE_ADMIN_HOST || `admin.${root}`).toLowerCase();

const PLATFORM_HOSTS = new Set([
  root,
  `www.${root}`,
  `app.${root}`,
  `admin.${root}`,
  'localhost',
  '127.0.0.1',
  ...(appHost ? [appHost] : []),
  ...(adminHost ? [adminHost] : []),
]);

function currentHostname(hostname) {
  return (hostname ?? (typeof window !== 'undefined' ? window.location.hostname : 'localhost')).toLowerCase();
}

export function isAdminHost(hostname) {
  const host = currentHostname(hostname);
  return Boolean(adminHost && host === adminHost);
}

export function getSurface(hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost') {
  if (typeof window !== 'undefined') {
    const override = new URLSearchParams(window.location.search).get('surface');
    if (override === 'academy' || override === 'platform' || override === 'admin') return override;
  }
  const host = currentHostname(hostname);
  if (isAdminHost(host)) return 'admin';
  return PLATFORM_HOSTS.has(host) ? 'platform' : 'academy';
}

export const isAcademy = () => getSurface() === 'academy';
