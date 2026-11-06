import { http } from '../services/api/client.js';

/**
 * First-party site analytics for academy pages: a random visitor id kept in this browser,
 * first-touch UTM/referrer attribution (30 days), page views and checkout starts. No cookies
 * shared with anyone, no third-party scripts, and nothing is sent when Do Not Track is on.
 */
const VISITOR_KEY = 'ce_vid';
const ATTR_KEY = 'ce_attr';
const ATTR_DAYS = 30;

const store = () => { try { return window.localStorage; } catch { return null; } };
const dnt = () => typeof navigator !== 'undefined' && (navigator.doNotTrack === '1' || window.doNotTrack === '1');

export function visitorId() {
  const s = store();
  let id = s?.getItem(VISITOR_KEY);
  if (!id) {
    id = `v-${(crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, '').slice(0, 36)}`;
    s?.setItem(VISITOR_KEY, id);
  }
  return id;
}

/** Remembers where this visitor first came from (kept for 30 days). */
export function captureAttribution(search, pathname, referrer = document.referrer) {
  const s = store();
  const now = Date.now();
  try {
    const prev = JSON.parse(s?.getItem(ATTR_KEY) ?? 'null');
    if (prev && now - prev.at < ATTR_DAYS * 86_400_000) return prev;
  } catch { /* replace broken value */ }
  const p = new URLSearchParams(search);
  let referrerHost = null;
  try { const h = referrer ? new URL(referrer).hostname : null; referrerHost = h && h !== window.location.hostname ? h : null; } catch { /* ignore */ }
  const a = { at: now, source: p.get('utm_source'), medium: p.get('utm_medium'), campaign: p.get('utm_campaign'), referrerHost, landingPath: pathname };
  s?.setItem(ATTR_KEY, JSON.stringify(a));
  return a;
}

export function attribution() {
  try {
    const a = JSON.parse(store()?.getItem(ATTR_KEY) ?? 'null');
    return a ? { visitorId: visitorId(), source: a.source, medium: a.medium, campaign: a.campaign, referrerHost: a.referrerHost, landingPath: a.landingPath } : { visitorId: visitorId() };
  } catch {
    return { visitorId: visitorId() };
  }
}

export function track(type, path, item) {
  if (dnt()) return;
  const a = attribution();
  const p = new URLSearchParams(window.location.search);
  http.post('/public/track', {
    type, path, visitorId: a.visitorId, ...(item ? { item } : {}),
    source: p.get('utm_source') ?? a.source ?? undefined, medium: p.get('utm_medium') ?? a.medium ?? undefined, campaign: p.get('utm_campaign') ?? a.campaign ?? undefined,
    referrer: document.referrer || undefined,
  }).catch(() => {});
}
