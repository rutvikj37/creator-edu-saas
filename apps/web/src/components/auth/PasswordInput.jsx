import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Field, controlClass } from '../ui/Input.jsx';
import { cn } from '../../utils/cn.js';

export const PasswordInput = forwardRef(function PasswordInput({ label = 'Password', hint, error, required, autoComplete = 'current-password', ...props }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(a11y) => (
        <div className="relative">
          <input ref={ref} type={visible ? 'text' : 'password'} autoComplete={autoComplete} className={cn(controlClass, 'h-9 pr-10')} {...a11y} {...props} />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted hover:text-fg"
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      )}
    </Field>
  );
});
