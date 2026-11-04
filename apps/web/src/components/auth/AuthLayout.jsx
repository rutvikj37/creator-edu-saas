import { useEffect } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { academyApi } from '../../services/api/auth.js';
import { systemApi } from '../../services/api/system.js';
import { useAuth } from '../../context/AuthContext.jsx';

/** Centered card layout for sign-in flows, branded for the platform or the academy. */
export function AuthLayout({ title, subtitle, children, footer }) {
  const { surface } = useAuth();
  const brand = useQuery({
    queryKey: ['brand', surface],
    queryFn: () => (surface === 'academy' ? academyApi.site() : systemApi.info()),
    staleTime: 5 * 60_000,
  });
  const name = brand.data?.name ?? '';
  useEffect(() => {
    document.title = name ? `${title} · ${name}` : title;
  }, [title, name]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <Link to="/" className="mb-8 flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-lg bg-primary-600 text-sm font-bold text-on-primary">{name ? name.slice(0, 2).toUpperCase() : '··'}</span>
        <span className="text-base font-semibold">{name || ' '}</span>
      </Link>
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
    </div>
  );
}
