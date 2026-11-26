/**
 * Parse and normalise YouTube / Google Drive video links for the asset library.
 *
 * Thumbnails:
 * - YouTube: img.youtube.com (always available for public videos).
 * - Drive: drive.google.com/thumbnail (works only when the file is shared so
 *   "anyone with the link" can view; private files return a broken image).
 */

export type ExternalVideoProvider = 'YOUTUBE' | 'GOOGLE_DRIVE';

export type ParsedExternalVideo = {
  provider: ExternalVideoProvider;
  /** Stable id stored as VideoAsset.providerAssetId */
  providerAssetId: string;
  /** Canonical https URL stored as VideoAsset.externalUrl */
  externalUrl: string;
  /** Privacy-friendly embed URL for the student player */
  embedUrl: string;
  /** Best-effort poster image URL (may 404 for private Drive files) */
  thumbnailUrl: string | null;
  suggestedTitle: string | null;
};

const DRIVE_HOSTS = /^(?:www\.)?(?:drive\.google\.com|docs\.google\.com)$/i;

function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./i, '');
  if (/^youtu\.be$/i.test(host)) {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && /^[\w-]{6,}$/.test(id) ? id : null;
  }
  if (!/youtube\.com$/i.test(host) && !/youtube-nocookie\.com$/i.test(host)) return null;
  const v = url.searchParams.get('v');
  if (v && /^[\w-]{6,}$/.test(v)) return v;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0].toLowerCase()) && /^[\w-]{6,}$/.test(parts[1])) {
    return parts[1];
  }
  return null;
}

function driveFileId(url: URL): string | null {
  if (!DRIVE_HOSTS.test(url.hostname)) return null;
  const fileMatch = /\/file\/d\/([a-zA-Z0-9_-]{10,})/.exec(url.pathname);
  if (fileMatch) return fileMatch[1];
  const openId = url.searchParams.get('id');
  if (openId && /^[a-zA-Z0-9_-]{10,}$/.test(openId)) return openId;
  return null;
}

/** Returns null when the URL is not a supported YouTube or Drive video link. */
export function parseExternalVideoUrl(raw: string): ParsedExternalVideo | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.protocol = 'https:';

  const yt = youtubeId(url);
  if (yt) {
    return {
      provider: 'YOUTUBE',
      providerAssetId: yt,
      externalUrl: `https://www.youtube.com/watch?v=${yt}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}`,
      thumbnailUrl: `https://img.youtube.com/vi/${yt}/hqdefault.jpg`,
      suggestedTitle: null,
    };
  }

  const drive = driveFileId(url);
  if (drive) {
    return {
      provider: 'GOOGLE_DRIVE',
      providerAssetId: drive,
      externalUrl: `https://drive.google.com/file/d/${drive}/view`,
      embedUrl: `https://drive.google.com/file/d/${drive}/preview`,
      thumbnailUrl: `https://drive.google.com/thumbnail?id=${drive}&sz=w1280`,
      suggestedTitle: null,
    };
  }

  return null;
}

export function isExternalProvider(provider: string): provider is ExternalVideoProvider {
  return provider === 'YOUTUBE' || provider === 'GOOGLE_DRIVE';
}

/** Best-effort YouTube oEmbed title (and confirm the video exists). Never throws. */
export async function fetchYouTubeMeta(externalUrl: string, fetchImpl: typeof fetch = fetch): Promise<{ title: string | null; thumbnailUrl: string | null }> {
  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(externalUrl)}&format=json`;
    const res = await fetchImpl(endpoint, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return { title: null, thumbnailUrl: null };
    const body = (await res.json()) as { title?: string; thumbnail_url?: string };
    return {
      title: typeof body.title === 'string' ? body.title.slice(0, 200) : null,
      thumbnailUrl: typeof body.thumbnail_url === 'string' ? body.thumbnail_url.slice(0, 1024) : null,
    };
  } catch {
    return { title: null, thumbnailUrl: null };
  }
}

/**
 * Drive has no public oEmbed. We keep the thumbnail URL; the browser will show a
 * broken image if the file is not shared publicly. Optionally HEAD the thumbnail.
 */
export async function probeDriveThumbnail(thumbnailUrl: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(thumbnailUrl, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5_000) });
    if (res.ok || res.status === 302 || res.status === 301) return thumbnailUrl;
    const get = await fetchImpl(thumbnailUrl, { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(5_000) });
    return get.ok || get.status === 206 ? thumbnailUrl : null;
  } catch {
    return thumbnailUrl;
  }
}
