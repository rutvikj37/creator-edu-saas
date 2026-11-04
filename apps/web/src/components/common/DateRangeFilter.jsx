import { useState } from 'react';
import { cn } from '../../utils/cn.js';

const DAY = 86_400_000;
const iso = (d) => d.toISOString().slice(0, 10);

/** Preset date ranges (Today … Last month) plus a custom range. Values are YYYY-MM-DD in UTC. */
export function presetRange(key, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  switch (key) {
    case 'today': return { from: iso(today), to: iso(today) };
    case 'yesterday': { const y = new Date(today.getTime() - DAY); return { from: iso(y), to: iso(y) }; }
    case '7d': return { from: iso(new Date(today.getTime() - 6 * DAY)), to: iso(today) };
    case '90d': return { from: iso(new Date(today.getTime() - 89 * DAY)), to: iso(today) };
    case 'month': return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: iso(today) };
    case 'lastMonth': {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      return { from: iso(start), to: iso(end) };
    }
    default: return { from: iso(new Date(today.getTime() - 29 * DAY)), to: iso(today) };
  }
}

const PRESETS = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['month', 'This month'], ['lastMonth', 'Last month'], ['custom', 'Custom'],
];

export function DateRangeFilter({ value, onChange }) {
  const [custom, setCustom] = useState({ from: value.from, to: value.to });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Date range" className="flex flex-wrap rounded-md border border-line bg-surface p-0.5">
        {PRESETS.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={value.preset === key}
            onClick={() => (key === 'custom' ? onChange({ preset: 'custom', ...custom }) : onChange({ preset: key, ...presetRange(key) }))}
            className={cn('rounded px-2.5 py-1 text-xs font-medium', value.preset === key ? 'bg-primary-600 text-on-primary' : 'text-fg-2 hover:bg-surface-2')}>
            {label}
          </button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <div className="flex items-center gap-1.5 text-xs">
          <input type="date" aria-label="From" value={custom.from} max={custom.to} onChange={(e) => { const n = { ...custom, from: e.target.value }; setCustom(n); onChange({ preset: 'custom', ...n }); }}
            className="h-8 rounded-md border border-line bg-surface px-2" />
          <span className="text-muted">to</span>
          <input type="date" aria-label="To" value={custom.to} min={custom.from} onChange={(e) => { const n = { ...custom, to: e.target.value }; setCustom(n); onChange({ preset: 'custom', ...n }); }}
            className="h-8 rounded-md border border-line bg-surface px-2" />
        </div>
      )}
    </div>
  );
}
