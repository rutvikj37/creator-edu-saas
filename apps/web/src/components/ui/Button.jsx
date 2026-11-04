import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn.js';

const variants = {
  primary: 'bg-primary-600 text-on-primary hover:bg-primary-700 shadow-xs',
  secondary: 'bg-surface text-fg border border-line hover:bg-surface-2 shadow-xs',
  ghost: 'text-fg-2 hover:bg-surface-2 hover:text-fg',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-xs',
  link: 'text-primary-600 hover:underline px-0 h-auto',
};

const sizes = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
  icon: 'h-9 w-9 justify-center',
  'icon-sm': 'h-8 w-8 justify-center',
};

/**
 * Primary action control. `loading` disables the button and shows a spinner while
 * keeping its width stable, so double submissions are impossible.
 */
export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, leftIcon: Left, rightIcon: Right, className, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Left ? <Left className="size-4" aria-hidden /> : null}
      {children}
      {Right && !loading ? <Right className="size-4" aria-hidden /> : null}
    </button>
  );
});
