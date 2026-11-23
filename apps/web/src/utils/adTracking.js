import { useEffect } from 'react';

/**
 * Ad-platform tags an academy configured under Growth → Tracking pixels: Meta Pixel, Google
 * Analytics 4 and Google Tag Manager. Loaded only on academy pages, never when Do Not Track is
 * on. Events fired before the tags load are queued and replayed once they do.
 */
let config = null;
const pending = [];

const dnt = () => typeof navigator !== 'undefined' && (navigator.doNotTrack === '1' || window.doNotTrack === '1');
const store = () => { try { return window.localStorage; } catch { return null; } };

function script(src) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

function loadMeta(id) {
  if (window.fbq) return;
  const fbq = function (...args) { fbq.callMethod ? fbq.callMethod(...args) : fbq.queue.push(args); };
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  window.fbq = fbq;
  window._fbq = fbq;
  script('https://connect.facebook.net/en_US/fbevents.js');
  window.fbq('init', id);
}

function loadGa4(id) {
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) window.gtag = function () { window.dataLayer.push(arguments); };
  script(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
  window.gtag('js', new Date());
  window.gtag('config', id, { send_page_view: false });
}

function loadGtm(id) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  script(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`);
}

export function initAdTracking(tracking) {
  if (config || !tracking || typeof window === 'undefined' || dnt()) return;
  const { metaPixelId, ga4Id, gtmId } = tracking;
  if (!metaPixelId && !ga4Id && !gtmId) return;
  config = { metaPixelId, ga4Id, gtmId };
  if (metaPixelId) loadMeta(metaPixelId);
  if (ga4Id) loadGa4(ga4Id);
  if (gtmId) loadGtm(gtmId);
  pending.splice(0).forEach(([name, data]) => adEvent(name, data));
}

const GA_NAMES = { PageView: 'page_view', ViewContent: 'view_item', AddToCart: 'add_to_cart', InitiateCheckout: 'begin_checkout', Purchase: 'purchase' };

/**
 * Sends one event to every configured tag.
 * `data`: { value, currency, items: [{ id, title, kind }], orderId } — all optional.
 */
export function adEvent(name, data = {}) {
  if (typeof window === 'undefined' || dnt()) return;
  if (!config) {
    if (pending.length < 20) pending.push([name, data]);
    return;
  }
  const items = (data.items ?? []).map((i) => ({ item_id: i.id, item_name: i.title, item_category: i.kind, price: i.unit !== undefined ? Number(i.unit) : undefined }));
  const money = data.value !== undefined ? { value: Number(data.value), currency: data.currency } : {};
  if (name === 'Purchase' && data.orderId) {
    const key = `ce_px_${data.orderId}`;
    if (store()?.getItem(key)) return;
    store()?.setItem(key, '1');
  }
  if (config.metaPixelId && window.fbq) {
    const params = name === 'PageView' ? undefined : { ...money, content_type: 'product', content_ids: items.map((i) => i.item_id), ...(items.length === 1 ? { content_name: items[0].item_name } : {}), num_items: items.length || undefined };
    window.fbq('track', name, params, data.orderId ? { eventID: `order-${data.orderId}` } : undefined);
  }
  const gaName = GA_NAMES[name];
  const gaParams = name === 'PageView'
    ? { page_path: window.location.pathname, page_location: window.location.href, page_title: document.title }
    : { ...money, items, ...(data.orderId ? { transaction_id: data.orderId } : {}) };
  if (config.ga4Id && window.gtag) window.gtag('event', gaName, gaParams);
  if (config.gtmId) {
    window.dataLayer = window.dataLayer || [];
    if (name !== 'PageView') window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push(name === 'PageView' ? { event: gaName, ...gaParams } : { event: gaName, ecommerce: gaParams });
  }
}

/** Fires ViewContent once per item page view. `item`: { id, title, priceAmount, currency }. */
export function useAdViewContent(kind, item) {
  useEffect(() => {
    if (!item?.id) return;
    adEvent('ViewContent', { value: item.priceAmount ?? 0, currency: item.currency ?? 'INR', items: [{ id: item.id, title: item.title, kind }] });
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const adAddToCart = (kind, item) => adEvent('AddToCart', { value: item.priceAmount ?? 0, currency: item.currency ?? 'INR', items: [{ id: item.id, title: item.title, kind }] });
