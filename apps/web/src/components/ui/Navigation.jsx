import { Link } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button.jsx';
import { cn } from '../../utils/cn.js';

/** Pill-style single choice (e.g. 7 / 30 / 90 days, grid / list). */
export function SegmentedControl({ options, value, onChange, label, size = 'md', className }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-full border border-line bg-surface-2/70 p-0.5', className)}>
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} aria-label={o.icon && !o.label ? o.ariaLabel : undefined} title={o.ariaLabel} onClick={() => onChange(o.value)}
            className={cn('inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors', size === 'sm' ? 'h-7 px-3 text-xs' : 'h-8 px-3.5 text-sm',
              on ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg')}>
            {Icon && <Icon className="size-4" aria-hidden />}{o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Breadcrumbs({ items = [] }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1.5 truncate text-sm text-muted">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5 truncate">
              {i > 0 && <span aria-hidden>/</span>}
              {item.to && !last ? (
                <Link to={item.to} className="truncate hover:text-fg">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={last ? 'truncate font-medium text-fg' : 'truncate'}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Server-side pagination control driven by API `meta`. */
/** Page numbers to show around the current page, with null for a gap ("…"). */
export function pageWindow(page, pages) {
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i && p - sorted[i - 1] > 1 ? [null, p] : [p]));
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizes = [10, 20, 50, 100] }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-3 text-sm text-muted">
      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <label className="flex items-center gap-2">
            <select aria-label="Rows per page" value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-8 rounded-md border border-line bg-surface px-2 text-sm text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              {[...new Set([...pageSizes, pageSize])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="hidden sm:inline">per page</span>
          </label>
        )}
        <p>
          Showing <span className="font-medium text-fg">{from}</span>–<span className="font-medium text-fg">{to}</span> of{' '}
          <span className="font-medium text-fg">{total}</span>
        </p>
      </div>
      <nav aria-label="Pagination" className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        {pageWindow(page, pages).map((p, i) => p === null ? <span key={`gap${i}`} className="px-1">…</span> : (
          <button key={p} type="button" onClick={() => onPageChange(p)} aria-current={p === page ? 'page' : undefined} aria-label={`Page ${p}`}
            className={p === page ? 'h-8 min-w-8 rounded-md bg-primary-50 px-2 text-sm font-semibold text-primary-700 tabular-nums dark:bg-primary-500/15 dark:text-primary-300' : 'h-8 min-w-8 rounded-md px-2 text-sm text-fg-2 tabular-nums hover:bg-surface-2'}>
            {p}
          </button>
        ))}
        <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="size-4" />
        </Button>
      </nav>
    </div>
  );
}
