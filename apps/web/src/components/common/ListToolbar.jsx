import { Card, Skeleton } from '../ui/index.js';
import { SearchInput } from './SearchInput.jsx';

/** Graphy-style summary tile: label, big number, one line of context. */
export function MetricCard({ label, value, hint, loading }) {
  return (
    <Card className="flex flex-col gap-2 p-5">
      <p className="text-sm font-medium text-fg-2">{label}</p>
      {loading ? <Skeleton className="h-8 w-28" /> : <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>}
      {hint && !loading && <p className="text-xs text-muted">{hint}</p>}
    </Card>
  );
}

/**
 * List header row (Graphy style): search, actions on the right, then "Filter by:" chips, a
 * Reset link when anything is filtered, and the item count. Sits at the top of the list card.
 */
export function ListToolbar({ search, onSearch, placeholder = 'Search', actions, filters, filtered, onReset, count, noun = 'item' }) {
  return (
    <div className="space-y-3 border-b border-line p-4">
      {(onSearch || actions) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {onSearch && <SearchInput className="sm:flex-1" value={search ?? ''} onChange={onSearch} placeholder={placeholder} />}
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {(filters || typeof count === 'number') && (
        <div className="flex flex-wrap items-center gap-2">
          {filters && <><span className="text-sm text-muted">Filter by:</span>{filters}</>}
          {filtered && onReset && <button type="button" className="ml-1 text-sm font-medium text-primary-700 hover:underline dark:text-primary-300" onClick={onReset}>Reset</button>}
          {typeof count === 'number' && <span className="ml-auto text-sm text-muted">{count.toLocaleString('en-IN')} {noun}{count === 1 ? '' : 's'}</span>}
        </div>
      )}
    </div>
  );
}
