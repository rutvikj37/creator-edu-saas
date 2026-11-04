import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { Button } from './Button.jsx';
import { Input } from './Input.jsx';

/**
 * Modal built on the native <dialog> element: focus trapping, Escape to close and
 * top-layer rendering come from the browser, which keeps it accessible by default.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', className }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose?.();
      }}
      className={cn('m-auto w-[calc(100%-2rem)] rounded-xl border border-line bg-surface p-0 text-fg shadow-lg', widths[size], className)}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 id={titleId} className="text-base font-semibold">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line bg-surface-2/50 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/**
 * Confirmation for destructive actions. With `confirmText`, the user must type it
 * exactly (used for irreversible operations such as deleting a tenant).
 */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', tone = 'danger', confirmText, loading }) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);
  const blocked = confirmText ? typed !== confirmText : false;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading} disabled={blocked}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <p className="text-sm text-fg-2">{description}</p>}
      {confirmText && (
        <div className="mt-4">
          <Input
            label={`Type "${confirmText}" to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        </div>
      )}
    </Modal>
  );
}

/** Side panel for detail views and secondary forms. */
export function Drawer({ open, onClose, title, children, footer, side = 'right' }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose?.();
      }}
      className={cn(
        'fixed top-0 m-0 h-dvh max-h-dvh w-full max-w-md border-line bg-surface p-0 text-fg shadow-lg',
        side === 'right' ? 'right-0 left-auto border-l' : 'left-0 border-r',
      )}
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-base font-semibold">{title}</h2>
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
