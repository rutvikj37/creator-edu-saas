import { useId } from 'react';
import { DIAL_CODES, flag } from '../../utils/dialCodes.js';
import { cn } from '../../utils/cn.js';

/**
 * Mobile number with a country-code picker (Graphy's "Add learner" style). The parent keeps
 * `code` (e.g. "91", stored as `${iso}:${code}`) and `number` separately; use joinPhone() to send.
 */
export function PhoneInput({ label = 'Mobile', country = 'IN', onCountryChange, number, onNumberChange, error, hint, required }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-fg-2">{label}{required && <span className="text-red-600"> *</span>}</label>
      <div className={cn('flex rounded-md border bg-surface focus-within:ring-2 focus-within:ring-primary-500', error ? 'border-red-500' : 'border-line')}>
        <select aria-label="Country code" value={country} onChange={(e) => onCountryChange(e.target.value)}
          className="h-10 shrink-0 rounded-l-md border-r border-line bg-surface-2/60 pr-1 pl-2 text-sm text-fg focus:outline-none">
          {DIAL_CODES.map((d) => <option key={d.iso} value={d.iso}>{flag(d.iso)} +{d.code}</option>)}
        </select>
        <input id={id} type="tel" inputMode="tel" autoComplete="tel-national" value={number} onChange={(e) => onNumberChange(e.target.value)} placeholder="Enter mobile number"
          aria-invalid={error ? true : undefined} aria-describedby={describedBy} className="h-10 min-w-0 flex-1 rounded-r-md bg-transparent px-3 text-sm text-fg placeholder:text-muted focus:outline-none" />
      </div>
      {error ? <p id={`${id}-error`} role="alert" className="text-xs font-medium text-red-600">{error}</p> : hint && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
