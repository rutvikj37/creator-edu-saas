import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { captureReferral } from '../../services/api/affiliates.js';
import { captureAttribution, track } from '../../utils/tracker.js';
import { adEvent, initAdTracking } from '../../utils/adTracking.js';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Layers, ShoppingCart, Users } from 'lucide-react';
import { bundlesApi, cartApi, productsApi } from '../../services/api/commerce.js';
import { academyApi } from '../../services/api/auth.js';
import { catalogApi } from '../../services/api/learn.js';
import { Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatMoney } from '../../utils/format.js';
import { RatingSummary } from '../../components/reviews/Stars.jsx';

/** `nav` = links from the website builder (header settings + published pages). */
function CartLink() {
  const cart = useQuery({ queryKey: ['cart'], queryFn: cartApi.get, staleTime: 30_000, retry: false });
  const n = cart.data?.count ?? 0;
  return (
    <Link to="/cart" aria-label={n ? `Cart, ${n} item${n === 1 ? '' : 's'}` : 'Cart'} className="relative inline-flex size-9 items-center justify-center rounded-md text-fg-2 hover:bg-surface-2">
      <ShoppingCart className="size-5" />
      {n > 0 && <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">{n}</span>}
    </Link>
  );
}

export function AcademyHeader({ site, nav }) {
  const auth = useAuth();
  const location = useLocation();
  useEffect(() => {
    if (location.search.includes('ref=')) captureReferral(location.search, location.pathname);
  }, [location.search, location.pathname]);
  useEffect(() => {
    captureAttribution(location.search, location.pathname);
    track('page_view', location.pathname);
    adEvent('PageView');
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { initAdTracking(site?.tracking); }, [site?.tracking]);
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight" style={{ fontFamily: site?.theme?.fontHeading }}>
          {site?.logoUrl ? <img src={site.logoUrl} alt="" className="size-8 rounded object-contain" /> : <span className="grid size-8 place-items-center rounded-md text-xs font-bold text-white" style={{ background: site?.theme?.primaryColor }}>{site?.name?.slice(0, 2).toUpperCase()}</span>}
          {site?.name}
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          {(nav ?? [{ label: 'Courses', href: '/courses' }]).map((l) => (l.href.startsWith('/') && !l.href.startsWith('//')
            ? <Link key={`${l.label}${l.href}`} to={l.href} className="hidden h-9 items-center rounded-md px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 sm:inline-flex">{l.label}</Link>
            : <a key={`${l.label}${l.href}`} href={l.href} rel="noreferrer noopener" className="hidden h-9 items-center rounded-md px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 sm:inline-flex">{l.label}</a>))}
          {auth.status === 'authenticated' && site?.paymentsEnabled && <CartLink />}
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
    <Link to={`/courses/${c.slug}`} className="group block">
      <article className="h-full overflow-hidden border border-line bg-surface transition group-hover:border-line-strong">
        <div className="aspect-[16/10] bg-surface-2">{c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" className="size-full object-cover transition duration-500 group-hover:scale-[1.02]" loading="lazy" /> : <div className="grid size-full place-items-center"><BookOpen className="size-8 text-line-strong" /></div>}</div>
        <div className="space-y-2 p-4">
          <p className="line-clamp-2 font-semibold tracking-tight text-fg">{c.title}</p>
          {c.shortDescription && <p className="line-clamp-2 text-sm text-muted">{c.shortDescription}</p>}
          <RatingSummary average={c.ratingAverage} count={c.ratingCount} />
          <div className="flex items-center justify-between pt-1 text-sm">
            <span className="font-semibold" style={{ color }}>{c.isFree ? 'Free' : formatMoney(c.priceAmount, c.currency)}{!c.isFree && c.compareAtAmount && <span className="ml-2 font-normal text-muted line-through">{formatMoney(c.compareAtAmount, c.currency)}</span>}</span>
            <span className="flex items-center gap-1 text-muted"><Users className="size-3.5" />{c.studentCount}</span>
          </div>
        </div>
      </article>
    </Link>
  );
}

export function BundleCard({ b, color }) {
  return (
    <Link to={`/bundles/${b.slug}`} className="group block">
      <article className="h-full overflow-hidden border border-line bg-surface transition group-hover:border-line-strong">
        <div className="aspect-[16/10] bg-surface-2">{b.coverUrl ? <img src={b.coverUrl} alt="" className="size-full object-cover" loading="lazy" /> : <div className="grid size-full place-items-center"><Layers className="size-8 text-line-strong" /></div>}</div>
        <div className="space-y-2 p-4">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Bundle · {b.courseCount} courses</p>
          <p className="line-clamp-2 font-semibold">{b.title}</p>
          <p className="text-sm"><span className="font-semibold" style={{ color }}>{formatMoney(b.priceAmount, b.currency)}</span>{Number(b.worthAmount) > Number(b.priceAmount) && <span className="ml-2 text-muted line-through">{formatMoney(b.worthAmount, b.currency)}</span>}</p>
        </div>
      </article>
    </Link>
  );
}

function Reveal({ children, className = '' }) {
  const ref = useRef(null);
  const animate = typeof IntersectionObserver !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(!animate);
  useEffect(() => {
    if (!animate || !ref.current) return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { rootMargin: '0px 0px -8% 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [animate]);
  return <div ref={ref} className={`${className} transition duration-700 ease-out ${shown ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'}`}>{children}</div>;
}

const HOW = [
  { title: 'Choose a programme', text: 'Browse published courses and pick the skills you need next.' },
  { title: 'Learn live and on demand', text: 'Watch lessons when it suits you, and join live sessions with your cohort.' },
  { title: 'Finish with a certificate', text: 'Complete the coursework and download a certificate you can share.' },
];

const LIVE = [
  { title: 'Scheduled live sessions', text: 'Show up for mentor-led classes and ask questions in the moment.' },
  { title: 'Learner community', text: 'Stay accountable with peers working through the same material.' },
  { title: 'Practical outcomes', text: 'Projects and checkpoints designed around skills employers recognise.' },
];

/** Academy home: branding + live catalogue. Website builder published pages replace this on hosts that have a home page. */
export function AcademyLandingPage({ catalogOnly = false }) {
  const auth = useAuth();
  const inStudentShell = auth.status === 'authenticated';
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000, retry: false });
  const courses = useQuery({ queryKey: ['catalog'], queryFn: () => catalogApi.courses(), enabled: Boolean(site.data) });
  const bundles = useQuery({ queryKey: ['public', 'bundles'], queryFn: bundlesApi.publicList, enabled: Boolean(site.data), retry: false });
  const products = useQuery({ queryKey: ['public', 'products'], queryFn: productsApi.publicList, enabled: Boolean(site.data), retry: false });
  if (site.isError) return <div className="grid min-h-dvh place-items-center"><ErrorState title="Academy not found" error={{ message: 'There is no academy at this address.' }} /></div>;
  const s = site.data;
  const color = s?.theme?.primaryColor ?? '#0f766e';
  const accent = s?.theme?.accentColor ?? '#0d9488';

  return (
    <div className={inStudentShell ? undefined : 'min-h-dvh bg-surface'} style={inStudentShell ? undefined : { fontFamily: s?.theme?.fontBody, '--academy-brand': color }}>
      {!inStudentShell && <AcademyHeader site={s} />}
      {!catalogOnly && (
        <section className="relative isolate min-h-[min(92dvh,760px)] overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden
            style={{
              background: `linear-gradient(118deg, color-mix(in srgb, ${color} 16%, #f4f7f8) 0%, #f8fafb 38%, color-mix(in srgb, ${accent} 12%, #eef6f5) 100%)`,
            }}
          />
          <div
            className="pointer-events-none absolute -right-[12%] top-[-10%] hidden h-[120%] w-[58%] sm:block"
            aria-hidden
            style={{
              background: `linear-gradient(160deg, color-mix(in srgb, ${color} 22%, #0f172a) 0%, color-mix(in srgb, ${color} 55%, #134e4a) 48%, color-mix(in srgb, ${accent} 35%, ${color}) 100%)`,
              clipPath: 'polygon(18% 0, 100% 0, 100% 100%, 0 100%)',
            }}
          />
          <div className="relative mx-auto flex min-h-[min(92dvh,760px)] max-w-6xl flex-col justify-center px-4 py-20 sm:px-6">
            <div className="academy-hero-copy max-w-xl">
              {site.isLoading ? (
                <Skeleton className="h-10 w-72" />
              ) : (
                <>
                  <h1 className="text-4xl font-semibold tracking-tight text-fg text-balance sm:text-5xl lg:text-[3.25rem] lg:leading-[1.1]" style={{ fontFamily: s?.theme?.fontHeading }}>
                    {s.name}
                  </h1>
                  <p className="mt-4 max-w-lg text-base leading-relaxed text-fg-2 sm:text-lg">
                    {s?.tagline || 'Structured courses, live classes and certificates for career-ready skills.'}
                  </p>
                  {s && !s.isLive && <p className="mt-3 text-muted">This academy is getting ready to launch.</p>}
                  <div className="mt-8 flex flex-wrap gap-3">
                    <Link to="/courses" className="inline-flex h-11 items-center rounded-md px-6 text-sm font-semibold text-white transition hover:brightness-110" style={{ background: color }}>Browse courses</Link>
                    {s?.acceptingRegistrations && <Link to="/register" className="inline-flex h-11 items-center rounded-md border border-line bg-surface/80 px-6 text-sm font-semibold text-fg transition hover:bg-surface">Start learning</Link>}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {!catalogOnly && !inStudentShell && (
        <section className="border-y border-line bg-surface py-16 sm:py-24">
          <Reveal className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ fontFamily: s?.theme?.fontHeading }}>How it works</h2>
            <ol className="mt-12 grid gap-0 sm:grid-cols-3 sm:gap-10">
              {HOW.map((it, i) => (
                <li key={it.title} className="relative border-t border-line pt-6 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-8 first:sm:border-l-0 first:sm:pl-0">
                  <span className="block text-xs font-semibold tracking-[0.16em] uppercase" style={{ color }}>{String(i + 1).padStart(2, '0')}</span>
                  <p className="mt-3 text-lg font-semibold">{it.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-fg-2">{it.text}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        </section>
      )}

      <main className={inStudentShell ? 'max-w-6xl' : 'mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24'}>
        {bundles.data?.length > 0 && (
          <section className="mb-16">
            <h2 className="mb-8 text-2xl font-semibold tracking-tight">Bundles</h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{bundles.data.map((b) => <BundleCard key={b.id} b={b} color={color} />)}</div>
          </section>
        )}
        {products.data?.length > 0 && (
          <section className="mb-16">
            <h2 className="mb-8 text-2xl font-semibold tracking-tight">Downloads</h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{products.data.map((p) => (
              <Link key={p.id} to={`/products/${p.slug}`} className="group block">
                <article className="h-full overflow-hidden border border-line bg-surface transition group-hover:border-line-strong">
                  <div className="aspect-[16/10] bg-surface-2">{p.coverUrl ? <img src={p.coverUrl} alt="" className="size-full object-cover" loading="lazy" /> : <div className="grid size-full place-items-center"><BookOpen className="size-8 text-line-strong" /></div>}</div>
                  <div className="space-y-2 p-4">
                    <p className="text-xs font-medium tracking-wide text-muted uppercase">Download · {p.files.length} file{p.files.length === 1 ? '' : 's'}</p>
                    <p className="line-clamp-2 font-semibold">{p.title}</p>
                    <p className="text-sm font-semibold" style={{ color }}>{p.isFree ? 'Free' : formatMoney(p.priceAmount, p.currency)}</p>
                  </div>
                </article>
              </Link>
            ))}</div>
          </section>
        )}
        <Reveal>
          <div className="mb-8 max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{catalogOnly ? 'All courses' : 'Featured programmes'}</h2>
            {!catalogOnly && <p className="mt-2 text-fg-2">Programmes you can start today — priced in INR, with certificates on completion.</p>}
          </div>
          {courses.isLoading || site.isLoading ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}</div>
            : courses.data?.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{courses.data.map((c) => <CourseCard key={c.id} c={c} color={color} />)}</div>
            : <Card><EmptyState icon={BookOpen} title="No courses yet" description="New courses will appear here soon." /></Card>}
        </Reveal>

        {!catalogOnly && !inStudentShell && (
          <Reveal className="mt-20 border-t border-line pt-16">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ fontFamily: s?.theme?.fontHeading }}>Live classes & community</h2>
            <ol className="mt-12 grid gap-0 sm:grid-cols-3 sm:gap-10">
              {LIVE.map((it, i) => (
                <li key={it.title} className="border-t border-line pt-6 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-8 first:sm:border-l-0 first:sm:pl-0">
                  <span className="block text-xs font-semibold tracking-[0.16em] uppercase" style={{ color }}>{String(i + 1).padStart(2, '0')}</span>
                  <p className="mt-3 text-lg font-semibold">{it.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-fg-2">{it.text}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        )}
      </main>

      {!catalogOnly && !inStudentShell && s && (
        <section className="relative overflow-hidden py-20 sm:py-28">
          <div className="absolute inset-0" style={{ background: `linear-gradient(125deg, ${color} 0%, color-mix(in srgb, ${color} 70%, #0f172a) 55%, color-mix(in srgb, ${accent} 45%, ${color}) 100%)` }} aria-hidden />
          <Reveal className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight text-white text-balance sm:text-4xl" style={{ fontFamily: s.theme?.fontHeading }}>Start learning with {s.name}</h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-white/85 sm:text-lg">{s.tagline || 'Browse the catalogue and enrol in a few clicks.'}</p>
            <Link to="/courses" className="mt-8 inline-flex h-11 items-center rounded-md bg-white px-6 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">Browse courses</Link>
          </Reveal>
        </section>
      )}
    </div>
  );
}
