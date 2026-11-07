import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { Button } from './Button.jsx';

export function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-2', className)} aria-hidden />;
}

export function Spinner({ className, label = 'Loading' }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Shown when a list or page has no data yet; always explains the next step. */
/** Friendly empty state: a soft illustrated icon, a short headline, one line of help and the next action. */
export function EmptyState({ icon: Icon = Inbox, title, description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="relative" aria-hidden>
        <span className="absolute -top-2 -left-3 size-2 rounded-full bg-primary-300/70" />
        <span className="absolute -right-4 top-3 size-1.5 rounded-full bg-amber-300" />
        <span className="absolute -bottom-1 -left-5 size-1.5 rounded-full bg-emerald-300" />
        <span className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-primary-100 to-primary-50 text-primary-600 ring-8 ring-primary-50/60 dark:from-primary-500/20 dark:to-primary-500/5 dark:text-primary-300 dark:ring-primary-500/5">
          <Icon className="size-7" />
        </span>
      </div>
      <h3 className="mt-6 text-base font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', error, onRetry, className }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <span className="grid size-12 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-950">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-fg">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{error?.message ?? 'Please try again.'}</p>
      {error?.requestId && <p className="mt-1 text-xs text-muted">Reference: {error.requestId}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
