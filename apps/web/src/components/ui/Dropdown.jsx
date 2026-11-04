import { useEffect, useRef, useState } from 'react';
import { cn } from '../../utils/cn.js';

/**
 * Menu button. Closes on outside click and Escape; items are focusable buttons/links.
 * `trigger` is a render function receiving the props to spread on the trigger button.
 */
export function Dropdown({ trigger, children, align = 'right', className, panelClassName }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className={cn('relative', className)}>
      {trigger({ 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="menu"
          onClick={(e) => e.target.closest('[data-menu-close]') && setOpen(false)}
          className={cn(
            'absolute z-40 mt-2 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-md',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({ icon: Icon, children, onClick, danger, as: As = 'button', ...props }) {
  return (
    <As
      role="menuitem"
      data-menu-close
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-surface-2',
        danger ? 'text-red-600' : 'text-fg-2 hover:text-fg',
      )}
      {...(As === 'button' ? { type: 'button' } : {})}
      {...props}
    >
      {Icon && <Icon className="size-4" aria-hidden />}
      {children}
    </As>
  );
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-line" role="separator" />;
}
