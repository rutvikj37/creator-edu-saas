/** Ad and analytics tags an academy adds to its public site (TenantSetting `sales.tracking`). */
export const TRACKING_KEY = 'sales.tracking';

export interface TrackingSettings {
  metaPixelId: string | null;
  ga4Id: string | null;
  gtmId: string | null;
}

export const TRACKING_PATTERNS: Record<keyof TrackingSettings, { re: RegExp; message: string }> = {
  metaPixelId: { re: /^\d{8,20}$/, message: 'A Meta Pixel ID is 8–20 digits' },
  ga4Id: { re: /^G-[A-Z0-9]{4,16}$/, message: 'A GA4 measurement ID looks like G-XXXXXXXXXX' },
  gtmId: { re: /^GTM-[A-Z0-9]{4,12}$/, message: 'A Tag Manager container ID looks like GTM-XXXXXXX' },
};

/** Only well-formed IDs survive, so nothing else can reach the page's script tags. */
export function parseTracking(value: unknown): TrackingSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const pick = (k: keyof TrackingSettings) => (typeof v[k] === 'string' && TRACKING_PATTERNS[k].re.test(v[k] as string) ? (v[k] as string) : null);
  return { metaPixelId: pick('metaPixelId'), ga4Id: pick('ga4Id'), gtmId: pick('gtmId') };
}
