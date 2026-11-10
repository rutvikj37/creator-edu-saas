import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Check, ChevronDown, CreditCard, Menu, Play, Radio, Sparkles, Users, X } from 'lucide-react';
import { systemApi } from '../../services/api/system.js';
import { creatorApi } from '../../services/api/platform.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { landingPath } from '../../routes/guards.jsx';
import { useSeo } from '../../utils/seo.js';
import { demoVideo } from './landing/video.js';
import { planFeatureLines, planPrice, priceLabel, pricingCurrency, yearlySaving } from './landing/pricing.js';
import { MORE, PILLARS, STEPS, faqs } from './landing/content.js';

const NAV = [['Features', 'features'], ['How it works', 'how-it-works'], ['Pricing', 'pricing'], ['FAQ', 'faq']];
const cta = 'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400';
const ctaPrimary = `${cta} bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/30 hover:from-indigo-400 hover:to-violet-400`;

/** Fades a section in the first time it scrolls into view. Static when motion is reduced or unsupported. */
function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const animate = typeof IntersectionObserver !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(!animate);
  useEffect(() => {
    if (!animate || !ref.current) return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { rootMargin: '0px 0px -10% 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [animate]);
  return <Tag ref={ref} className={`${className} transition duration-700 ease-out ${shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`} {...rest}>{children}</Tag>;
}

function Heading({ eyebrow, title, text, id }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">{eyebrow}</p>
      <h2 id={id} className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {text && <p className="mt-4 text-base text-muted sm:text-lg">{text}</p>}
    </div>
  );
}

/** An illustration of the product, drawn in CSS. Shows the shape of the app, not invented figures. */
function ProductPreview() {
  const tiles = [
    { icon: BookOpen, label: 'Courses', tone: 'bg-indigo-500/15 text-indigo-300' },
    { icon: Radio, label: 'Live classes', tone: 'bg-rose-500/15 text-rose-300' },
    { icon: Users, label: 'Learners', tone: 'bg-emerald-500/15 text-emerald-300' },
    { icon: CreditCard, label: 'Payments', tone: 'bg-sky-500/15 text-sky-300' },
  ];
  return (
    <div aria-hidden className="relative mx-auto mt-16 max-w-5xl">
      <div className="absolute -inset-x-10 -top-10 bottom-0 rounded-[3rem] bg-gradient-to-r from-indigo-500/30 via-violet-500/30 to-fuchsia-500/30 blur-3xl" />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/80 shadow-2xl shadow-indigo-950/50 backdrop-blur">
        <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
          <span className="size-2.5 rounded-full bg-white/20" /><span className="size-2.5 rounded-full bg-white/20" /><span className="size-2.5 rounded-full bg-white/20" />
          <span className="ml-3 h-5 w-48 rounded-md bg-white/5" />
        </div>
        <div className="grid grid-cols-[3.5rem_1fr] sm:grid-cols-[4rem_1fr]">
          <div className="space-y-3 border-r border-white/10 p-3">
            {[0, 1, 2, 3, 4].map((i) => <span key={i} className={`block h-8 rounded-lg ${i === 0 ? 'bg-indigo-500/40' : 'bg-white/5'}`} />)}
          </div>
          <div className="p-4 sm:p-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {tiles.map((t) => (
                <div key={t.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left">
                  <span className={`grid size-9 place-items-center rounded-lg ${t.tone}`}><t.icon className="size-4" /></span>
                  <p className="mt-3 text-sm font-medium text-slate-200">{t.label}</p>
                  <span className="mt-2 block h-2 w-3/4 rounded-full bg-white/10" />
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[2fr_1fr]">
              <div className="flex h-36 items-end gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                {[35, 50, 42, 64, 58, 76, 70, 88, 82, 100].map((h, i) => <span key={i} style={{ height: `${h}%` }} className="flex-1 rounded-t-md bg-gradient-to-t from-indigo-500/60 to-violet-400/80" />)}
              </div>
              <div className="hidden space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 lg:block">
                {[0, 1, 2].map((i) => <div key={i} className="flex items-center gap-3"><span className="size-8 rounded-full bg-white/10" /><span className="h-2 flex-1 rounded-full bg-white/10" /></div>)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoVideo({ video, name }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative mx-auto mt-10 aspect-video max-w-4xl overflow-hidden rounded-2xl border border-line bg-slate-950 shadow-2xl">
      {playing ? (
        video.kind === 'iframe'
          ? <iframe title={`${name} product demo`} src={video.src} className="size-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
          : <video src={video.src} className="size-full" controls autoPlay />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} className="group grid size-full place-items-center bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.35),transparent_60%)]">
          <span className="flex flex-col items-center gap-4 text-white">
            <span className="grid size-20 place-items-center rounded-full bg-white text-indigo-600 shadow-xl transition group-hover:scale-110"><Play className="ml-1 size-8 fill-current" aria-hidden /></span>
            <span className="text-base font-medium">Play the demo</span>
          </span>
        </button>
      )}
    </div>
  );
}

function Pricing({ plans, signupTo }) {
  const currency = pricingCurrency(plans);
  const hasYear = plans.some((p) => planPrice(p, 'YEAR', currency));
  const hasMonth = plans.some((p) => planPrice(p, 'MONTH', currency));
  const [interval, setInterval] = useState(hasMonth ? 'MONTH' : 'YEAR');
  const bestSaving = Math.max(0, ...plans.map((p) => yearlySaving(p, currency) ?? 0));
  const shown = plans.map((p) => ({ plan: p, price: planPrice(p, interval, currency) ?? planPrice(p, interval === 'MONTH' ? 'YEAR' : 'MONTH', currency) })).filter((x) => x.price);
  if (!shown.length) return null;
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 bg-surface-2/60 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4">
        <Heading id="pricing-title" eyebrow="Pricing" title="Simple plans that grow with your academy" text="Start free, upgrade when you are ready. Change or cancel at any time." />
        {hasYear && hasMonth && (
          <div role="group" aria-label="Billing period" className="mx-auto mt-8 flex w-fit rounded-full border border-line bg-surface p-1 text-sm font-medium">
            {[['MONTH', 'Monthly'], ['YEAR', 'Yearly']].map(([v, label]) => (
              <button key={v} type="button" aria-pressed={interval === v} onClick={() => setInterval(v)} className={`rounded-full px-4 py-1.5 transition ${interval === v ? 'bg-primary-600 text-on-primary' : 'text-fg-2 hover:text-fg'}`}>
                {label}{v === 'YEAR' && bestSaving > 0 && <span className={`ml-1.5 text-xs ${interval === v ? 'text-on-primary' : 'text-emerald-600'}`}>save up to {bestSaving}%</span>}
              </button>
            ))}
          </div>
        )}
        <div className={`mx-auto mt-10 grid gap-6 ${shown.length === 1 ? 'max-w-md' : shown.length === 2 ? 'max-w-3xl md:grid-cols-2' : 'md:grid-cols-2 lg:grid-cols-3'}`}>
          {shown.map(({ plan, price }) => {
            const free = Number(price.amount) === 0;
            return (
              <Reveal as="article" key={plan.id} className={`relative flex flex-col rounded-2xl border bg-surface p-7 ${plan.isDefault ? 'border-primary-600 shadow-xl shadow-primary-600/10 ring-1 ring-primary-600' : 'border-line'}`}>
                {plan.trialDays > 0 && !free && <span className="absolute -top-3 left-7 rounded-full bg-primary-600 px-3 py-1 text-xs font-semibold text-on-primary">{plan.trialDays}-day free trial</span>}
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                {plan.description && <p className="mt-1 text-sm text-muted">{plan.description}</p>}
                <p className="mt-5 flex items-baseline gap-1.5">
                  <span className="text-4xl font-semibold tracking-tight">{priceLabel(price)}</span>
                  {!free && <span className="text-sm text-muted">/ {price.interval === 'YEAR' ? 'year' : 'month'}</span>}
                </p>
                <Link to={signupTo} className={`mt-6 h-11 text-sm ${plan.isDefault ? ctaPrimary : `${cta} border border-line-strong hover:bg-surface-2`}`}>
                  {plan.trialDays > 0 && !free ? 'Start free trial' : 'Get started'}
                </Link>
                <ul className="mt-7 space-y-3 text-sm">
                  {planFeatureLines(plan).map((line) => (
                    <li key={line} className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden /><span>{line}</span></li>
                  ))}
                </ul>
              </Reveal>
            );
          })}
        </div>
        <p className="mt-8 text-center text-sm text-muted">Prices exclude applicable taxes. No card needed to sign up.</p>
      </div>
    </section>
  );
}

/** Platform marketing site (www / app host): hero, features, demo, pricing, FAQ and the free-trial sign-up. */
export function PlatformLandingPage({ section }) {
  const auth = useAuth();
  const info = useQuery({ queryKey: ['system', 'info'], queryFn: systemApi.info, staleTime: 5 * 60_000 });
  const plansQuery = useQuery({ queryKey: ['public', 'plans'], queryFn: creatorApi.publicPlans, staleTime: 5 * 60_000 });
  const [menu, setMenu] = useState(false);
  const name = info.data?.name ?? '';
  const branding = info.data?.branding ?? {};
  const plans = useMemo(() => plansQuery.data ?? [], [plansQuery.data]);
  const trialDays = (plans.find((p) => p.isDefault) ?? plans[0])?.trialDays ?? 0;
  const signedIn = auth.status === 'authenticated';
  const primaryTo = signedIn ? landingPath(auth.me, auth.surface) : '/signup';
  const primaryLabel = signedIn ? 'Go to dashboard' : trialDays > 0 ? 'Start free trial' : 'Start free';
  const video = demoVideo(branding.demoVideoUrl);
  const questions = useMemo(() => faqs({ name: name || 'the platform', trialDays }), [name, trialDays]);
  const description = `${name} is the all-in-one platform to create and sell online courses, live classes, coaching and memberships under your own brand. UPI and card payments, GST invoices, your own domain.`;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  const jsonLd = useMemo(() => {
    if (!name) return null;
    const currency = pricingCurrency(plans);
    const offers = plans.map((p) => planPrice(p, 'MONTH', currency) ?? planPrice(p, 'YEAR', currency)).filter(Boolean);
    return {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', '@id': `${origin}/#org`, name, url: `${origin}/`, ...(branding.logoUrl ? { logo: branding.logoUrl } : {}) },
        { '@type': 'WebSite', '@id': `${origin}/#site`, name, url: `${origin}/`, publisher: { '@id': `${origin}/#org` } },
        {
          '@type': 'SoftwareApplication', name, applicationCategory: 'EducationalApplication', operatingSystem: 'Web', url: `${origin}/`, description,
          ...(offers.length ? { offers: { '@type': 'AggregateOffer', priceCurrency: currency, lowPrice: Math.min(...offers.map((o) => Number(o.amount))), highPrice: Math.max(...offers.map((o) => Number(o.amount))), offerCount: offers.length } } : {}),
        },
        { '@type': 'FAQPage', mainEntity: questions.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
      ],
    };
  }, [name, plans, origin, description, questions, branding.logoUrl]);

  useSeo({
    title: name ? (section === 'pricing' ? `Pricing · ${name}` : `${name} — Create & sell online courses, live classes and coaching`) : '',
    description,
    canonical: `${origin}${section === 'pricing' ? '/pricing' : '/'}`,
    image: branding.logoUrl || undefined,
    jsonLd,
  });

  useEffect(() => {
    if (section && plans.length) document.getElementById(section)?.scrollIntoView?.();
  }, [section, plans.length]);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-slate-900">Skip to content</a>

      <div className="relative isolate overflow-hidden bg-slate-950 text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-[-20rem] size-[60rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(99,102,241,0.45),transparent)]" />
          <div className="absolute right-[-10rem] top-40 size-[30rem] rounded-full bg-[radial-gradient(closest-side,rgba(217,70,239,0.25),transparent)]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        </div>

        <header className="sticky top-0 z-40 border-b border-white/5 bg-slate-950/70 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
            <Link to="/" className="flex items-center gap-2.5 font-semibold">
              {branding.logoUrl
                ? <img src={branding.logoUrl} alt="" className="size-8 rounded-lg object-contain" />
                : <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-xs font-bold">{name.slice(0, 2).toUpperCase()}</span>}
              {name}
            </Link>
            <nav aria-label="Primary" className="hidden items-center gap-7 text-sm text-slate-300 md:flex">
              {NAV.map(([label, id]) => <a key={id} href={`#${id}`} className="hover:text-white">{label}</a>)}
            </nav>
            <div className="flex items-center gap-2">
              {!signedIn && <Link to="/login" className="hidden h-9 items-center rounded-lg px-3 text-sm font-medium text-slate-200 hover:bg-white/10 sm:inline-flex">Sign in</Link>}
              <Link to={primaryTo} className={`${ctaPrimary} h-9 px-4 text-sm`}>{primaryLabel}</Link>
              <button type="button" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu} onClick={() => setMenu((v) => !v)} className="grid size-9 place-items-center rounded-lg hover:bg-white/10 md:hidden">
                {menu ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
            </div>
          </div>
          {menu && (
            <nav aria-label="Mobile" className="border-t border-white/10 px-4 py-3 md:hidden">
              {NAV.map(([label, id]) => <a key={id} href={`#${id}`} onClick={() => setMenu(false)} className="block rounded-lg px-3 py-2.5 text-sm text-slate-200 hover:bg-white/10">{label}</a>)}
              {!signedIn && <Link to="/login" className="block rounded-lg px-3 py-2.5 text-sm text-slate-200 hover:bg-white/10">Sign in</Link>}
            </nav>
          )}
        </header>

        <section id="main" className="mx-auto max-w-6xl px-4 pb-20 pt-16 text-center sm:pt-24">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-slate-200">
            <Sparkles className="size-4 text-violet-300" aria-hidden />
            Courses, live classes, coaching and memberships in one place
          </p>
          <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl">
            Launch your online academy{' '}
            <span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">under your own brand</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-slate-300 sm:text-xl">{branding.tagline || 'Teach, sell and get paid from one platform. Your website, your domain, your learners — without stitching five tools together.'}</p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to={primaryTo} className={`${ctaPrimary} h-12 w-full px-7 text-base sm:w-auto`}>{primaryLabel} <ArrowRight className="size-4" aria-hidden /></Link>
            {video
              ? <a href="#demo" className={`${cta} h-12 w-full border border-white/15 bg-white/5 px-7 text-base text-white hover:bg-white/10 sm:w-auto`}><Play className="size-4" aria-hidden /> Watch the demo</a>
              : <a href="#pricing" className={`${cta} h-12 w-full border border-white/15 bg-white/5 px-7 text-base text-white hover:bg-white/10 sm:w-auto`}>See pricing</a>}
          </div>
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-400">
            {[trialDays > 0 ? `${trialDays}-day free trial` : 'Free to start', 'No credit card needed', 'Set up in minutes'].map((t) => (
              <li key={t} className="flex items-center gap-1.5"><Check className="size-4 text-emerald-400" aria-hidden />{t}</li>
            ))}
          </ul>
          <ProductPreview />
        </section>
      </div>

      <main>
        <section id="features" aria-labelledby="features-title" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4">
            <Heading id="features-title" eyebrow="Everything you need" title="One platform to teach, sell and grow" text="Stop paying for a course host, a webinar tool, a booking app and a payment page separately." />
            <div className="mt-14 grid gap-5 md:grid-cols-6">
              {PILLARS.map((f) => (
                <Reveal as="article" key={f.title} className={`group relative overflow-hidden rounded-2xl border border-line bg-surface p-7 hover:border-line-strong hover:shadow-lg ${f.wide ? 'md:col-span-3' : 'md:col-span-2'}`}>
                  <div aria-hidden className={`absolute -right-16 -top-16 size-48 rounded-full bg-gradient-to-br ${f.tone} opacity-10 blur-2xl transition group-hover:opacity-25`} />
                  <span className={`grid size-11 place-items-center rounded-xl bg-gradient-to-br ${f.tone} text-white shadow-md`}><f.icon className="size-5" aria-hidden /></span>
                  <h3 className="mt-5 text-xl font-semibold">{f.title}</h3>
                  <p className="mt-2 max-w-xl text-muted">{f.text}</p>
                </Reveal>
              ))}
            </div>
            <div className="mt-5 grid gap-x-8 gap-y-7 rounded-2xl border border-line bg-surface p-7 sm:grid-cols-2 lg:grid-cols-5">
              {MORE.map((f) => (
                <div key={f.title}>
                  <f.icon className="size-5 text-primary-600" aria-hidden />
                  <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm text-muted">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 border-y border-line bg-surface-2/60 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4">
            <Heading id="how-title" eyebrow="How it works" title="From sign-up to your first sale in three steps" />
            <ol className="mt-14 grid gap-6 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <Reveal as="li" key={s.title} className="relative rounded-2xl border border-line bg-surface p-7">
                  <span className="grid size-10 place-items-center rounded-full bg-primary-600 text-sm font-semibold text-on-primary">{i + 1}</span>
                  <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-muted">{s.text}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {video && (
          <section id="demo" aria-labelledby="demo-title" className="scroll-mt-20 py-20 sm:py-28">
            <div className="mx-auto max-w-6xl px-4">
              <Heading id="demo-title" eyebrow="Product demo" title={`See ${name} in action`} text="A short walkthrough of building a course, taking a payment and what your learners see." />
              <DemoVideo video={video} name={name} />
            </div>
          </section>
        )}

        {plans.length > 0 && <Pricing plans={plans} signupTo={primaryTo} />}

        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-3xl px-4">
            <Heading id="faq-title" eyebrow="FAQ" title="Questions, answered" />
            <div className="mt-10 divide-y divide-line rounded-2xl border border-line bg-surface">
              {questions.map((f) => (
                <details key={f.q} className="group px-6">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left font-medium [&::-webkit-details-marker]:hidden">
                    <h3 className="text-base">{f.q}</h3>
                    <ChevronDown className="size-5 shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="pb-5 text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="cta-title" className="px-4 pb-20">
          <div className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-3xl bg-slate-950 px-6 py-16 text-center text-white sm:py-20">
            <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.5),transparent_60%)]" />
            <h2 id="cta-title" className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">Your academy can be live today</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-300 sm:text-lg">{trialDays > 0 ? `Try everything free for ${trialDays} days. No card, no commitment.` : 'Create your academy for free. No card, no commitment.'}</p>
            <Link to={primaryTo} className={`${ctaPrimary} mt-8 h-12 px-8 text-base`}>{primaryLabel} <ArrowRight className="size-4" aria-hidden /></Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:flex-row">
          <p>© {new Date().getFullYear()} {name}</p>
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            {NAV.map(([label, id]) => <a key={id} href={`#${id}`} className="hover:text-fg">{label}</a>)}
            <Link to="/login" className="hover:text-fg">Sign in</Link>
            <Link to="/signup" className="hover:text-fg">Create your academy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
