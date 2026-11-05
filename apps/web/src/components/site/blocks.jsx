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
  hero: { label: 'Hero', icon: LayoutTemplate, defaults: { heading: 'Your headline', subheading: '', ctaLabel: 'Browse courses', ctaHref: '/courses', imageFileId: null, align: 'center' },
    fields: [{ key: 'heading', label: 'Heading', type: 'text', max: 120 }, { key: 'subheading', label: 'Subheading', type: 'textarea', max: 300 }, { key: 'ctaLabel', label: 'Button label', type: 'text', max: 40 }, { key: 'ctaHref', label: 'Button link', type: 'href' }, { key: 'imageFileId', label: 'Background image', type: 'image' }, { key: 'align', label: 'Alignment', type: 'select', options: [['center', 'Centered'], ['left', 'Left']] }] },
  richText: { label: 'Text', icon: Type, defaults: { content: emptyDoc }, fields: [{ key: 'content', label: 'Content', type: 'richtext' }] },
  courseGrid: { label: 'Course grid', icon: BookOpen, defaults: { heading: 'Courses', mode: 'all', courseIds: [], limit: 6 },
    fields: [{ key: 'heading', label: 'Heading', type: 'text', max: 120 }, { key: 'mode', label: 'Show', type: 'select', options: [['all', 'Latest published courses'], ['selected', 'Courses I choose']] }, { key: 'limit', label: 'How many', type: 'number', min: 1, max: 24, when: (p) => p.mode === 'all' }, { key: 'courseIds', label: 'Courses', type: 'courses', when: (p) => p.mode === 'selected' }] },
  features: { label: 'Features', icon: Sparkles, defaults: { heading: 'Why learn with us', items: [{ title: 'Feature', text: '' }] },
    fields: [{ key: 'heading', label: 'Heading', type: 'text', max: 120 }, { key: 'items', label: 'Items', type: 'list', max: 12, item: [{ key: 'title', label: 'Title', type: 'text', max: 80 }, { key: 'text', label: 'Text', type: 'textarea', max: 300 }], blank: { title: '', text: '' } }] },
  testimonials: { label: 'Testimonials', icon: MessageSquareQuote, defaults: { heading: 'What students say', items: [{ quote: '', name: '', role: '' }] },
    fields: [{ key: 'heading', label: 'Heading', type: 'text', max: 120 }, { key: 'items', label: 'Testimonials', type: 'list', max: 12, item: [{ key: 'quote', label: 'Quote', type: 'textarea', max: 500 }, { key: 'name', label: 'Name', type: 'text', max: 80 }, { key: 'role', label: 'Role', type: 'text', max: 80 }], blank: { quote: '', name: '', role: '' } }] },
  faq: { label: 'FAQ', icon: CircleHelp, defaults: { heading: 'Frequently asked questions', items: [{ q: '', a: '' }] },
    fields: [{ key: 'heading', label: 'Heading', type: 'text', max: 120 }, { key: 'items', label: 'Questions', type: 'list', max: 30, item: [{ key: 'q', label: 'Question', type: 'text', max: 200 }, { key: 'a', label: 'Answer', type: 'textarea', max: 2000 }], blank: { q: '', a: '' } }] },
  cta: { label: 'Call to action', icon: Megaphone, defaults: { heading: 'Ready to start?', text: '', buttonLabel: 'Browse courses', buttonHref: '/courses' },
    fields: [{ key: 'heading', label: 'Heading', type: 'text', max: 120 }, { key: 'text', label: 'Text', type: 'textarea', max: 300 }, { key: 'buttonLabel', label: 'Button label', type: 'text', max: 40 }, { key: 'buttonHref', label: 'Button link', type: 'href' }] },
  image: { label: 'Image', icon: ImageIcon, defaults: { fileId: null, alt: '', caption: '' },
    fields: [{ key: 'fileId', label: 'Image', type: 'image' }, { key: 'alt', label: 'Alt text (for screen readers)', type: 'text', max: 160 }, { key: 'caption', label: 'Caption', type: 'text', max: 200 }] },
  video: { label: 'Video', icon: PlayCircle, defaults: { url: '', caption: '' }, fields: [{ key: 'url', label: 'YouTube or Vimeo link', type: 'text', max: 300 }, { key: 'caption', label: 'Caption', type: 'text', max: 200 }] },
  instructor: { label: 'Instructor', icon: UserRound, defaults: { name: '', title: '', bio: '', photoFileId: null },
    fields: [{ key: 'name', label: 'Name', type: 'text', max: 80 }, { key: 'title', label: 'Title', type: 'text', max: 120 }, { key: 'bio', label: 'Bio', type: 'textarea', max: 1500 }, { key: 'photoFileId', label: 'Photo', type: 'image' }] },
  stats: { label: 'Stats', icon: BarChart3, defaults: { items: [{ value: '', label: '' }] },
    fields: [{ key: 'items', label: 'Numbers', type: 'list', max: 6, item: [{ key: 'value', label: 'Value', type: 'text', max: 20 }, { key: 'label', label: 'Label', type: 'text', max: 60 }], blank: { value: '', label: '' } }] },
  contact: { label: 'Contact', icon: Mail, defaults: { heading: 'Get in touch', email: '', phone: '', address: '' },
    fields: [{ key: 'heading', label: 'Heading', type: 'text', max: 120 }, { key: 'email', label: 'Email', type: 'text', max: 191 }, { key: 'phone', label: 'Phone', type: 'text', max: 30 }, { key: 'address', label: 'Address', type: 'textarea', max: 300 }] },
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

const sectionPad = (t) => (t === 'minimal' ? 'py-14' : t === 'bold' ? 'py-20' : 'py-16');
const h2 = (t) => (t === 'bold' ? 'text-3xl font-bold tracking-tight sm:text-4xl' : 'text-2xl font-semibold tracking-tight');

function Section({ template, children, tinted, color }) {
  return (
    <section className={sectionPad(template)} style={tinted && color ? { background: `${color}0d` } : undefined}>
      <div className="mx-auto max-w-6xl px-4">{children}</div>
    </section>
  );
}

const Placeholder = ({ children }) => <div className="rounded-lg border-2 border-dashed border-line p-8 text-center text-sm text-muted">{children}</div>;

/** Renders one block. `editing` shows placeholders for incomplete content instead of hiding it. */
export function BlockView({ block, data, theme = {}, template = 'classic', editing = false }) {
  const p = block.props ?? {};
  const color = theme.primaryColor ?? '#4f46e5';
  const file = (id) => (id ? data?.files?.[id] : null);
  const headingFont = theme.fontHeading ? { fontFamily: theme.fontHeading } : undefined;
  switch (block.type) {
    case 'hero': {
      const img = file(p.imageFileId);
      const center = p.align !== 'left';
      const bold = template === 'bold';
      return (
        <section className={`relative overflow-hidden ${bold ? 'py-28' : 'py-20'}`} style={{ background: img ? undefined : bold ? color : `${color}12` }}>
          {img && <><img src={img} alt="" className="absolute inset-0 size-full object-cover" /><div className="absolute inset-0 bg-black/50" /></>}
          <div className={`relative mx-auto max-w-6xl px-4 ${center ? 'text-center' : ''}`}>
            <h1 className={`${bold ? 'text-5xl font-extrabold' : 'text-4xl font-semibold'} tracking-tight sm:text-5xl ${img || bold ? 'text-white' : ''}`} style={headingFont}>{p.heading}</h1>
            {p.subheading && <p className={`mt-4 max-w-2xl text-lg ${center ? 'mx-auto' : ''} ${img || bold ? 'text-white/85' : 'text-fg-2'}`}>{p.subheading}</p>}
            {p.ctaLabel && p.ctaHref && (
              <SmartLink href={p.ctaHref} className={`mt-8 inline-flex h-11 items-center rounded-md px-6 font-medium ${img || bold ? 'bg-white text-gray-900' : 'text-white'}`} style={img || bold ? undefined : { background: color }}>{p.ctaLabel}</SmartLink>
            )}
          </div>
        </section>
      );
    }
    case 'richText':
      return <Section template={template}><div className="max-w-3xl"><RichTextView value={p.content} /></div></Section>;
    case 'courseGrid': {
      const list = data?.courses?.[block.id];
      return (
        <Section template={template}>
          {p.heading && <h2 className={`mb-8 ${h2(template)}`} style={headingFont}>{p.heading}</h2>}
          {list?.length ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{list.map((c) => <CourseCard key={c.id} c={{ ...c, studentCount: c.studentCount ?? 0 }} color={color} />)}</div>
            : editing ? <Placeholder>{p.mode === 'selected' ? 'Choose courses in the panel on the right.' : 'Your published courses appear here.'}</Placeholder> : null}
        </Section>
      );
    }
    case 'features':
      return (
        <Section template={template} tinted color={color}>
          {p.heading && <h2 className={`mb-8 text-center ${h2(template)}`} style={headingFont}>{p.heading}</h2>}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{(p.items ?? []).map((it, i) => (
            <div key={i} className="rounded-xl bg-surface p-6 shadow-xs ring-1 ring-line"><p className="font-semibold">{it.title || (editing ? 'Title' : '')}</p>{it.text && <p className="mt-2 text-sm text-fg-2">{it.text}</p>}</div>
          ))}</div>
        </Section>
      );
    case 'testimonials':
      return (
        <Section template={template}>
          {p.heading && <h2 className={`mb-8 text-center ${h2(template)}`} style={headingFont}>{p.heading}</h2>}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{(p.items ?? []).filter((it) => editing || it.quote).map((it, i) => (
            <figure key={i} className="rounded-xl border border-line bg-surface p-6"><blockquote className="text-fg-2">“{it.quote || 'Quote'}”</blockquote><figcaption className="mt-4 text-sm"><span className="font-semibold">{it.name || 'Name'}</span>{it.role && <span className="text-muted"> · {it.role}</span>}</figcaption></figure>
          ))}</div>
        </Section>
      );
    case 'faq':
      return (
        <Section template={template}>
          {p.heading && <h2 className={`mb-6 ${h2(template)}`} style={headingFont}>{p.heading}</h2>}
          <div className="max-w-3xl divide-y divide-line rounded-xl border border-line bg-surface">{(p.items ?? []).map((it, i) => (
            <details key={i} className="group p-5"><summary className="cursor-pointer list-none font-medium marker:hidden">{it.q || 'Question'}</summary><p className="mt-3 whitespace-pre-line text-sm text-fg-2">{it.a}</p></details>
          ))}</div>
        </Section>
      );
    case 'cta':
      return (
        <section className={sectionPad(template)}>
          <div className="mx-auto max-w-4xl px-4">
            <div className="rounded-2xl px-8 py-12 text-center text-white" style={{ background: color }}>
              <h2 className="text-3xl font-semibold tracking-tight" style={headingFont}>{p.heading}</h2>
              {p.text && <p className="mx-auto mt-3 max-w-xl text-white/85">{p.text}</p>}
              <SmartLink href={p.buttonHref} className="mt-6 inline-flex h-11 items-center rounded-md bg-white px-6 font-medium text-gray-900">{p.buttonLabel}</SmartLink>
            </div>
          </div>
        </section>
      );
    case 'image': {
      const src = file(p.fileId);
      return <Section template={template}>{src ? <figure><img src={src} alt={p.alt} className="w-full rounded-xl" loading="lazy" />{p.caption && <figcaption className="mt-2 text-center text-sm text-muted">{p.caption}</figcaption>}</figure> : editing ? <Placeholder>Upload an image in the panel on the right.</Placeholder> : null}</Section>;
    }
    case 'video': {
      const src = embedUrl(p.url);
      return <Section template={template}>{src ? <figure><div className="aspect-video overflow-hidden rounded-xl bg-black"><iframe src={src} title={p.caption || 'Video'} className="size-full" allow="accelerometer; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" /></div>{p.caption && <figcaption className="mt-2 text-center text-sm text-muted">{p.caption}</figcaption>}</figure> : editing ? <Placeholder>Paste a YouTube or Vimeo link.</Placeholder> : null}</Section>;
    }
    case 'instructor': {
      const photo = file(p.photoFileId);
      return (
        <Section template={template}>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            {photo ? <img src={photo} alt={p.name} className="size-32 shrink-0 rounded-full object-cover" /> : <div className="grid size-32 shrink-0 place-items-center rounded-full bg-surface-2"><UserRound className="size-10 text-line-strong" /></div>}
            <div><h2 className={h2(template)} style={headingFont}>{p.name || (editing ? 'Instructor name' : '')}</h2>{p.title && <p className="text-muted">{p.title}</p>}<p className="mt-3 whitespace-pre-line text-fg-2">{p.bio}</p></div>
          </div>
        </Section>
      );
    }
    case 'stats':
      return (
        <Section template={template} tinted color={color}>
          <dl className="grid grid-cols-2 gap-6 text-center sm:grid-cols-3 lg:grid-cols-6">{(p.items ?? []).map((it, i) => (
            <div key={i}><dt className="order-2 text-sm text-muted">{it.label || 'Label'}</dt><dd className="text-3xl font-bold" style={{ color }}>{it.value || '0'}</dd></div>
          ))}</dl>
        </Section>
      );
    case 'contact':
      return (
        <Section template={template}>
          {p.heading && <h2 className={`mb-6 ${h2(template)}`} style={headingFont}>{p.heading}</h2>}
          <dl className="grid max-w-xl gap-3 text-sm">
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

export function SiteBlocks({ blocks, data, theme, template }) {
  return <>{blocks.map((b) => <BlockView key={b.id} block={b} data={data} theme={theme} template={template} />)}</>;
}
