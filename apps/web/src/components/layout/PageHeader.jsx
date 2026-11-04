import { useEffect } from 'react';
import { Breadcrumbs } from '../ui/index.js';

/** Page title block with breadcrumbs and actions; also sets document.title. */
export function PageHeader({ title, description, breadcrumbs, actions }) {
  useEffect(() => {
    if (typeof title === 'string') document.title = `${title} · Creator Education`;
  }, [title]);
  return (
    <div className="mb-6 space-y-3">
      <Breadcrumbs items={breadcrumbs} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
