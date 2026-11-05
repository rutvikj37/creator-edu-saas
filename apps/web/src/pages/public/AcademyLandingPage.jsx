import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { captureReferral } from '../../services/api/affiliates.js';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Users } from 'lucide-react';
import { academyApi } from '../../services/api/auth.js';
import { catalogApi } from '../../services/api/learn.js';
import { Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatMoney } from '../../utils/format.js';

/** `nav` = links from the website builder (header settings + published pages). */
export function AcademyHeader({ site, nav }) {
  const auth = useAuth();
  const location = useLocation();
  useEffect(() => {
    if (location.search.includes('ref=')) captureReferral(location.search, location.pathname);
  }, [location.search, location.pathname]);
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2.5 font-semibold" style={{ fontFamily: site?.theme?.fontHeading }}>
          {site?.logoUrl ? <img src={site.logoUrl} alt="" className="size-8 rounded object-contain" /> : <span className="grid size-8 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: site?.theme?.primaryColor }}>{site?.name?.slice(0, 2).toUpperCase()}</span>}
          {site?.name}
        </Link>
        <nav className="flex items-center gap-2">
          {(nav ?? [{ label: 'Courses', href: '/courses' }]).map((l) => (l.href.startsWith('/') && !l.href.startsWith('//')
            ? <Link key={`${l.label}${l.href}`} to={l.href} className="hidden h-9 items-center rounded-md px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 sm:inline-flex">{l.label}</Link>
            : <a key={`${l.label}${l.href}`} href={l.href} rel="noreferrer noopener" className="hidden h-9 items-center rounded-md px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 sm:inline-flex">{l.label}</a>))}
          {auth.status === 'authenticated' ? (
            <Link to="/learn" className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium text-white" style={{ background: site?.theme?.primaryColor }}>My learning</Link>
          ) : (
            <>
              <Link to="/login" className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-fg-2 hover:bg-surface-2">Sign in</Link>
              {site?.acceptingRegistrations && <Link to="/register" className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium text-white" style={{ background: site?.theme?.primaryColor }}>Join</Link>}
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function CourseCard({ c, color }) {
  return (
    <Link to={`/courses/${c.slug}`} className="group">
      <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-md">
        <div className="aspect-video bg-surface-2">{c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" /> : <div className="grid size-full place-items-center"><BookOpen className="size-8 text-line-strong" /></div>}</div>
        <div className="space-y-2 p-4">
          <p className="line-clamp-2 font-semibold">{c.title}</p>
          {c.shortDescription && <p className="line-clamp-2 text-sm text-muted">{c.shortDescription}</p>}
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold" style={{ color }}>{c.isFree ? 'Free' : formatMoney(c.priceAmount, c.currency)}{!c.isFree && c.compareAtAmount && <span className="ml-2 font-normal text-muted line-through">{formatMoney(c.compareAtAmount, c.currency)}</span>}</span>
            <span className="flex items-center gap-1 text-muted"><Users className="size-3.5" />{c.studentCount}</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

/** Academy home: branding + live catalogue. The page builder replaces the hero layout in Phase 8. */
export function AcademyLandingPage({ catalogOnly = false }) {
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000, retry: false });
  const courses = useQuery({ queryKey: ['catalog'], queryFn: () => catalogApi.courses(), enabled: Boolean(site.data) });
  if (site.isError) return <div className="grid min-h-dvh place-items-center"><ErrorState title="Academy not found" error={{ message: 'There is no academy at this address.' }} /></div>;
  const s = site.data;
  const color = s?.theme?.primaryColor;
  return (
    <div className="min-h-dvh" style={{ fontFamily: s?.theme?.fontBody }}>
      <AcademyHeader site={s} />
      {!catalogOnly && (
        <section className="border-b border-line" style={{ background: color ? `${color}10` : undefined }}>
          <div className="mx-auto max-w-6xl px-4 py-16 text-center">
            {site.isLoading ? <Skeleton className="mx-auto h-10 w-72" /> : <h1 className="text-4xl font-semibold tracking-tight" style={{ fontFamily: s.theme.fontHeading }}>{s.name}</h1>}
            {s?.tagline && <p className="mx-auto mt-3 max-w-2xl text-lg text-muted">{s.tagline}</p>}
            {s && !s.isLive && <p className="mt-3 text-muted">This academy is getting ready to launch.</p>}
          </div>
        </section>
      )}
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="mb-6 text-xl font-semibold">{catalogOnly ? 'All courses' : 'Courses'}</h2>
        {courses.isLoading || site.isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}</div>
          : courses.data?.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{courses.data.map((c) => <CourseCard key={c.id} c={c} color={color} />)}</div>
          : <Card><EmptyState icon={BookOpen} title="No courses yet" description="New courses will appear here soon." /></Card>}
        {s?.description && !catalogOnly && <section className="mt-14 max-w-3xl"><h2 className="mb-3 text-xl font-semibold">About</h2><p className="whitespace-pre-line text-fg-2">{s.description}</p></section>}
      </main>
    </div>
  );
}
