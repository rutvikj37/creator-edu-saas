import { useEffect } from 'react';

function upsert(selector, create) {
  let el = document.head.querySelector(selector);
  const created = !el;
  if (!el) { el = create(); document.head.appendChild(el); }
  return { el, created };
}

/**
 * Sets the document title, description, canonical link, Open Graph / Twitter tags and JSON-LD
 * for a public page, and restores what was there on unmount.
 */
export function useSeo({ title, description, canonical, image, jsonLd }) {
  const ld = jsonLd ? JSON.stringify(jsonLd) : '';
  useEffect(() => {
    if (!title) return undefined;
    const prevTitle = document.title;
    document.title = title;
    const undo = [() => { document.title = prevTitle; }];
    const meta = (attr, key, content) => {
      if (!content) return;
      const { el, created } = upsert(`meta[${attr}="${key}"]`, () => { const m = document.createElement('meta'); m.setAttribute(attr, key); return m; });
      const prev = el.getAttribute('content');
      el.setAttribute('content', content);
      undo.push(() => { if (created) el.remove(); else if (prev !== null) el.setAttribute('content', prev); });
    };
    meta('name', 'description', description);
    meta('name', 'robots', 'index, follow, max-image-preview:large');
    meta('property', 'og:type', 'website');
    meta('property', 'og:title', title);
    meta('property', 'og:description', description);
    meta('property', 'og:url', canonical);
    meta('property', 'og:image', image);
    meta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    meta('name', 'twitter:title', title);
    meta('name', 'twitter:description', description);
    if (canonical) {
      const { el, created } = upsert('link[rel="canonical"]', () => { const l = document.createElement('link'); l.setAttribute('rel', 'canonical'); return l; });
      const prev = el.getAttribute('href');
      el.setAttribute('href', canonical);
      undo.push(() => { if (created) el.remove(); else if (prev !== null) el.setAttribute('href', prev); });
    }
    if (ld) {
      // A JSON-LD data block is not executed, so the strict script-src policy does not apply to it.
      const s = document.createElement('script');
      s.type = 'application/ld+json';
      s.dataset.seo = 'page';
      s.textContent = ld;
      document.head.appendChild(s);
      undo.push(() => s.remove());
    }
    return () => undo.forEach((fn) => fn());
  }, [title, description, canonical, image, ld]);
}
