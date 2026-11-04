import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Component, HeartPulse, LayoutTemplate } from 'lucide-react';
import { Card, Skeleton } from '../components/ui/index.js';
import { systemApi } from '../services/api/system.js';

const LINKS = [
  { to: '/status', title: 'System status', text: 'Live checks for MySQL, Redis and the job queue.', icon: HeartPulse },
  { to: '/design-system', title: 'Design system', text: 'Components, forms, tables, charts and states.', icon: Component },
  { to: '/preview/creator', title: 'Layout previews', text: 'Navigation shells for every panel.', icon: LayoutTemplate },
];

/** Development entry page. Replaced by the marketing site + login in Phase 2/3. */
export function HomePage() {
  const info = useQuery({ queryKey: ['system', 'info'], queryFn: systemApi.info });
  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center px-4 py-16">
      <span className="grid size-11 place-items-center rounded-xl bg-primary-600 text-base font-bold text-on-primary">CE</span>
      {info.isLoading ? (
        <Skeleton className="mt-6 h-9 w-72" />
      ) : (
        <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">{info.data?.name ?? 'Creator Education'}</h1>
      )}
      <p className="mt-3 max-w-xl text-base text-muted">
        {info.data?.branding?.tagline ?? 'Platform foundation is running.'} {info.isError && '(API not reachable — start it with pnpm dev:api.)'}
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="group">
            <Card className="h-full p-5 transition-shadow group-hover:shadow-md">
              <l.icon className="size-5 text-primary-600" aria-hidden />
              <p className="mt-3 flex items-center gap-1 font-semibold">
                {l.title} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </p>
              <p className="mt-1 text-sm text-muted">{l.text}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
