import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

/**
 * List state (page, search, sort, filters) stored in the URL so lists are shareable,
 * survive reloads and work with the browser back button.
 */
export function useListParams(defaults = {}) {
  const [params, setParams] = useSearchParams();
  const values = useMemo(() => {
    const out = { page: 1, pageSize: 20, ...defaults };
    for (const [k, v] of params.entries()) out[k] = k === 'page' || k === 'pageSize' ? Number(v) || out[k] : v;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const update = useCallback(
    (patch, { resetPage = true } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          if (resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [values, update];
}
