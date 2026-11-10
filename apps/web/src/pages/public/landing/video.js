/** Turns a demo-video link into something embeddable under the site's content security policy. */
export function demoVideo(url) {
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '');
  const id = (v) => (/^[\w-]{6,20}$/.test(v ?? '') ? v : null);
  if (host === 'youtu.be') { const v = id(u.pathname.slice(1)); return v ? { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${v}?autoplay=1&rel=0` } : null; }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'm.youtube.com') {
    const v = id(u.searchParams.get('v') ?? u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/)?.[1]);
    return v ? { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${v}?autoplay=1&rel=0` } : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const v = u.pathname.match(/(\d{6,12})/)?.[1];
    return v ? { kind: 'iframe', src: `https://player.vimeo.com/video/${v}?autoplay=1` } : null;
  }
  if (/\.(mp4|webm)$/i.test(u.pathname)) return { kind: 'file', src: u.toString() };
  return null;
}
