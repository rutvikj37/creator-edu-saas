/**
 * Which surface this page is served on. The API makes the authoritative decision from
 * the Host header; this only chooses which UI to render.
 */
const root = (import.meta.env.VITE_PLATFORM_ROOT_DOMAIN || 'lvh.me').toLowerCase();

/** The platform's brand domain academies get subdomains on, e.g. platform.com. */
export const PLATFORM_ROOT = root;
const PLATFORM_HOSTS = new Set([root, `www.${root}`, `app.${root}`, `admin.${root}`, 'localhost', '127.0.0.1']);

export function getSurface(hostname = window.location.hostname) {
  return PLATFORM_HOSTS.has(hostname.toLowerCase()) ? 'platform' : 'academy';
}

export const isAcademy = () => getSurface() === 'academy';
