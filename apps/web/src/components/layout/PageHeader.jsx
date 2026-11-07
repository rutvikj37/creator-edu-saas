import { useEffect } from 'react';
import { Breadcrumbs } from '../ui/index.js';
import { formatNumber } from '../../utils/format.js';

/**
 * Page title block: large title (with an optional item count), a one-line description and the
 * page's main actions on the right. Breadcrumbs show only when they link back to a parent page — the sidebar
 * already says which section a top-level page is in. Also sets document.title.
 */
export function PageHeader({ title, description, breadcrumbs = [], actions, count }) {
  useEffect(() => {
    if (typeof title === 'string') document.title = `${title} · Creator Education`;
  }, [title]);
  return (
    <div className="mb-6 space-y-2">
      {breadcrumbs.some((b) => b.to) && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-fg sm:text-[28px] sm:leading-9">
            <span className="truncate">{title}</span>
            {typeof count === 'number' && <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-sm font-medium text-fg-2 tabular-nums">{formatNumber(count)}</span>}
          </h1>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
