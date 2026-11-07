import { Check, ChevronDown, X } from 'lucide-react';
import { Dropdown, DropdownItem } from '../ui/index.js';
import { cn } from '../../utils/cn.js';

/**
 * "Filter by" pill: shows the filter name, or "Name: choice" once set, and opens a menu of choices.
 * A set filter gets a separate clear button so one click removes it.
 */
export function FilterChip({ label, value, options, onChange, panelClassName }) {
  const current = options.find((o) => o.value === value);
  return (
    <div className="inline-flex items-center">
      <Dropdown align="left" panelClassName={cn('max-h-72 overflow-y-auto', panelClassName)}
        trigger={(p) => (
          <button type="button" {...p} aria-label={current ? `${label}: ${current.label}` : label}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
              current ? 'border-primary-300 bg-primary-50 font-medium text-primary-700 dark:border-primary-500/40 dark:bg-primary-500/10 dark:text-primary-300' : 'border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg',
              current && 'rounded-r-none border-r-0 pr-2')}>
            {current ? <><span className="text-primary-600/80 dark:text-primary-300/80">{label}:</span> <span className="max-w-40 truncate">{current.label}</span></> : label}
            <ChevronDown className="size-3.5 opacity-70" aria-hidden />
          </button>
        )}>
        {options.map((o) => (
          <DropdownItem key={o.value} onClick={() => onChange(o.value)} aria-checked={o.value === value}>
            <span className={cn('flex-1', o.value === value && 'font-semibold text-fg')}>{o.label}</span>
            {o.value === value && <Check className="size-4 text-primary-600" aria-hidden />}
          </DropdownItem>
        ))}
      </Dropdown>
      {current && (
        <button type="button" onClick={() => onChange(undefined)} aria-label={`Clear ${label} filter`}
          className="inline-flex h-8 items-center rounded-r-full border border-l-0 border-primary-300 bg-primary-50 pr-2.5 pl-1 text-primary-700 hover:text-primary-900 dark:border-primary-500/40 dark:bg-primary-500/10 dark:text-primary-300">
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
