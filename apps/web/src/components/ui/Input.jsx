import { forwardRef, useId } from 'react';
import { cn } from '../../utils/cn.js';

const control =
  'w-full rounded-md border bg-surface px-3 text-sm text-fg placeholder:text-muted shadow-xs transition-colors ' +
  'border-line hover:border-line-strong focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-200';

export const controlClass = control;

/** Label + control + hint/error wiring with correct aria attributes. */
export function Field({ label, hint, error, required, children, className, id: idProp }) {
  const generated = useId();
  const id = idProp ?? generated;
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-fg-2">
          {label}
          {required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
        </label>
      )}
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, required })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef(function Input({ label, hint, error, required, className, id, leftIcon: Left, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id}>
      {(a11y) => (
        <div className="relative">
          {Left && <Left className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />}
          <input ref={ref} className={cn(control, 'h-9', Left && 'pl-9', className)} {...a11y} {...props} />
        </div>
      )}
    </Field>
  );
});

export const Textarea = forwardRef(function Textarea({ label, hint, error, required, className, id, rows = 4, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id}>
      {(a11y) => <textarea ref={ref} rows={rows} className={cn(control, 'py-2', className)} {...a11y} {...props} />}
    </Field>
  );
});

export const Select = forwardRef(function Select({ label, hint, error, required, className, id, options = [], placeholder, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id}>
      {(a11y) => (
        <select ref={ref} className={cn(control, 'h-9 pr-8', className)} {...a11y} {...props}>
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
});

export const Checkbox = forwardRef(function Checkbox({ label, description, className, id: idProp, ...props }, ref) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input ref={ref} id={id} type="checkbox" className="mt-0.5 size-4 rounded border-line-strong accent-primary-600" {...props} />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-fg">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </label>
    </div>
  );
});

/** Accessible toggle (role=switch). */
export function Switch({ checked, onChange, label, disabled, id: idProp }) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <div className="flex items-center gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-primary-600' : 'bg-line-strong',
        )}
      >
        <span className={cn('inline-block size-4 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
      </button>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-fg-2">
          {label}
        </label>
      )}
    </div>
  );
}
