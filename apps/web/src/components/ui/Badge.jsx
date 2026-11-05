import { cn } from '../../utils/cn.js';

const tones = {
  neutral: 'bg-surface-2 text-fg-2 ring-line',
  primary: 'bg-primary-50 text-primary-700 ring-primary-200',
  success: 'bg-green-50 text-green-700 ring-green-200 dark:bg-green-950 dark:text-green-300 dark:ring-green-900',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
  danger: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900',
  info: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900',
};

export function Badge({ tone = 'neutral', dot = false, className, children }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/** Maps domain status values to badge tones consistently across every panel. */
const STATUS_TONES = {
  ACTIVE: 'success', PUBLISHED: 'success', PAID: 'success', VERIFIED: 'success', COMPLETED: 'success', up: 'success', ok: 'success',
  DRAFT: 'neutral', PENDING: 'warning', PAYMENT_INITIATED: 'info', ONBOARDING: 'info', SCHEDULED: 'info', PROCESSING: 'info',
  SUSPENDED: 'danger', FAILED: 'danger', CAPTURED: 'success', PROCESSED: 'success', CREATED: 'info', EXPIRED: 'neutral', EXHAUSTED: 'neutral', DISABLED: 'neutral', CANCELLED: 'neutral', REFUNDED: 'neutral', PARTIALLY_REFUNDED: 'warning', down: 'danger', error: 'danger',
};

export function StatusBadge({ status, label }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'} dot>
      {label ?? String(status).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </Badge>
  );
}
