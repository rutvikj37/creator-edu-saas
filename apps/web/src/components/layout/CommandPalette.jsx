import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CornerDownLeft, Search } from 'lucide-react';
import { cn } from '../../utils/cn.js';

/** ⌘K / Ctrl+K palette searching the current panel's navigation. */
export function CommandPalette({ open, onClose, items }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ref = useRef(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((i) => !term || `${i.label} ${i.group ?? ''}`.toLowerCase().includes(term)).slice(0, 12);
  }, [items, q]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setQ('');
      setActive(0);
      d.showModal?.();
    }
    if (!open && d.open) d.close?.();
  }, [open]);

  const go = (item) => {
    if (!item || !item.available) return;
    onClose();
    navigate(item.to);
  };

  return (
    <dialog
      ref={ref}
      aria-label={t('shell.searchPlaceholder')}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className="mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl rounded-xl border border-line bg-surface p-0 text-fg shadow-lg"
    >
      {open && (
        <div>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-4 text-muted" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, results.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter') go(results[active]);
              }}
              placeholder={t('shell.searchPlaceholder')}
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
              role="combobox"
              aria-expanded="true"
              aria-controls="cmd-results"
            />
          </div>
          <ul id="cmd-results" role="listbox" className="max-h-80 overflow-y-auto p-2">
            {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{t('shell.noResults')}</li>}
            {results.map((item, i) => (
              <li
                key={item.to}
                role="option"
                aria-selected={i === active}
                aria-disabled={!item.available}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(item)}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm',
                  i === active && 'bg-surface-2',
                  !item.available && 'cursor-not-allowed opacity-50',
                )}
              >
                {item.icon && <item.icon className="size-4 text-muted" aria-hidden />}
                <span className="flex-1">
                  {item.label}
                  {item.group && <span className="ml-2 text-xs text-muted">{item.group}</span>}
                </span>
                {!item.available ? (
                  <span className="text-xs text-muted">{t('shell.soon')}</span>
                ) : (
                  i === active && <CornerDownLeft className="size-3.5 text-muted" aria-hidden />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </dialog>
  );
}
