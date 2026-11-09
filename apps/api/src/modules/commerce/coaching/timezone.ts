/** Small, dependency-free timezone helpers built on Intl (IANA zone names). */

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const fmt = new Map<string, Intl.DateTimeFormat>();
function parts(t: number, tz: string) {
  let f = fmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    fmt.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(t)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute, s: p.second };
}

/** Offset of `tz` from UTC at instant `t`, in ms (positive east of Greenwich). */
function offset(t: number, tz: string) {
  const p = parts(t, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(t / 1000) * 1000;
}

/** The UTC instant of local date y-m-d (m 1-12) at `minute` past midnight in `tz`. */
export function zonedToUtc(y: number, m: number, d: number, minute: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, 0, minute);
  let t = guess - offset(guess, tz);
  const o2 = offset(t, tz);
  if (guess - o2 !== t) t = guess - o2;
  return new Date(t);
}

/** Local calendar date in `tz` for instant `t`, plus `addDays`; weekday 0 = Sunday. */
export function localDay(t: number, tz: string, addDays = 0) {
  const p = parts(t, tz);
  const base = new Date(Date.UTC(p.y, p.m - 1, p.d + addDays));
  return { y: base.getUTCFullYear(), m: base.getUTCMonth() + 1, d: base.getUTCDate(), weekday: base.getUTCDay() };
}
