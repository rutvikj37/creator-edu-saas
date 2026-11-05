import { useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '../../utils/cn.js';

/** Read-only stars for an average (rounded to the nearest half for display). */
export function Stars({ value, size = 'size-4', className }) {
  const v = Math.round((Number(value) || 0) * 2) / 2;
  return (
    <span className={cn('inline-flex items-center', className)} role="img" aria-label={`${Number(value || 0).toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="relative">
          <Star className={cn(size, 'text-line-strong')} aria-hidden />
          {v >= i - 0.5 && <span className="absolute inset-0 overflow-hidden" style={{ width: v >= i ? '100%' : '50%' }}><Star className={cn(size, 'fill-amber-400 text-amber-400')} aria-hidden /></span>}
        </span>
      ))}
    </span>
  );
}

/** Average + count, e.g. "4.6 ★★★★★ (23)". Renders nothing without ratings. */
export function RatingSummary({ average, count, className }) {
  if (!count) return null;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
      <span className="font-semibold text-amber-700 dark:text-amber-400">{Number(average).toFixed(1)}</span>
      <Stars value={average} size="size-3.5" />
      <span className="text-muted">({count})</span>
    </span>
  );
}

/** Accessible 1–5 star picker (radio group). */
export function StarInput({ value, onChange, label = 'Your rating' }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  const words = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <label key={i} className="cursor-pointer" onMouseEnter={() => setHover(i)}>
            <input type="radio" name="rating" value={i} checked={value === i} onChange={() => onChange(i)} className="sr-only" aria-label={`${i} star${i > 1 ? 's' : ''}`} />
            <Star className={cn('size-7 transition-colors', i <= shown ? 'fill-amber-400 text-amber-400' : 'text-line-strong')} aria-hidden />
          </label>
        ))}
        <span className="ml-2 text-sm text-muted">{words[shown]}</span>
      </div>
    </fieldset>
  );
}
