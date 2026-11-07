import { presetRange } from '../components/common/DateRangeFilter.jsx';

/** "Date created" choices for client-side Filter-by chips. */
export const PERIOD_OPTIONS = [
  { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: '90d', label: 'Last 90 days' },
  { value: 'month', label: 'This month' }, { value: 'lastMonth', label: 'Last month' },
];

/** True when `date` falls inside the preset period (whole UTC days, inclusive). No period = always true. */
export function inPeriod(date, key, now = new Date()) {
  if (!key) return true;
  if (!date) return false;
  const { from, to } = presetRange(key, now);
  const day = new Date(date).toISOString().slice(0, 10);
  return day >= from && day <= to;
}

/** Status choices built from the values present in a list. */
export const statusOptions = (rows, key = 'status') =>
  [...new Set(rows.map((r) => r[key]).filter(Boolean))].map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase().replace(/_/g, ' ') }));
