/** Pure helpers for the Reports page (unit-tested). */

export const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i;
/** A playback session longer than this is counted as this (a tab left open isn't learning). */
export const MAX_SESSION_SECONDS = 4 * 3600;

export function sessionSeconds(createdAt: Date, lastSeenAt: Date) {
  return Math.max(0, Math.min(MAX_SESSION_SECONDS, Math.round((lastSeenAt.getTime() - createdAt.getTime()) / 1000)));
}

/** Percentage change from `prev` to `cur`, one decimal; null when there is nothing to compare with. */
export function change(cur: number, prev: number) {
  if (!prev) return cur ? 100 : null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}
