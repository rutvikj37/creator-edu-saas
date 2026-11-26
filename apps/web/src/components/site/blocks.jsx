import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  BarChart3, BookOpen, CircleHelp, Image as ImageIcon, LayoutTemplate, Mail, Megaphone, MessageSquareQuote, PlayCircle, Sparkles, Type, UserRound,
} from 'lucide-react';
import { RichTextView } from '../forms/RichTextView.jsx';
import { CourseCard } from '../../pages/public/AcademyLandingPage.jsx';

/**
 * Block registry: editor metadata (label, icon, defaults, fields) and the renderer used by both
 * the builder canvas and the public academy site. The API validates every block again.
 */
const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

export const BLOCK_DEFS = {
  hero: {
    label: 'Hero',
    icon: LayoutTemplate,
    defaults: {
      heading: 'Your headline',
      subheading: '',
      ctaLabel: 'Browse courses',
      ctaHref: '/courses',
      ctaSecondaryLabel: 'Start learning',
      ctaSecondaryHref: '/register',
      imageFileId: null,
      align: 'left',
    },
    fields: [
      { key: 'heading', label: 'Heading', type: 'text', max: 120 },
      { key: 'subheading', label: 'Subheading', type: 'textarea', max: 300 },
      { key: 'ctaLabel', label: 'Button label', type: 'text', max: 40 },
      { key: 'ctaHref', label: 'Button link', type: 'href' },
      { key: 'ctaSecondaryLabel', label: 'Second button label', type: 'text', max: 40 },
      { key: 'ctaSecondaryHref', label: 'Second button link', type: 'href' },
      { key: 'imageFileId', label: 'Background image', type: 'image' },
      { key: 'align', label: 'Alignment', type: 'select', options: [['left', 'Left'], ['center', 'Centered']] },
    ],
  },
  richText: { label: 'Text', icon: Type, defaults: { content: emptyDoc }, fields: [{ key: 'content', label: 'Content', type: 'richtext' }] },
  courseGrid: {
    label: 'Course grid',
    icon: BookOpen,
    defaults: { heading: 'Courses', mode: 'all', courseIds: [], limit: 6 },
    fields: [
      { key: 'heading', label: 'Heading', type: 'text', max: 120 },
      { key: 'mode', label: 'Show', type: 'select', options: [['all', 'Latest published courses'], ['selected', 'Courses I choose']] },
      { key: 'limit', label: 'How many', type: 'number', min: 1, max: 24, when: (p) => p.mode === 'all' },
      { key: 'courseIds', label: 'Courses', type: 'courses', when: (p) => p.mode === 'selected' },
    ],
  },
  features: {
    label: 'Features',
    icon: Sparkles,
    defaults: { heading: 'Why learn with us', items: [{ title: 'Feature', text: '' }] },
    fields: [
      { key: 'heading', label: 'Heading', type: 'text', max: 120 },
      { key: 'items', label: 'Items', type: 'list', max: 12, item: [{ key: 'title', label: 'Title', type: 'text', max: 80 }, { key: 'text', label: 'Text', type: 'textarea', max: 300 }], blank: { title: '', text: '' } },
    ],
  },
  testimonials: {
    label: 'Testimonials',
    icon: MessageSquareQuote,
    defaults: { heading: 'What students say', items: [{ quote: '', name: '', role: '' }] },
    fields: [
      { key: 'heading', label: 'Heading', type: 'text', max: 120 },
      { key: 'items', label: 'Testimonials', type: 'list', max: 12, item: [{ key: 'quote', label: 'Quote', type: 'textarea', max: 500 }, { key: 'name', label: 'Name', type: 'text', max: 80 }, { key: 'role', label: 'Role', type: 'text', max: 80 }], blank: { quote: '', name: '', role: '' } },
    ],
  },
  faq: {
    label: 'FAQ',
    icon: CircleHelp,
    defaults: { heading: 'Frequently asked questions', items: [{ q: '', a: '' }] },
    fields: [
      { key: 'heading', label: 'Heading', type: 'text', max: 120 },
      { key: 'items', label: 'Questions', type: 'list', max: 30, item: [{ key: 'q', label: 'Question', type: 'text', max: 200 }, { key: 'a', label: 'Answer', type: 'textarea', max: 2000 }], blank: { q: '', a: '' } },
    ],
  },
  cta: {
    label: 'Call to action',
    icon: Megaphone,
    defaults: { heading: 'Ready to start?', text: '', buttonLabel: 'Browse courses', buttonHref: '/courses' },
    fields: [
      { key: 'heading', label: 'Heading', type: 'text', max: 120 },
      { key: 'text', label: 'Text', type: 'textarea', max: 300 },
      { key: 'buttonLabel', label: 'Button label', type: 'text', max: 40 },
      { key: 'buttonHref', label: 'Button link', type: 'href' },
    ],
  },
  image: {
    label: 'Image',
    icon: ImageIcon,
    defaults: { fileId: null, alt: '', caption: '' },
    fields: [
      { key: 'fileId', label: 'Image', type: 'image' },
      { key: 'alt', label: 'Alt text (for screen readers)', type: 'text', max: 160 },
      { key: 'caption', label: 'Caption', type: 'text', max: 200 },
    ],
  },
  video: {
    label: 'Video',
    icon: PlayCircle,
    defaults: { url: '', caption: '' },
    fields: [
      { key: 'url', label: 'YouTube or Vimeo link', type: 'text', max: 300 },
      { key: 'caption', label: 'Caption', type: 'text', max: 200 },
    ],
  },
  instructor: {
    label: 'Instructor',
    icon: UserRound,
    defaults: { name: '', title: '', bio: '', photoFileId: null },
    fields: [
      { key: 'name', label: 'Name', type: 'text', max: 80 },
      { key: 'title', label: 'Title', type: 'text', max: 120 },
      { key: 'bio', label: 'Bio', type: 'textarea', max: 1500 },
      { key: 'photoFileId', label: 'Photo', type: 'image' },
    ],
  },
  stats: {
    label: 'Stats',
    icon: BarChart3,
    defaults: { items: [{ value: '', label: '' }] },
    fields: [{ key: 'items', label: 'Numbers', type: 'list', max: 6, item: [{ key: 'value', label: 'Value', type: 'text', max: 20 }, { key: 'label', label: 'Label', type: 'text', max: 60 }], blank: { value: '', label: '' } }],
  },
  contact: {
    label: 'Contact',
    icon: Mail,
    defaults: { heading: 'Get in touch', email: '', phone: '', address: '' },
    fields: [
      { key: 'heading', label: 'Heading', type: 'text', max: 120 },
      { key: 'email', label: 'Email', type: 'text', max: 191 },
      { key: 'phone', label: 'Phone', type: 'text', max: 30 },
      { key: 'address', label: 'Address', type: 'textarea', max: 300 },
    ],
  },
};

export const BLOCK_TYPES = Object.keys(BLOCK_DEFS);

export function newBlockId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/[^\w]/g, '').slice(0, 16);
}

/** Converts a YouTube/Vimeo watch link into an embed URL, or null. */
export function embedUrl(url) {
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/i.exec(url ?? '');
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = /vimeo\.com\/(\d+)/i.exec(url ?? '');
  return vm ? `https://player.vimeo.com/video/${vm[1]}` : null;
}

function SmartLink({ href, className, style, children }) {
  if (!href) return null;
  if (href.startsWith('/') && !href.startsWith('//')) return <Link to={href} className={className} style={style}>{children}</Link>;
  return <a href={href} className={className} style={style} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer noopener">{children}</a>;
}

/** Fades a section in once when it enters the viewport. Honours reduced motion. */
function Reveal({ as: Tag = 'div', className = '', children, delay = 0 }) {
  const ref = useRef(null);
  const animate = typeof IntersectionObserver !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(!animate);
  useEffect(() => {
    if (!animate || !ref.current) return undefined;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setShown(true);
        io.disconnect();
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [animate]);
  return (
    <Tag
      ref={ref}
      className={`${className} transition-[opacity,transform] duration-700 ease-out ${shown ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

const sectionPad = (t) => (t === 'minimal' ? 'py-16 sm:py-20' : t === 'bold' ? 'py-20 sm:py-28' : 'py-16 sm:py-24');
const h2 = (t) => (t === 'bold' ? 'text-3xl font-bold tracking-tight sm:text-4xl' : 'text-2xl font-semibold tracking-tight sm:text-3xl');

function Section({ template, children, className = '', style }) {
  return (
    <section className={`${sectionPad(template)} ${className}`} style={style}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">{children}</div>
    </section>
  );
}

const Placeholder = ({ children }) => <div className="rounded-lg border-2 border-dashed border-line p-8 text-center text-sm text-muted">{children}</div>;

/** Full-bleed learning atmosphere for heroes without a photo — edge-to-edge, not a floating card. */
function HeroPlane({ color, accent, img }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {img ? (
        <>
          <img src={img} alt="" className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/80 via-slate-950/55 to-slate-950/25" />
        </>
      ) : (
        <>
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(118deg, color-mix(in srgb, ${color} 16%, #f4f7f8) 0%, #f8fafb 38%, color-mix(in srgb, ${accent || color} 12%, #eef6f5) 100%)`,
            }}
          />
          <div
            className="absolute inset-0 opacity-[0.45]"
            style={{
              backgroundImage: `
                linear-gradient(to right, color-mix(in srgb, ${color} 14%, transparent) 1px, transparent 1px),
                linear-gradient(to bottom, color-mix(in srgb, ${color} 10%, transparent) 1px, transparent 1px)
              `,
              backgroundSize: '56px 56px',
              maskImage: 'radial-gradient(ellipse 80% 70% at 70% 40%, black 20%, transparent 75%)',
            }}
          />
          <div
            className="absolute -right-[12%] top-[-10%] h-[120%] w-[70%] sm:w-[58%]"
            style={{
              background: `radial-gradient(ellipse at 30% 40%, color-mix(in srgb, ${color} 28%, transparent), transparent 62%),
                linear-gradient(160deg, color-mix(in srgb, ${color} 22%, #0f172a) 0%, color-mix(in srgb, ${color} 55%, #134e4a) 48%, color-mix(in srgb, ${accent || '#f59e0b'} 35%, #0f766e) 100%)`,
              clipPath: 'polygon(18% 0, 100% 0, 100% 100%, 0 100%)',
            }}
          />
          {/* Course player silhouette — flush visual plane, not a floated card */}
          <div className="absolute inset-y-[12%] right-0 hidden w-[48%] lg:block xl:w-[46%]">
            <div className="absolute inset-0 origin-right scale-100 opacity-90">
              <div className="absolute inset-x-[8%] top-[8%] bottom-[18%] rounded-sm bg-white/10 ring-1 ring-white/20 backdrop-blur-[2px]">
                <div className="flex h-9 items-center gap-2 border-b border-white/15 px-3">
                  <span className="size-2 rounded-sm bg-white/35" />
                  <span className="size-2 rounded-sm bg-white/25" />
                  <span className="ml-2 h-2 w-1/3 rounded-sm bg-white/20" />
                </div>
                <div className="grid h-[calc(100%-2.25rem)] grid-cols-[0.9fr_1.4fr] gap-px bg-white/10">
                  <div className="space-y-2.5 bg-slate-950/25 p-3">
                    {[72, 58, 64, 48, 55].map((w, i) => (
                      <div key={i} className="h-2 rounded-sm bg-white/20" style={{ width: `${w}%`, opacity: i === 1 ? 1 : 0.55 }} />
                    ))}
                  </div>
                  <div className="relative bg-slate-950/15 p-3">
                    <div className="absolute inset-3 rounded-sm bg-gradient-to-br from-white/15 to-white/5" />
                    <div className="absolute bottom-6 left-6 right-6 space-y-2">
                      <div className="h-2.5 w-2/3 rounded-sm bg-white/35" />
                      <div className="h-1.5 w-full rounded-sm bg-white/15" />
                      <div className="h-1.5 w-4/5 rounded-sm bg-white/15" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Renders one block. `editing` shows placeholders for incomplete content instead of hiding it. */
export function BlockView({ block, data, theme = {}, template = 'classic', editing = false, brandName }) {
  const p = block.props ?? {};
  const color = theme.primaryColor ?? '#0f766e';
  const accent = theme.accentColor ?? '#0d9488';
  const file = (id) => (id ? data?.files?.[id] : null);
  const headingFont = theme.fontHeading ? { fontFamily: theme.fontHeading } : undefined;
  const brand = brandName?.trim();
  const headingIsBrand = Boolean(brand && p.heading?.trim() && brand.toLowerCase() === p.heading.trim().toLowerCase());

  switch (block.type) {
    case 'hero': {
      const img = file(p.imageFileId);
      const center = p.align === 'center';
      const onDark = Boolean(img);
      const primaryBtn = 'inline-flex h-11 items-center justify-center rounded-md px-6 text-sm font-semibold transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2';
      const secondaryBtn = onDark
        ? 'inline-flex h-11 items-center justify-center rounded-md border border-white/35 bg-white/10 px-6 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/18'
        : 'inline-flex h-11 items-center justify-center rounded-md border border-line bg-surface/80 px-6 text-sm font-semibold text-fg transition hover:bg-surface';

      const heroMin = editing ? 'min-h-[320px]' : 'min-h-[min(92dvh,760px)]';
      return (
        <section className={`relative isolate overflow-hidden ${heroMin}`}>
          <HeroPlane color={color} accent={accent} img={img} />
          <div className={`relative mx-auto flex ${heroMin} max-w-6xl flex-col justify-center px-4 py-16 sm:px-6 sm:py-20 ${center ? 'items-center text-center' : 'items-start text-left'}`}>
            <div className={`academy-hero-copy max-w-xl ${editing ? 'animate-none' : ''} ${center ? 'mx-auto' : ''}`}>
              {brand && !headingIsBrand && (
                <p
                  className={`text-sm font-semibold tracking-[0.18em] uppercase ${onDark ? 'text-white/80' : ''}`}
                  style={onDark ? undefined : { color }}
                >
                  {brand}
                </p>
              )}
              <h1
                className={`mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.25rem] lg:leading-[1.1] ${onDark ? 'text-white' : 'text-fg'}`}
                style={headingFont}
              >
                {p.heading}
              </h1>
              {p.subheading && (
                <p className={`mt-4 max-w-lg text-base leading-relaxed sm:text-lg ${center ? 'mx-auto' : ''} ${onDark ? 'text-white/80' : 'text-fg-2'}`}>
                  {p.subheading}
                </p>
              )}
              {(p.ctaLabel && p.ctaHref) || (p.ctaSecondaryLabel && p.ctaSecondaryHref) ? (
                <div className={`mt-8 flex flex-wrap gap-3 ${center ? 'justify-center' : ''}`}>
                  {p.ctaLabel && p.ctaHref && (
                    <SmartLink
                      href={p.ctaHref}
                      className={`${primaryBtn} ${onDark ? 'bg-white text-slate-900' : 'text-white'}`}
                      style={onDark ? undefined : { background: color }}
                    >
                      {p.ctaLabel}
                    </SmartLink>
                  )}
                  {p.ctaSecondaryLabel && p.ctaSecondaryHref && (
                    <SmartLink href={p.ctaSecondaryHref} className={secondaryBtn}>
                      {p.ctaSecondaryLabel}
                    </SmartLink>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      );
    }
    case 'richText':
      return (
        <Section template={template}>
          <Reveal className="max-w-3xl">
            <RichTextView value={p.content} />
          </Reveal>
        </Section>
      );
    case 'courseGrid': {
      const list = data?.courses?.[block.id];
      return (
        <Section template={template} className="bg-surface">
          <Reveal>
            {p.heading && (
              <div className="mb-10 max-w-2xl">
                <h2 className={h2(template)} style={headingFont}>{p.heading}</h2>
              </div>
            )}
            {list?.length ? (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((c) => <CourseCard key={c.id} c={{ ...c, studentCount: c.studentCount ?? 0 }} color={color} />)}
              </div>
            ) : editing ? (
              <Placeholder>{p.mode === 'selected' ? 'Choose courses in the panel on the right.' : 'Your published courses appear here.'}</Placeholder>
            ) : null}
          </Reveal>
        </Section>
      );
    }
    case 'features':
      return (
        <Section
          template={template}
          style={{
            background: `linear-gradient(180deg, color-mix(in srgb, ${color} 6%, #f8fafb) 0%, #ffffff 100%)`,
          }}
        >
          <Reveal>
            {p.heading && (
              <div className="mb-12 max-w-2xl">
                <h2 className={h2(template)} style={headingFont}>{p.heading}</h2>
              </div>
            )}
            <ol className="grid gap-0 sm:grid-cols-3 sm:gap-10">
              {(p.items ?? []).map((it, i) => (
                <li key={i} className="relative border-t border-line pt-6 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-8 first:sm:border-l-0 first:sm:pl-0">
                  <span className="block text-xs font-semibold tracking-[0.16em] uppercase" style={{ color }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <p className="mt-3 text-lg font-semibold text-fg">{it.title || (editing ? 'Title' : '')}</p>
                  {it.text && <p className="mt-2 text-sm leading-relaxed text-fg-2">{it.text}</p>}
                </li>
              ))}
            </ol>
          </Reveal>
        </Section>
      );
    case 'testimonials':
      return (
        <Section template={template}>
          <Reveal>
            {p.heading && <h2 className={`mb-10 max-w-2xl ${h2(template)}`} style={headingFont}>{p.heading}</h2>}
            <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
              {(p.items ?? []).filter((it) => editing || it.quote).map((it, i) => (
                <figure key={i} className="border-t border-line pt-6">
                  <blockquote className="text-base leading-relaxed text-fg-2">“{it.quote || 'Quote'}”</blockquote>
                  <figcaption className="mt-5 text-sm">
                    <span className="font-semibold text-fg">{it.name || 'Name'}</span>
                    {it.role && <span className="text-muted"> · {it.role}</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          </Reveal>
        </Section>
      );
    case 'faq':
      return (
        <Section template={template}>
          <Reveal>
            {p.heading && <h2 className={`mb-6 ${h2(template)}`} style={headingFont}>{p.heading}</h2>}
            <div className="max-w-3xl divide-y divide-line border-y border-line">
              {(p.items ?? []).map((it, i) => (
                <details key={i} className="group py-5">
                  <summary className="cursor-pointer list-none font-medium marker:hidden">{it.q || 'Question'}</summary>
                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-fg-2">{it.a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </Section>
      );
    case 'cta':
      return (
        <section className={`${sectionPad(template)} relative overflow-hidden`}>
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(125deg, ${color} 0%, color-mix(in srgb, ${color} 70%, #0f172a) 55%, color-mix(in srgb, ${accent} 45%, ${color}) 100%)`,
            }}
            aria-hidden
          />
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
            aria-hidden
          />
          <Reveal className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight text-white text-balance sm:text-4xl" style={headingFont}>{p.heading}</h2>
            {p.text && <p className="mx-auto mt-4 max-w-xl text-base text-white/85 sm:text-lg">{p.text}</p>}
            <SmartLink href={p.buttonHref} className="mt-8 inline-flex h-11 items-center rounded-md bg-white px-6 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
              {p.buttonLabel}
            </SmartLink>
          </Reveal>
        </section>
      );
    case 'image': {
      const src = file(p.fileId);
      return (
        <Section template={template}>
          {src ? (
            <figure>
              <img src={src} alt={p.alt} className="w-full" loading="lazy" />
              {p.caption && <figcaption className="mt-2 text-center text-sm text-muted">{p.caption}</figcaption>}
            </figure>
          ) : editing ? <Placeholder>Upload an image in the panel on the right.</Placeholder> : null}
        </Section>
      );
    }
    case 'video': {
      const src = embedUrl(p.url);
      return (
        <Section template={template}>
          {src ? (
            <figure>
              <div className="aspect-video overflow-hidden bg-black">
                <iframe src={src} title={p.caption || 'Video'} className="size-full" allow="accelerometer; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
              </div>
              {p.caption && <figcaption className="mt-2 text-center text-sm text-muted">{p.caption}</figcaption>}
            </figure>
          ) : editing ? <Placeholder>Paste a YouTube or Vimeo link.</Placeholder> : null}
        </Section>
      );
    }
    case 'instructor': {
      const photo = file(p.photoFileId);
      return (
        <Section template={template}>
          <Reveal className="flex flex-col gap-6 sm:flex-row sm:items-start">
            {photo ? (
              <img src={photo} alt={p.name} className="size-32 shrink-0 object-cover" />
            ) : (
              <div className="grid size-32 shrink-0 place-items-center bg-surface-2"><UserRound className="size-10 text-line-strong" /></div>
            )}
            <div>
              <h2 className={h2(template)} style={headingFont}>{p.name || (editing ? 'Instructor name' : '')}</h2>
              {p.title && <p className="text-muted">{p.title}</p>}
              <p className="mt-3 whitespace-pre-line text-fg-2">{p.bio}</p>
            </div>
          </Reveal>
        </Section>
      );
    }
    case 'stats':
      return (
        <Section template={template} style={{ background: `color-mix(in srgb, ${color} 6%, #f8fafb)` }}>
          <dl className="grid grid-cols-2 gap-8 text-left sm:grid-cols-3 lg:grid-cols-6">
            {(p.items ?? []).map((it, i) => (
              <div key={i} className="border-t border-line pt-4">
                <dd className="text-3xl font-semibold tabular-nums" style={{ color }}>{it.value || '0'}</dd>
                <dt className="mt-1 text-sm text-muted">{it.label || 'Label'}</dt>
              </div>
            ))}
          </dl>
        </Section>
      );
    case 'contact':
      return (
        <Section template={template}>
          {p.heading && <h2 className={`mb-6 ${h2(template)}`} style={headingFont}>{p.heading}</h2>}
          <dl className="grid max-w-xl gap-4 text-sm">
            {p.email && <div><dt className="text-muted">Email</dt><dd><a className="font-medium" style={{ color }} href={`mailto:${p.email}`}>{p.email}</a></dd></div>}
            {p.phone && <div><dt className="text-muted">Phone</dt><dd><a className="font-medium" href={`tel:${p.phone.replace(/\s+/g, '')}`}>{p.phone}</a></dd></div>}
            {p.address && <div><dt className="text-muted">Address</dt><dd className="whitespace-pre-line">{p.address}</dd></div>}
            {!p.email && !p.phone && !p.address && editing && <Placeholder>Add contact details in the panel on the right.</Placeholder>}
          </dl>
        </Section>
      );
    default:
      return null;
  }
}

export function SiteBlocks({ blocks, data, theme, template, brandName }) {
  return <>{blocks.map((b) => <BlockView key={b.id} block={b} data={data} theme={theme} template={template} brandName={brandName} />)}</>;
}
