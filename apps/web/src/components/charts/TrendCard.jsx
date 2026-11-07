import { useId, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Clock } from 'lucide-react';
import { Card, Skeleton } from '../ui/index.js';
import { cn } from '../../utils/cn.js';
import { formatDate, formatNumber } from '../../utils/format.js';

export function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}

/** Single-series trend line for a stat tile. Hovering shows the day's value; the tile's number is the headline. */
export function Sparkline({ points, label, format }) {
  const [hover, setHover] = useState(null);
  const gradient = useId();
  const w = 160, h = 40, pad = 3;
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v) => h - pad - (v / max) * (h - pad * 2);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const p = hover == null ? null : points[hover];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-10 w-full text-primary-600" role="img" aria-label={`${label}, daily for the last 30 days`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs><linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity="0.18" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
        <path d={`${line} L${x(points.length - 1)},${h} L${x(0)},${h} Z`} fill={`url(#${gradient})`} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {p && <line x1={x(hover)} x2={x(hover)} y1="0" y2={h} stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      {p && (
        <div className="pointer-events-none absolute -top-7 rounded-md bg-fg px-2 py-0.5 text-[11px] whitespace-nowrap text-surface shadow-sm" style={{ left: `${(hover / Math.max(1, points.length - 1)) * 100}%`, transform: 'translateX(-50%)' }}>
          {formatDate(p.date)} · {format(p.value)}
        </div>
      )}
    </div>
  );
}

export function Change({ value }) {
  if (value == null) return null;
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium', up ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400')}>
      <Icon className="size-3" aria-hidden /><span className="sr-only">{up ? 'Up' : 'Down'} </span>{Math.abs(value)}%
    </span>
  );
}

/**
 * Stat tile with an optional trend line (Graphy "Reports" style): label, "updated" time,
 * headline value, change vs the previous period, and a daily sparkline.
 */
export function TrendCard({ label, value, change, hint, series, asOf, format = (v) => formatNumber(v), loading }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-fg-2">{label}</p>
        {asOf && <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Clock className="size-3" aria-hidden />{timeAgo(asOf)}</span>}
      </div>
      {loading ? <Skeleton className="h-16" /> : (
        <>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-semibold tracking-tight tabular-nums">{format(value)}</p>
            <Change value={change} />
          </div>
          {series && <Sparkline points={series} label={label} format={format} />}
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </>
      )}
    </Card>
  );
}
