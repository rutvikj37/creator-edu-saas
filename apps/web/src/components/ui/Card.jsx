import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '../../utils/cn.js';

export function Card({ className, children, ...props }) {
  return (
    <div className={cn('rounded-lg border border-line bg-surface shadow-sm', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children }) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

/** KPI tile. `delta` is a ratio (0.12 = +12%) compared with the previous period. */
export function StatCard({ label, value, delta, hint, icon: Icon, loading }) {
  const up = typeof delta === 'number' && delta >= 0;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
        {Icon && (
          <span className="grid size-8 place-items-center rounded-md bg-primary-50 text-primary-600">
            <Icon className="size-4" aria-hidden />
          </span>
        )}
      </div>
      {loading ? (
        <div className="mt-3 h-7 w-24 animate-pulse rounded bg-surface-2" />
      ) : (
        <p className="mt-2 text-2xl font-semibold tracking-tight text-fg tabular-nums">{value}</p>
      )}
      <div className="mt-1 flex items-center gap-1.5 text-xs">
        {typeof delta === 'number' && (
          <span className={cn('inline-flex items-center gap-0.5 font-medium', up ? 'text-green-600' : 'text-red-600')}>
            {up ? <TrendingUp className="size-3.5" aria-hidden /> : <TrendingDown className="size-3.5" aria-hidden />}
            {Math.abs(delta * 100).toFixed(1)}%
          </span>
        )}
        {hint && <span className="text-muted">{hint}</span>}
      </div>
    </Card>
  );
}
