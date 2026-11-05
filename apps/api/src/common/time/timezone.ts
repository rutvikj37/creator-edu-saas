/**
 * True for any IANA time zone the runtime can format, including aliases such as Asia/Kolkata
 * (some ICU builds list only the legacy Asia/Calcutta in Intl.supportedValuesOf).
 */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
