/** Weekly recurrence that keeps the local wall-clock time in the class's time zone (DST-safe). */
export const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface Recurrence {
  freq: 'WEEKLY';
  byDay: Weekday[];
  /** Last date (inclusive, YYYY-MM-DD in the class time zone). */
  until?: string | null;
  /** Total number of sessions, including the first. */
  count?: number | null;
}

export const MATERIALIZE_DAYS = 90;
export const MAX_SESSIONS = 200;

function parts(date: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour, mm: +o.minute, ss: +o.second, weekday: WEEKDAYS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday)] };
}

function offsetMs(at: number, timeZone: string) {
  const p = parts(new Date(at), timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(at / 1000) * 1000;
}

/** The UTC instant of a local wall-clock time in a time zone. */
export function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMs(guess, timeZone);
  t = guess - offsetMs(t, timeZone);
  return new Date(t);
}

export function localDate(date: Date, timeZone: string) {
  const p = parts(date, timeZone);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Session start times from `first` up to `horizon` (and `until`/`count`). Without recurrence: just `first`. */
export function occurrences(first: Date, timeZone: string, rec: Recurrence | null | undefined, horizon: Date): Date[] {
  if (!rec) return [first];
  const p0 = parts(first, timeZone);
  const days = new Set(rec.byDay.length ? rec.byDay : [p0.weekday]);
  // The chosen start is always the first session (like DTSTART), even off the repeat days.
  const out: Date[] = [first];
  if (rec.count === 1 || first > horizon) return out;
  const cursor = new Date(Date.UTC(p0.y, p0.m - 1, p0.d));
  for (let i = 0; i < 800 && out.length < MAX_SESSIONS; i++) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth() + 1;
    const d = cursor.getUTCDate();
    const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (rec.until && ymd > rec.until) break;
    if (days.has(WEEKDAYS[cursor.getUTCDay()])) {
      const at = zonedTimeToUtc(y, m, d, p0.hh, p0.mm, timeZone);
      if (at > horizon) break;
      // Later occurrences only: same-day repeats are already covered by `first`.
      if (at.getTime() > first.getTime() + 60_000 && i > 0) out.push(at);
      if (rec.count && out.length >= rec.count) break;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function validRecurrence(r: unknown): r is Recurrence {
  if (r === null || r === undefined) return true;
  const x = r as Recurrence;
  return x.freq === 'WEEKLY' && Array.isArray(x.byDay) && x.byDay.length > 0 && x.byDay.every((d) => (WEEKDAYS as readonly string[]).includes(d))
    && (x.until === undefined || x.until === null || /^\d{4}-\d{2}-\d{2}$/.test(x.until))
    && (x.count === undefined || x.count === null || (Number.isInteger(x.count) && x.count >= 1 && x.count <= MAX_SESSIONS))
    && Boolean(x.until || x.count);
}

/** Total seconds covered by possibly overlapping intervals (reconnects, multiple tabs). */
export function mergedSeconds(intervals: { from: Date; to: Date }[]) {
  const sorted = intervals.filter((i) => i.to > i.from).sort((a, b) => a.from.getTime() - b.from.getTime());
  let total = 0;
  let curFrom = 0;
  let curTo = 0;
  for (const i of sorted) {
    const f = i.from.getTime();
    const t = i.to.getTime();
    if (f > curTo) {
      total += curTo - curFrom;
      curFrom = f;
      curTo = t;
    } else curTo = Math.max(curTo, t);
  }
  total += curTo - curFrom;
  return Math.round(total / 1000);
}
