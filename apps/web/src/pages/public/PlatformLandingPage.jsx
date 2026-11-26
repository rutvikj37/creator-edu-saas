import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Check, ChevronDown, CreditCard, Menu, Play, Radio, Users, X } from 'lucide-react';
import { systemApi } from '../../services/api/system.js';
import { creatorApi } from '../../services/api/platform.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { landingPath } from '../../routes/guards.jsx';
import { useSeo } from '../../utils/seo.js';
import { demoVideo } from './landing/video.js';
import { intervalLabel, planFeatureLines, planPrice, publicPlanPrice, priceLabel, pricingCurrency } from './landing/pricing.js';
import { MORE, PILLARS, STEPS, TRUST, faqs } from './landing/content.js';

const NAV = [['Features', 'features'], ['How it works', 'how-it-works'], ['Pricing', 'pricing'], ['FAQ', 'faq']];
const cta = 'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700';
const ctaPrimary = `${cta} bg-teal-700 text-white shadow-md shadow-teal-900/15 hover:bg-teal-800`;
const ctaSecondary = `${cta} border border-slate-300 bg-white text-slate-900 hover:bg-slate-50`;
const display = { fontFamily: "'Poppins', 'Noto Sans Devanagari', ui-sans-serif, system-ui, sans-serif" };

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
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-800">{eyebrow}</p>
      <h2 id={id} style={display} className="mt-3 text-3xl font-semibold tracking-tight text-balance text-slate-900 sm:text-4xl">{title}</h2>
      {text && <p className="mt-4 text-base text-slate-600 sm:text-lg">{text}</p>}
    </div>
  );
}

/** Product shape preview — academy console, not invented metrics. */
function ProductPreview() {
  const tiles = [
    { icon: BookOpen, label: 'Courses', tone: 'bg-teal-100 text-teal-800' },
    { icon: Radio, label: 'Live classes', tone: 'bg-amber-100 text-amber-800' },
    { icon: Users, label: 'Learners', tone: 'bg-slate-200 text-slate-800' },
    { icon: CreditCard, label: 'Payments', tone: 'bg-sky-100 text-sky-800' },
  ];
  return (
    <div aria-hidden className="relative mx-auto mt-14 max-w-5xl">
      <div className="absolute -inset-x-8 -top-8 bottom-8 rounded-[2.5rem] bg-gradient-to-br from-teal-200/50 via-amber-100/40 to-slate-200/60 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
        <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-3">
          <span className="size-2.5 rounded-full bg-slate-300" /><span className="size-2.5 rounded-full bg-slate-300" /><span className="size-2.5 rounded-full bg-slate-300" />
          <span className="ml-3 h-5 w-48 rounded-md bg-slate-200/80" />
        </div>
        <div className="grid grid-cols-[3.5rem_1fr] sm:grid-cols-[4rem_1fr]">
          <div className="space-y-3 border-r border-slate-100 bg-slate-50 p-3">
            {[0, 1, 2, 3, 4].map((i) => <span key={i} className={`block h-8 rounded-lg ${i === 0 ? 'bg-teal-600/80' : 'bg-slate-200'}`} />)}
          </div>
          <div className="p-4 sm:p-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {tiles.map((t) => (
                <div key={t.label} className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 text-left">
                  <span className={`grid size-9 place-items-center rounded-lg ${t.tone}`}><t.icon className="size-4" /></span>
                  <p className="mt-3 text-sm font-medium text-slate-800">{t.label}</p>
                  <span className="mt-2 block h-2 w-3/4 rounded-full bg-slate-200" />
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[2fr_1fr]">
              <div className="flex h-36 items-end gap-2 rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                {[35, 50, 42, 64, 58, 76, 70, 88, 82, 100].map((h, i) => <span key={i} style={{ height: `${h}%` }} className="flex-1 rounded-t-md bg-gradient-to-t from-teal-700 to-teal-400" />)}
              </div>
              <div className="hidden space-y-3 rounded-xl border border-slate-100 bg-slate-50/80 p-4 lg:block">
                {[0, 1, 2].map((i) => <div key={i} className="flex items-center gap-3"><span className="size-8 rounded-full bg-slate-200" /><span className="h-2 flex-1 rounded-full bg-slate-200" /></div>)}
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
    <div className="relative mx-auto mt-10 aspect-video max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 shadow-2xl">
      {playing ? (
        video.kind === 'iframe'
          ? <iframe title={`${name} product demo`} src={video.src} className="size-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
          : <video src={video.src} className="size-full" controls autoPlay />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} className="group grid size-full place-items-center bg-[radial-gradient(circle_at_center,rgba(13,148,136,0.35),transparent_60%)]">
          <span className="flex flex-col items-center gap-4 text-white">
            <span className="grid size-20 place-items-center rounded-full bg-white text-teal-800 shadow-xl transition group-hover:scale-110"><Play className="ml-1 size-8 fill-current" aria-hidden /></span>
            <span className="text-base font-medium">Play the demo</span>
          </span>
        </button>
      )}
    </div>
  );
}

function Pricing({ plans, signupTo }) {
  const currency = pricingCurrency(plans);
  const shown = plans.map((p) => ({ plan: p, price: publicPlanPrice(p, currency) })).filter((x) => x.price);
  if (!shown.length) return null;
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4">
        <Heading id="pricing-title" eyebrow="Pricing" title="Grow and Rise — clear yearly pricing" text="One rate for both plans. Agency accounts are set up by our team." />
        <div className={`mx-auto mt-10 grid gap-6 ${shown.length === 1 ? 'max-w-md' : 'max-w-4xl md:grid-cols-2'}`}>
          {shown.map(({ plan, price }) => {
            const featured = plan.code === 'rise' || plan.isDefault;
            const free = Number(price.amount) === 0;
            return (
              <Reveal as="article" key={plan.id} className={`relative flex flex-col rounded-2xl border bg-white p-7 ${featured ? 'border-teal-700 shadow-xl shadow-teal-900/10 ring-1 ring-teal-700' : 'border-slate-200'}`}>
                {featured && <span className="absolute -top-3 left-7 rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-white">Most popular</span>}
                <h3 style={display} className="text-xl font-semibold text-slate-900">{plan.name}</h3>
                {plan.description && <p className="mt-1 text-sm text-slate-600">{plan.description}</p>}
                <p className="mt-5 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                  <span style={display} className="text-4xl font-semibold tracking-tight text-slate-900">{priceLabel(price)}</span>
                  {!free && <span className="text-sm text-slate-500">/ {intervalLabel(price.interval)}</span>}
                </p>
                {!free && <p className="mt-1 text-sm font-medium text-amber-800">+ 18% GST extra</p>}
                <Link to={signupTo} className={`mt-6 h-11 text-sm ${featured ? ctaPrimary : ctaSecondary}`}>
                  Get started
                </Link>
                <ul className="mt-7 space-y-3 text-sm text-slate-700">
                  {planFeatureLines(plan).map((line) => (
                    <li key={line} className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden /><span>{line}</span></li>
                  ))}
                </ul>
              </Reveal>
            );
          })}
        </div>
        <p className="mt-8 text-center text-sm text-slate-500">All prices are yearly. <span className="font-medium text-slate-700">18% GST is charged extra</span>. White label is included on Rise.</p>
      </div>
    </section>
  );
}

/** Platform marketing site: brand-first sales landing for Grow / Rise. */
export function PlatformLandingPage({ section }) {
  const auth = useAuth();
  const info = useQuery({ queryKey: ['system', 'info'], queryFn: systemApi.info, staleTime: 5 * 60_000 });
  const plansQuery = useQuery({ queryKey: ['public', 'plans'], queryFn: creatorApi.publicPlans, staleTime: 5 * 60_000 });
  const [menu, setMenu] = useState(false);
  const name = info.data?.name ?? '';
  const branding = info.data?.branding ?? {};
  const plans = useMemo(() => (plansQuery.data ?? []).filter((p) => (p.prices ?? []).some((x) => Number(x.amount) > 0)), [plansQuery.data]);
  const signedIn = auth.status === 'authenticated';
  const primaryTo = signedIn ? landingPath(auth.me, auth.surface) : '/login';
  const primaryLabel = signedIn ? 'Go to dashboard' : 'Get started';
  const video = demoVideo(branding.demoVideoUrl);
  const questions = useMemo(() => faqs({ name: name || 'the platform' }), [name]);
  const description = `${name} helps educators sell courses, live classes and digital products on their own domain — Grow and Rise at ₹19,999 / year (+ 18% GST).`;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  const jsonLd = useMemo(() => {
    if (!name) return null;
    const currency = pricingCurrency(plans);
    const offers = plans.map((p) => publicPlanPrice(p, currency) ?? planPrice(p, 'YEAR', currency)).filter(Boolean);
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
    title: name ? (section === 'pricing' ? `Pricing · ${name}` : `${name} — Sell courses, live classes and digital products`) : '',
    description,
    canonical: `${origin}${section === 'pricing' ? '/pricing' : '/'}`,
    image: branding.logoUrl || undefined,
    jsonLd,
  });

  useEffect(() => {
    if (section && plans.length) document.getElementById(section)?.scrollIntoView?.();
  }, [section, plans.length]);

  return (
    <div className="min-h-dvh bg-[#f4f7f6] text-slate-900" style={display}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-slate-900">Skip to content</a>

      <div className="relative isolate overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,#ccfbf1,transparent_55%),radial-gradient(ellipse_at_top_right,#fef3c7,transparent_45%),linear-gradient(180deg,#f8faf9_0%,#f4f7f6_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.03)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)]" />
        </div>

        <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-[#f8faf9]/85 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
            <Link to="/" className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-slate-900">
              {branding.logoUrl
                ? <img src={branding.logoUrl} alt="" className="size-8 rounded-lg object-contain" />
                : <span className="grid size-8 place-items-center rounded-lg bg-teal-700 text-xs font-bold text-white">{name.slice(0, 2).toUpperCase()}</span>}
              {name}
            </Link>
            <nav aria-label="Primary" className="hidden items-center gap-7 text-sm text-slate-600 md:flex">
              {NAV.map(([label, id]) => <a key={id} href={`#${id}`} className="hover:text-slate-900">{label}</a>)}
            </nav>
            <div className="flex items-center gap-2">
              {!signedIn && <Link to="/login" className={`${ctaSecondary} hidden h-9 px-4 text-sm sm:inline-flex`}>Sign in</Link>}
              <Link to={primaryTo} className={`${ctaPrimary} h-9 px-4 text-sm`}>{primaryLabel}</Link>
              <button type="button" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu} onClick={() => setMenu((v) => !v)} className="grid size-9 place-items-center rounded-lg hover:bg-slate-200/60 md:hidden">
                {menu ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
            </div>
          </div>
          {menu && (
            <nav aria-label="Mobile" className="border-t border-slate-200 px-4 py-3 md:hidden">
              {NAV.map(([label, id]) => <a key={id} href={`#${id}`} onClick={() => setMenu(false)} className="block rounded-lg px-3 py-2.5 text-sm text-slate-700 hover:bg-white">{label}</a>)}
              {!signedIn && <Link to="/login" className="block rounded-lg px-3 py-2.5 text-sm text-slate-700 hover:bg-white">Sign in</Link>}
            </nav>
          )}
        </header>

        <section id="main" className="mx-auto max-w-6xl px-4 pb-16 pt-14 text-center sm:pt-20">
          <p style={display} className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-800">{name || 'TechX LMS'}</p>
          <h1 style={display} className="mx-auto mt-4 max-w-4xl text-4xl font-semibold tracking-tight text-balance text-slate-900 sm:text-6xl lg:text-[4.25rem] lg:leading-[1.05]">
            Sell your academy on your brand — not someone else’s
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-slate-600 sm:text-xl">
            {branding.tagline || 'Courses, unlimited live classes, marketing and payments in one platform. Custom domains, AI custom pages, and white label on Rise.'}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to={primaryTo} className={`${ctaPrimary} h-12 w-full px-7 text-base sm:w-auto`}>{primaryLabel} <ArrowRight className="size-4" aria-hidden /></Link>
            {video
              ? <a href="#demo" className={`${ctaSecondary} h-12 w-full px-7 text-base sm:w-auto`}><Play className="size-4" aria-hidden /> Watch the demo</a>
              : <a href="#pricing" className={`${ctaSecondary} h-12 w-full px-7 text-base sm:w-auto`}>See Grow & Rise pricing</a>}
          </div>
          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-slate-600">
            {TRUST.map((t) => (
              <li key={t.label} className="flex flex-col items-center sm:items-start">
                <span className="font-semibold text-slate-900">{t.label}</span>
                <span className="text-slate-500">{t.detail}</span>
              </li>
            ))}
          </ul>
          <ProductPreview />
        </section>
      </div>

      <main>
        <section id="features" aria-labelledby="features-title" className="scroll-mt-20 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4">
            <Heading id="features-title" eyebrow="Platform" title="Everything you need to teach, sell and retain" text="Stop paying separately for a course host, webinar tool, email tool and payment page." />
            <div className="mt-14 grid gap-5 md:grid-cols-6">
              {PILLARS.map((f) => (
                <Reveal as="article" key={f.title} className={`group relative overflow-hidden rounded-2xl border border-slate-200 bg-[#f8faf9] p-7 hover:border-slate-300 hover:shadow-lg ${f.wide ? 'md:col-span-3' : 'md:col-span-2'}`}>
                  <span className={`grid size-11 place-items-center rounded-xl ${f.tone} text-white shadow-md`}><f.icon className="size-5" aria-hidden /></span>
                  <h3 style={display} className="mt-5 text-xl font-semibold text-slate-900">{f.title}</h3>
                  <p className="mt-2 max-w-xl text-slate-600">{f.text}</p>
                </Reveal>
              ))}
            </div>
            <div className="mt-5 grid gap-x-8 gap-y-7 rounded-2xl border border-slate-200 bg-[#f8faf9] p-7 sm:grid-cols-2 lg:grid-cols-5">
              {MORE.map((f) => (
                <div key={f.title}>
                  <f.icon className="size-5 text-teal-700" aria-hidden />
                  <h3 className="mt-3 text-sm font-semibold text-slate-900">{f.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 border-y border-slate-200 bg-[#f4f7f6] py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4">
            <Heading id="how-title" eyebrow="How it works" title="From kickoff to your first sale" />
            <ol className="mt-14 grid gap-6 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <Reveal as="li" key={s.title} className="relative rounded-2xl border border-slate-200 bg-white p-7">
                  <span className="grid size-10 place-items-center rounded-full bg-teal-700 text-sm font-semibold text-white">{i + 1}</span>
                  <h3 style={display} className="mt-5 text-lg font-semibold text-slate-900">{s.title}</h3>
                  <p className="mt-2 text-slate-600">{s.text}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {video && (
          <section id="demo" aria-labelledby="demo-title" className="scroll-mt-20 bg-white py-20 sm:py-28">
            <div className="mx-auto max-w-6xl px-4">
              <Heading id="demo-title" eyebrow="Product demo" title={`See ${name} in action`} text="A short walkthrough of building a course, taking a payment and what your learners see." />
              <DemoVideo video={video} name={name} />
            </div>
          </section>
        )}

        {plans.length > 0 && <Pricing plans={plans} signupTo={primaryTo} />}

        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-3xl px-4">
            <Heading id="faq-title" eyebrow="FAQ" title="Questions, answered" />
            <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-[#f8faf9]">
              {questions.map((f) => (
                <details key={f.q} className="group px-6">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
                    <h3 className="text-base">{f.q}</h3>
                    <ChevronDown className="size-5 shrink-0 text-slate-400 transition group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="pb-5 text-slate-600">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="cta-title" className="px-4 pb-20">
          <div className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-3xl bg-slate-900 px-6 py-16 text-center text-white sm:py-20">
            <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(13,148,136,0.45),transparent_60%)]" />
            <h2 id="cta-title" style={display} className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">Ready to sell on your own brand?</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-300 sm:text-lg">Grow or Rise at ₹19,999 / year (+ 18% GST). We’ll provision your academy and get you live.</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link to={primaryTo} className={`${ctaPrimary} h-12 px-8 text-base`}>{primaryLabel} <ArrowRight className="size-4" aria-hidden /></Link>
              <a href="#pricing" className={`${cta} h-12 border border-white/20 bg-white/5 px-8 text-base text-white hover:bg-white/10`}>Compare plans</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-slate-500 sm:flex-row">
          <p>© {new Date().getFullYear()} {name}</p>
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            {NAV.map(([label, id]) => <a key={id} href={`#${id}`} className="hover:text-slate-900">{label}</a>)}
            <Link to="/login" className="hover:text-slate-900">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
