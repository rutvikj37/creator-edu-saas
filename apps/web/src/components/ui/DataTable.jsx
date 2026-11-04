import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { EmptyState, ErrorState, Skeleton } from './Feedback.jsx';
import { Pagination } from './Navigation.jsx';

/**
 * Server-driven table. Sorting/pagination state lives in the URL or parent, and is sent
 * to the API (`sort=-createdAt`, `page`), so large datasets are never loaded client-side.
 * On small screens rows collapse into stacked cards.
 */
export function DataTable({ columns, rows, rowKey = 'id', loading, error, onRetry, sort, onSortChange, meta, onPageChange, empty, onRowClick }) {
  const toggleSort = (key) => {
    if (!onSortChange) return;
    onSortChange(sort === key ? `-${key}` : sort === `-${key}` ? undefined : key);
  };
  const sortIcon = (key) =>
    sort === key ? <ArrowUp className="size-3.5" /> : sort === `-${key}` ? <ArrowDown className="size-3.5" /> : <ArrowUpDown className="size-3.5 opacity-40" />;

  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  return (
    <div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-surface-2/60 text-xs font-medium tracking-wide text-muted uppercase">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn('px-4 py-2.5 font-medium', c.align === 'right' && 'text-right', c.className)}
                  aria-sort={sort === c.key ? 'ascending' : sort === `-${c.key}` ? 'descending' : undefined}>
                  {c.sortable ? (
                    <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 uppercase hover:text-fg">
                      {c.header}
                      {sortIcon(c.key)}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c.key} className="px-4 py-3">
                        <Skeleton className="h-4 w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr key={row[rowKey]} onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn('transition-colors hover:bg-surface-2/60', onRowClick && 'cursor-pointer')}>
                    {columns.map((c) => (
                      <td key={c.key} className={cn('px-4 py-3 text-fg-2', c.align === 'right' && 'text-right tabular-nums', c.className)}>
                        {c.cell ? c.cell(row) : row[c.key]}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line md:hidden">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="space-y-2 p-4">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </li>
            ))
          : rows.map((row) => (
              <li key={row[rowKey]} className="space-y-1 p-4" onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map((c) => (
                  <div key={c.key} className="flex justify-between gap-4 text-sm">
                    <span className="text-muted">{c.header}</span>
                    <span className="text-right text-fg-2">{c.cell ? c.cell(row) : row[c.key]}</span>
                  </div>
                ))}
              </li>
            ))}
      </ul>

      {!loading && rows.length === 0 && (empty ?? <EmptyState title="No results" description="Try adjusting your search or filters." />)}
      {meta && onPageChange && rows.length > 0 && (
        <div className="border-t border-line px-3">
          <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} onPageChange={onPageChange} />
        </div>
      )}
    </div>
  );
}
