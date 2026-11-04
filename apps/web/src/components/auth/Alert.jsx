import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '../../utils/cn.js';

const tones = {
  error: { cls: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200', Icon: AlertCircle },
  success: { cls: 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200', Icon: CheckCircle2 },
  info: { cls: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200', Icon: Info },
};

export function Alert({ tone = 'info', title, children, className, action }) {
  const { cls, Icon } = tones[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-lg border px-3.5 py-3 text-sm', cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>}
      </div>
      {action}
    </div>
  );
}
