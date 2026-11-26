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
import { LAUNCH_STRIP, MORE, PILLARS, STEPS, faqs } from './landing/content.js';

const NAV = [['Features', 'features'], ['Setup', 'how-it-works'], ['Included', 'included'], ['Pricing', 'pricing'], ['FAQ', 'faq']];
const cta = 'inline-flex items-center justify-center gap-2 rounded-md font-semibold tracking-tight transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f5c56]';
const ctaPrimary = `${cta} bg-[#0f5c56] text-white hover:bg-[#0c4a45]`;
const ctaSecondary = `${cta} border border-[#1e293b]/20 bg-white/80 text-[#0f172a] backdrop-blur hover:bg-white`;
const sans = { fontFamily: "'Poppins', 'Noto Sans Devanagari', ui-sans-serif, system-ui, sans-serif" };
const display = { fontFamily: "'Merriweather', 'Noto Serif Devanagari', Georgia, serif" };

function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const animate = typeof IntersectionObserver !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(!animate);
  useEffect(() => {
    if (!animate || !ref.current) return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { rootMargin: '0px 0px -12% 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [animate]);
  return <Tag ref={ref} className={`${className} transition duration-700 ease-out ${shown ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`} {...rest}>{children}</Tag>;
}

function Heading({ eyebrow, title, text, id }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#0f5c56]">{eyebrow}</p>
      <h2 id={id} style={display} className="mt-3 text-3xl font-normal tracking-tight text-balance text-[#0f172a] sm:text-4xl">{title}</h2>
      {text && <p className="mt-4 text-base leading-relaxed text-[#475569] sm:text-lg">{text}</p>}
    </div>
  );
}

/** Full-bleed product plane under the hero copy. */
function ProductPreview() {
  const tiles = [
    { icon: BookOpen, label: 'Courses', tone: 'bg-[#d8efe9] text-[#0f5c56]' },
    { icon: Radio, label: 'Live classes', tone: 'bg-[#e8eef5] text-[#1e3a5f]' },
    { icon: Users, label: 'Learners', tone: 'bg-[#e2e8f0] text-[#0f172a]' },
    { icon: CreditCard, label: 'Payments', tone: 'bg-[#dbeafe] text-[#0c4a6e]' },
  ];
  return (
    <div aria-hidden className="relative mx-auto mt-14 w-full max-w-6xl px-4 sm:mt-16">
      <div className="absolute inset-x-0 -top-10 bottom-0 bg-[radial-gradient(ellipse_at_center,rgba(15,92,86,0.14),transparent_65%)]" />
      <div className="relative overflow-hidden rounded-t-2xl border border-[#0f172a]/10 border-b-0 bg-white shadow-[0_-20px_60px_-20px_rgba(15,23,42,0.18)]">
        <div className="flex items-center gap-1.5 border-b border-[#0f172a]/8 bg-[#f1f5f4] px-4 py-3">
          <span className="size-2.5 rounded-full bg-[#cbd5e1]" /><span className="size-2.5 rounded-full bg-[#cbd5e1]" /><span className="size-2.5 rounded-full bg-[#cbd5e1]" />
          <span className="ml-3 h-5 w-40 rounded bg-[#e2e8f0] sm:w-56" />
        </div>
        <div className="grid grid-cols-[3.25rem_1fr] sm:grid-cols-[4.25rem_1fr]">
          <div className="space-y-3 border-r border-[#0f172a]/8 bg-[#f8faf9] p-3">
            {[0, 1, 2, 3, 4].map((i) => <span key={i} className={`block h-8 rounded-md ${i === 0 ? 'bg-[#0f5c56]' : 'bg-[#e2e8f0]'}`} />)}
          </div>
          <div className="p-4 sm:p-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {tiles.map((t, i) => (
                <div key={t.label} className="rounded-xl border border-[#0f172a]/8 bg-[#f8faf9] p-4 text-left" style={{ animationDelay: `${i * 80}ms` }}>
                  <span className={`grid size-9 place-items-center rounded-lg ${t.tone}`}><t.icon className="size-4" /></span>
                  <p className="mt-3 text-sm font-medium text-[#0f172a]">{t.label}</p>
                  <span className="mt-2 block h-2 w-3/4 rounded-full bg-[#e2e8f0]" />
                </div>
              ))}
            </div>
            <div className="mt-4 flex h-32 items-end gap-1.5 rounded-xl border border-[#0f172a]/8 bg-[#f8faf9] p-4 sm:h-40 sm:gap-2">
              {[38, 52, 44, 68, 60, 78, 72, 90, 84, 100].map((h, i) => (
                <span key={i} style={{ height: `${h}%` }} className="flex-1 rounded-t bg-gradient-to-t from-[#0f5c56] to-[#2a9d8f]" />
              ))}
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
    <div className="relative mx-auto mt-10 aspect-video max-w-4xl overflow-hidden rounded-2xl border border-[#0f172a]/10 bg-[#0f172a] shadow-2xl">
      {playing ? (
        video.kind === 'iframe'
          ? <iframe title={`${name} product demo`} src={video.src} className="size-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
          : <video src={video.src} className="size-full" controls autoPlay />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} className="group grid size-full place-items-center bg-[radial-gradient(circle_at_center,rgba(15,92,86,0.45),transparent_60%)]">
          <span className="flex flex-col items-center gap-4 text-white">
            <span className="grid size-20 place-items-center rounded-full bg-white text-[#0f5c56] shadow-xl transition duration-300 group-hover:scale-110"><Play className="ml-1 size-8 fill-current" aria-hidden /></span>
            <span className="text-base font-medium">Play the demo</span>
          </span>
        </button>
      )}
    </div>
  );
}

function Pricing({ plans, signInTo }) {
  const currency = pricingCurrency(plans);
  const shown = plans.map((p) => ({ plan: p, price: publicPlanPrice(p, currency) })).filter((x) => x.price);
  if (!shown.length) return null;
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 bg-[#f1f5f4] py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4">
        <Heading id="pricing-title" eyebrow="Pricing" title="Same academy. Two billing periods." text="Grow is billed every 6 months. Rise is billed yearly. Identical modules — including white label. Agency accounts are set up by our team." />
        <div className={`mx-auto mt-12 grid gap-6 ${shown.length === 1 ? 'max-w-md' : 'max-w-4xl md:grid-cols-2'}`}>
          {shown.map(({ plan, price }) => {
            const featured = plan.code === 'rise';
            const free = Number(price.amount) === 0;
            const features = planFeatureLines(plan);
            return (
              <Reveal as="article" key={plan.id} className={`relative flex flex-col overflow-hidden bg-white ${featured ? 'ring-2 ring-[#0f5c56] shadow-xl shadow-[#0f5c56]/10' : 'ring-1 ring-[#0f172a]/10'}`}>
                <div className="p-8 pb-6">
                  {featured && <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#0f5c56]">Best value</p>}
                  <h3 style={display} className="text-2xl font-normal text-[#0f172a]">{plan.name}</h3>
                  {plan.description && <p className="mt-2 text-sm leading-relaxed text-[#64748b]">{plan.description}</p>}
                  <p className="mt-6 flex flex-wrap items-baseline gap-x-2">
                    <span style={display} className="text-4xl font-normal tracking-tight text-[#0f172a] sm:text-5xl">{priceLabel(price)}</span>
                    {!free && <span className="text-sm font-medium text-[#475569]">/ {intervalLabel(price.interval)}</span>}
                  </p>
                  {!free && <p className="mt-2 text-sm font-semibold text-[#0f5c56]">+ 18% GST extra</p>}
                  <Link to={signInTo} className={`mt-7 h-11 w-full text-sm ${featured ? ctaPrimary : ctaSecondary}`}>Sign in</Link>
                </div>
                <div className={`flex-1 border-t px-8 py-6 ${featured ? 'border-[#0f5c56]/15 bg-[#f0faf8]' : 'border-[#0f172a]/08 bg-[#f8faf9]'}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#0f5c56]">Everything included</p>
                  <ul className="mt-4 space-y-3">
                    {features.map((line) => (
                      <li key={line} className="flex gap-3 text-sm font-medium leading-snug text-[#0f172a]">
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#0f5c56] text-white" aria-hidden>
                          <Check className="size-3 stroke-[3]" />
                        </span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            );
          })}
        </div>
        <p className="mt-8 text-center text-sm text-[#64748b]">Grow renews every 6 months · Rise renews yearly. <span className="font-semibold text-[#0f172a]">18% GST is charged extra</span> on every plan.</p>
      </div>
    </section>
  );
}

/** Brand-first sales landing for TechX LMS — Grow (6 mo) / Rise (yearly). */
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
  const primaryLabel = signedIn ? 'Go to dashboard' : 'Sign in';
  const video = demoVideo(branding.demoVideoUrl);
  const questions = useMemo(() => faqs({ name: name || 'the platform' }), [name]);
  const support = 'Courses, live classes, marketing and payments — on your domain. Grow ₹16,999 / 6 months · Rise ₹19,999 / year.';
  const description = `${name} helps educators sell courses, live classes and digital products on their own domain — Grow ₹16,999 / 6 months or Rise ₹19,999 / year (+ 18% GST).`;
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
    <div className="min-h-dvh bg-[#f7f9f8] text-[#0f172a]" style={sans}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2">Skip to content</a>

      {/* Full-bleed hero composition */}
      <div className="relative isolate overflow-hidden bg-[#eef4f2]">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[linear-gradient(165deg,#e8f2ef_0%,#f7f9f8_42%,#e7eef5_100%)]" />
          <div className="absolute -left-24 top-0 h-[28rem] w-[28rem] rounded-full bg-[#0f5c56]/12 blur-3xl" />
          <div className="absolute -right-16 top-32 h-[22rem] w-[22rem] rounded-full bg-[#1e3a5f]/10 blur-3xl" />
          <div className="absolute inset-0 opacity-[0.35] [background-image:radial-gradient(#0f172a14_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        </div>

        <header className="sticky top-0 z-40 border-b border-[#0f172a]/08 bg-[#eef4f2]/80 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
            <Link to="/" className="flex items-center gap-2.5">
              {branding.logoUrl
                ? <img src={branding.logoUrl} alt="" className="size-8 rounded object-contain" />
                : <span className="grid size-8 place-items-center rounded bg-[#0f5c56] text-xs font-bold text-white">{(name || 'TX').slice(0, 2).toUpperCase()}</span>}
              <span style={display} className="text-lg font-normal tracking-tight">{name || 'TechX LMS'}</span>
            </Link>
            <nav aria-label="Primary" className="hidden items-center gap-8 text-sm text-[#475569] md:flex">
              {NAV.map(([label, id]) => <a key={id} href={`#${id}`} className="hover:text-[#0f172a]">{label}</a>)}
            </nav>
            <div className="flex items-center gap-2">
              <Link to={primaryTo} className={`${ctaPrimary} h-9 px-4 text-sm`}>{primaryLabel}</Link>
              <button type="button" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu} onClick={() => setMenu((v) => !v)} className="grid size-9 place-items-center rounded-md hover:bg-[#0f172a]/5 md:hidden">
                {menu ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
            </div>
          </div>
          {menu && (
            <nav aria-label="Mobile" className="border-t border-[#0f172a]/08 px-4 py-3 md:hidden">
              {NAV.map(([label, id]) => <a key={id} href={`#${id}`} onClick={() => setMenu(false)} className="block rounded-md px-3 py-2.5 text-sm text-[#334155] hover:bg-white">{label}</a>)}
              <Link to={primaryTo} onClick={() => setMenu(false)} className="mt-1 block rounded-md bg-[#0f5c56] px-3 py-2.5 text-center text-sm font-semibold text-white">{primaryLabel}</Link>
            </nav>
          )}
        </header>

        <section id="main" className="mx-auto max-w-6xl px-4 pt-16 text-center sm:pt-24">
          <p style={display} className="animate-[fadeIn_0.7s_ease-out] text-2xl font-normal tracking-tight text-[#0f5c56] sm:text-3xl">
            {name || 'TechX LMS'}
          </p>
          <h1 style={display} className="mx-auto mt-5 max-w-3xl text-4xl font-normal leading-[1.12] tracking-tight text-balance text-[#0f172a] sm:text-5xl lg:text-6xl">
            Sell your academy on your brand
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-[#475569] sm:text-lg">
            {support}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to={primaryTo} className={`${ctaPrimary} h-12 w-full px-8 text-base sm:w-auto`}>{primaryLabel} <ArrowRight className="size-4" aria-hidden /></Link>
            {video
              ? <a href="#demo" className={`${ctaSecondary} h-12 w-full px-8 text-base sm:w-auto`}><Play className="size-4" aria-hidden /> Watch the demo</a>
              : <a href="#pricing" className={`${ctaSecondary} h-12 w-full px-8 text-base sm:w-auto`}>See pricing</a>}
          </div>
          <ProductPreview />
        </section>
      </div>

      <main>
        <section id="features" aria-labelledby="features-title" className="scroll-mt-20 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4">
            <Heading id="features-title" eyebrow="Platform" title="Teach, sell and retain from one place" text="Stop stitching a course host, webinar tool, email tool and payment page." />
            <div className="mt-14 grid gap-5 md:grid-cols-6">
              {PILLARS.map((f) => (
                <Reveal as="article" key={f.title} className={`p-7 ring-1 ring-[#0f172a]/10 ${f.wide ? 'bg-[#f7f9f8] md:col-span-3' : 'bg-white md:col-span-2'}`}>
                  <span className={`grid size-11 place-items-center rounded-md ${f.tone} text-white`}><f.icon className="size-5" aria-hidden /></span>
                  <h3 style={display} className="mt-5 text-xl font-normal text-[#0f172a]">{f.title}</h3>
                  <p className="mt-2 max-w-xl text-[#475569]">{f.text}</p>
                </Reveal>
              ))}
            </div>
            <div className="mt-5 grid gap-x-8 gap-y-8 border border-[#0f172a]/10 bg-[#f7f9f8] p-8 sm:grid-cols-2 lg:grid-cols-5">
              {MORE.map((f) => (
                <div key={f.title}>
                  <f.icon className="size-5 text-[#0f5c56]" aria-hidden />
                  <h3 className="mt-3 text-sm font-semibold text-[#0f172a]">{f.title}</h3>
                  <p className="mt-1 text-sm text-[#64748b]">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="included" aria-labelledby="included-title" className="scroll-mt-20 border-y border-[#0f172a]/08 bg-[#0f172a] py-20 text-white sm:py-24">
          <div className="mx-auto max-w-6xl px-4">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#5eead4]">Every plan</p>
              <h2 id="included-title" style={display} className="mt-3 text-3xl font-normal tracking-tight text-balance sm:text-4xl">Modules included with Grow and Rise</h2>
              <p className="mt-4 text-[#94a3b8]">Identical on Grow and Rise — including white label. Only the billing period and price change.</p>
            </div>
            <ul className="mx-auto mt-12 grid max-w-4xl gap-3 sm:grid-cols-2">
              {LAUNCH_STRIP.map((m) => (
                <Reveal as="li" key={m.title} className="flex items-center gap-3 border border-white/10 bg-white/5 px-4 py-3.5">
                  <m.icon className="size-5 shrink-0 text-[#5eead4]" aria-hidden />
                  <span className="text-sm font-medium">{m.title}</span>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 relative overflow-hidden bg-[#0f5c56] py-20 text-white sm:py-28">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -left-20 top-10 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-[#062e2b]/50 blur-3xl" />
            <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(#ffffff33_1px,transparent_1px)] [background-size:20px_20px]" />
          </div>
          <div className="relative mx-auto max-w-6xl px-4">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#99f6e4]">Guided setup</p>
              <h2 id="how-title" style={display} className="mt-3 text-3xl font-normal tracking-tight text-balance sm:text-4xl">We launch your academy with you</h2>
              <p className="mt-4 text-base leading-relaxed text-[#ccfbf1] sm:text-lg">Not a blank DIY install. Our team onboards, configures and trains you — then you go live on your brand.</p>
            </div>
            <ol className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {STEPS.map((s, i) => (
                <Reveal as="li" key={s.title} className="relative flex flex-col border border-white/15 bg-white/10 p-5 backdrop-blur-sm sm:p-6">
                  <span className="flex size-11 items-center justify-center rounded-full bg-white text-lg font-bold tabular-nums text-[#0f5c56]" aria-hidden>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 style={display} className="mt-5 text-lg font-normal leading-snug text-white">{s.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-[#ccfbf1]">{s.text}</p>
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

        {plans.length > 0 && <Pricing plans={plans} signInTo={primaryTo} />}

        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-3xl px-4">
            <Heading id="faq-title" eyebrow="FAQ" title="Questions, answered" />
            <div className="mt-10 divide-y divide-[#0f172a]/10 border border-[#0f172a]/10">
              {questions.map((f) => (
                <details key={f.q} className="group px-6">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left font-medium text-[#0f172a] [&::-webkit-details-marker]:hidden">
                    <h3 className="text-base">{f.q}</h3>
                    <ChevronDown className="size-5 shrink-0 text-[#94a3b8] transition group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="pb-5 text-[#475569]">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="cta-title" className="px-4 pb-20">
          <div className="relative isolate mx-auto max-w-6xl overflow-hidden bg-[#0f172a] px-6 py-16 text-center text-white sm:py-20">
            <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(15,92,86,0.45),transparent_55%)]" />
            <h2 id="cta-title" style={display} className="mx-auto max-w-2xl text-3xl font-normal tracking-tight text-balance sm:text-5xl">Ready to sell on your own brand?</h2>
            <p className="mx-auto mt-4 max-w-xl text-white/85 sm:text-lg">Grow ₹16,999 / 6 months or Rise ₹19,999 / year. Same features. 18% GST extra. We’ll provision your academy and get you live.</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link to={primaryTo} className={`${cta} h-12 bg-white px-8 text-base text-[#0f172a] hover:bg-[#f0fdfa]`}>{primaryLabel} <ArrowRight className="size-4" aria-hidden /></Link>
              <a href="#pricing" className={`${cta} h-12 border border-white/30 bg-transparent px-8 text-base text-white hover:bg-white/10`}>Compare plans</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#0f172a]/08 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-[#64748b] sm:flex-row">
          <p>© {new Date().getFullYear()} {name}</p>
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            {NAV.map(([label, id]) => <a key={id} href={`#${id}`} className="hover:text-[#0f172a]">{label}</a>)}
            <Link to="/login" className="hover:text-[#0f172a]">Sign in</Link>
          </nav>
        </div>
      </footer>

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}
