import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Globe, GripVertical, Home, MoreHorizontal, PenSquare, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Dropdown, DropdownItem, Input, Modal, Select, Skeleton, Switch, Textarea, toast } from '../../components/ui/index.js';
import { BLOCK_DEFS, newBlockId } from '../../components/site/blocks.jsx';
import { websiteApi } from '../../services/api/website.js';
import { workspaceApi } from '../../services/api/auth.js';
import { coursesApi } from '../../services/api/creator.js';
import { formatDate } from '../../utils/format.js';

const INDUSTRIES = ['Personal finance', 'Stock market & trading', 'Exam preparation', 'Programming & tech', 'Design', 'Digital marketing', 'Business & entrepreneurship', 'Language learning', 'Health & fitness', 'Yoga & wellness', 'Music', 'Art & crafts', 'Cooking', 'Photography', 'School tutoring', 'Spirituality'];

function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast.success('Copied'), () => toast.error('Copy failed'));
}

function useAcademyUrl() {
  const ws = useQuery({ queryKey: ['workspace'], queryFn: workspaceApi.workspace });
  const host = ws.data?.primaryHostname;
  return host ? `${window.location.protocol}//${host}${window.location.port ? `:${window.location.port}` : ''}` : null;
}

// ── Mode choice ──────────────────────────────────────────────

function ModeCard({ active, icon: Icon, title, description, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`flex flex-1 items-start gap-3 rounded-xl border-2 p-5 text-left transition-colors ${active ? 'border-primary-600 bg-primary-50 dark:bg-primary-950' : 'border-line hover:border-line-strong'}`}>
      <Icon className={`mt-0.5 size-5 shrink-0 ${active ? 'text-primary-600' : 'text-muted'}`} aria-hidden />
      <span><span className="block font-semibold">{title}</span><span className="mt-1 block text-sm text-muted">{description}</span></span>
    </button>
  );
}

// ── External website ─────────────────────────────────────────

function ExternalWebsite({ settings, academyUrl }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState(settings.externalUrl ?? '');
  const [error, setError] = useState(null);
  const courses = useQuery({ queryKey: ['creator', 'courses', 'all'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const save = useMutation({
    mutationFn: () => websiteApi.saveSettings({ mode: 'EXTERNAL', externalUrl: url.trim() }),
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ['website'] }); toast.success('Your website is now your academy home'); },
    onError: (e) => setError(e.details?.map((d) => d.message).join(' · ') ?? e.message),
  });
  const published = (courses.data?.items ?? []).filter((c) => c.status === 'PUBLISHED');
  const links = academyUrl ? [
    { label: 'All courses', url: `${academyUrl}/courses` },
    { label: 'Student sign in', url: `${academyUrl}/login` },
    { label: 'Student sign up', url: `${academyUrl}/register` },
    ...published.map((c) => ({ label: c.title, url: `${academyUrl}/courses/${c.slug}`, buy: `${academyUrl}/checkout/${c.slug}` })),
  ] : [];
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Your website address" description="Visitors who open your academy address are sent to this website. Courses, checkout and the student area stay here." />
        <CardBody>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <Input label="Website" type="url" placeholder="https://www.yourwebsite.com" value={url} onChange={(e) => setUrl(e.target.value)} className="w-96 max-w-full" error={error} required />
            <Button type="submit" loading={save.isPending} disabled={!url.trim()}>{settings.mode === 'EXTERNAL' ? 'Update' : 'Use my website'}</Button>
          </form>
          {settings.mode === 'EXTERNAL' && settings.externalUrl && <p className="mt-3 text-sm text-muted">Active: <a href={settings.externalUrl} target="_blank" rel="noreferrer noopener" className="font-medium text-primary-600 underline">{settings.externalUrl}</a></p>}
          <p className="mt-3 text-xs text-muted">Tip: to keep everything on your own domain, connect a subdomain such as <code>learn.yourwebsite.com</code> to this academy in <Link to="/creator/domains" className="text-primary-600 underline">Domains</Link>.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Links for your website" description="Add these to your website’s menu and course pages. Buy links go straight to checkout." />
        <CardBody className="divide-y divide-line p-0">
          {!academyUrl ? <div className="p-5"><Skeleton className="h-10" /></div> : links.map((l) => (
            <div key={l.url} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
              <span className="w-48 shrink-0 truncate font-medium">{l.label}</span>
              <code className="min-w-0 flex-1 truncate text-xs text-muted">{l.url}</code>
              <Button size="sm" variant="ghost" leftIcon={Copy} onClick={() => copy(l.url)}>Link</Button>
              {l.buy && <Button size="sm" variant="ghost" leftIcon={Copy} onClick={() => copy(`<a href="${l.buy}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600">Enrol now</a>`)}>Buy button</Button>}
            </div>
          ))}
          {academyUrl && !published.length && <p className="px-5 py-3 text-sm text-muted">Publish a course to get its links here.</p>}
        </CardBody>
      </Card>
    </div>
  );
}

// ── AI landing page ──────────────────────────────────────────

function Generator({ hasPage, onGenerated }) {
  const [v, setV] = useState({ industry: '', other: '', audience: '', tone: 'friendly', language: 'en', highlights: '' });
  const [confirm, setConfirm] = useState(false);
  const industry = v.industry === 'other' ? v.other.trim() : v.industry;
  const gen = useMutation({
    mutationFn: () => websiteApi.aiLanding({ industry, audience: v.audience.trim() || undefined, tone: v.tone, language: v.language, highlights: v.highlights.trim() || undefined }),
    onSuccess: (r) => { setConfirm(false); toast.success('Landing page drafted', { description: `${r.credits} AI credits used. Review it, then publish.` }); onGenerated(r.page); },
    onError: (e) => { setConfirm(false); toast.error(e.details?.[0]?.message ?? e.message); },
  });
  const run = () => (hasPage ? setConfirm(true) : gen.mutate());
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-primary-600" />AI landing page</span>} description="Built from your academy profile, your published courses and your answers. It never invents reviews, numbers or claims." />
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Industry" placeholder="Choose" value={v.industry} onChange={(e) => setV({ ...v, industry: e.target.value })} options={[...INDUSTRIES.map((i) => ({ value: i, label: i })), { value: 'other', label: 'Other…' }]} required />
          {v.industry === 'other' && <Input label="Your industry" value={v.other} maxLength={120} onChange={(e) => setV({ ...v, other: e.target.value })} />}
          <Input label="Who is it for? (optional)" placeholder="e.g. Salaried professionals in India" value={v.audience} maxLength={300} onChange={(e) => setV({ ...v, audience: e.target.value })} />
          <Select label="Tone" value={v.tone} onChange={(e) => setV({ ...v, tone: e.target.value })} options={[['friendly', 'Friendly'], ['professional', 'Professional'], ['energetic', 'Energetic'], ['premium', 'Premium']].map(([value, label]) => ({ value, label }))} />
          <Select label="Language" value={v.language} onChange={(e) => setV({ ...v, language: e.target.value })} options={[['en', 'English'], ['hi', 'हिन्दी (Hindi)'], ['gu', 'ગુજરાતી (Gujarati)']].map(([value, label]) => ({ value, label }))} />
        </div>
        <Textarea label="What makes you different? (optional)" rows={3} maxLength={1500} placeholder="Your experience, teaching style, what students achieve — in your own words." value={v.highlights} onChange={(e) => setV({ ...v, highlights: e.target.value })} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">Uses about 30–50 AI credits. The page is saved as a draft — nothing goes live until you publish.</p>
          <Button leftIcon={Wand2} loading={gen.isPending} disabled={industry.length < 2} onClick={run}>{hasPage ? 'Generate again' : 'Generate my landing page'}</Button>
        </div>
      </CardBody>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Replace the current draft?">
        <p className="text-sm text-fg-2">Your current draft is saved in the page history, so you can restore it later. The published page does not change until you publish.</p>
        <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button><Button loading={gen.isPending} onClick={() => gen.mutate()}>Generate</Button></div>
      </Modal>
    </Card>
  );
}


// ── Pages ────────────────────────────────────────────────────

const slugify = (t) => t.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80);
const RESERVED = new Set(['courses', 'learn', 'login', 'register', 'checkout', 'blog', 'verify', 'api', 'reset-password', 'forgot-password', 'verify-email', 'p']);
const block = (type, props) => ({ id: newBlockId(), type, hidden: false, props: { ...JSON.parse(JSON.stringify(BLOCK_DEFS[type].defaults)), ...props } });
/** Generic, true-for-every-academy answers so starter pages are valid immediately (edit freely). */
const STARTER_FAQ = { heading: 'Frequently asked questions', items: [
  { q: 'How do I access a course after enrolling?', a: 'Sign in and open My learning. Your courses are there on phone or computer.' },
  { q: 'How can I pay?', a: 'UPI, cards, net banking and wallets through Razorpay.' },
] };
/** Starting layouts for a new page (all editable in the builder). */
const STARTERS = {
  blank: { label: 'Blank page', blocks: () => [] },
  about: { label: 'About', blocks: (t) => [block('hero', { heading: t, subheading: '', ctaLabel: '', ctaHref: '' }), block('richText', {}), block('cta', {})] },
  courses: { label: 'Course spotlight', blocks: (t) => [block('hero', { heading: t }), block('courseGrid', { heading: 'Courses', mode: 'all', limit: 6 }), block('features', {}), block('faq', STARTER_FAQ), block('cta', {})] },
  contact: { label: 'Contact', blocks: (t) => [block('hero', { heading: t, subheading: 'We usually reply within a day.', ctaLabel: '', ctaHref: '' }), block('contact', { heading: 'Get in touch' }), block('faq', STARTER_FAQ)] },
  faq: { label: 'FAQ', blocks: (t) => [block('hero', { heading: t, ctaLabel: '', ctaHref: '' }), block('faq', STARTER_FAQ), block('cta', {})] },
};

function NewPageDialog({ open, onClose }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [v, setV] = useState({ title: '', slug: '', starter: 'blank', touched: false });
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setV({ title: '', slug: '', starter: 'blank', touched: false }); setError(null); } }, [open]);
  const create = useMutation({
    mutationFn: () => websiteApi.createPage({ title: v.title.trim(), slug: v.slug, draftBlocks: STARTERS[v.starter].blocks(v.title.trim()) }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['website'] }); onClose(); navigate(`/creator/website/pages/${p.id}`); },
    onError: (e) => setError(e.details?.map((d) => d.message).join(' · ') ?? e.message),
  });
  const slugProblem = !v.slug ? null : RESERVED.has(v.slug) ? 'This address is used by the academy itself' : !/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(v.slug) ? 'Use lowercase letters, numbers and dashes' : null;
  return (
    <Modal open={open} onClose={onClose} title="New page">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Input label="Page title" value={v.title} maxLength={120} required onChange={(e) => setV({ ...v, title: e.target.value, slug: v.touched ? v.slug : slugify(e.target.value) })} />
        <Input label="Address" value={v.slug} maxLength={80} hint={`/p/${v.slug || '…'}`} error={slugProblem} onChange={(e) => setV({ ...v, touched: true, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Start from</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(STARTERS).map(([k, st]) => (
              <button key={k} type="button" aria-pressed={v.starter === k} onClick={() => setV({ ...v, starter: k })}
                className={`rounded-md border-2 px-3 py-2 text-left text-sm ${v.starter === k ? 'border-primary-600 bg-primary-50 dark:bg-primary-950' : 'border-line hover:border-line-strong'}`}>{st.label}</button>
            ))}
          </div>
        </fieldset>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={create.isPending} disabled={!v.title.trim() || !v.slug || Boolean(slugProblem)}>Create and open builder</Button></div>
      </form>
    </Modal>
  );
}

function PageRow({ page, onToggleMenu, onSetHome, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });
  const status = !page.publishedAt ? ['Draft', 'neutral'] : page.hasUnpublishedChanges ? ['Unpublished changes', 'warning'] : ['Published', 'success'];
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${isDragging ? 'relative z-10 bg-surface shadow-md' : ''}`}>
      <button type="button" className="cursor-grab text-muted hover:text-fg" aria-label={`Drag ${page.title} to reorder the menu`} {...listeners} {...attributes}><GripVertical className="size-4" /></button>
      <div className="min-w-0 flex-1">
        <Link to={`/creator/website/pages/${page.id}`} className="font-medium hover:underline">{page.title}</Link>
        <p className="text-xs text-muted">{page.path}</p>
      </div>
      <Badge tone={status[1]}>{status[0]}</Badge>
      <Switch label="In menu" checked={page.showInNav} onChange={(v) => onToggleMenu(page, v)} />
      <Link to={`/creator/website/pages/${page.id}`}><Button size="sm" variant="secondary" leftIcon={PenSquare}>Edit</Button></Link>
      <Dropdown trigger={(t) => <Button size="icon-sm" variant="ghost" aria-label={`More actions for ${page.title}`} {...t}><MoreHorizontal className="size-4" /></Button>}>
        <DropdownItem icon={Home} onClick={() => onSetHome(page)}>Use as home page</DropdownItem>
        <DropdownItem icon={Trash2} danger onClick={() => onDelete(page)}>Delete page</DropdownItem>
      </Dropdown>
    </li>
  );
}

function PagesCard({ pages }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [order, setOrder] = useState(null);
  const others = pages.filter((p) => !p.isHome);
  const list = order ? order.map((id) => others.find((p) => p.id === id)).filter(Boolean) : others;
  const refresh = () => qc.invalidateQueries({ queryKey: ['website'] });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const reorder = useMutation({
    mutationFn: async (ids) => { for (const [i, pid] of ids.entries()) { const p = others.find((x) => x.id === pid); if (p && p.navOrder !== i + 1) await websiteApi.savePage(pid, { navOrder: i + 1 }); } },
    onSuccess: () => { setOrder(null); refresh(); }, onError: (e) => { setOrder(null); toast.error(e.message); },
  });
  const toggle = useMutation({ mutationFn: ({ page, v }) => websiteApi.savePage(page.id, { showInNav: v }), onSuccess: refresh, onError: (e) => toast.error(e.message) });
  const setHome = useMutation({ mutationFn: (page) => websiteApi.setHome(page.id), onSuccess: () => { refresh(); toast.success('Home page changed'); }, onError: (e) => toast.error(e.message) });
  const remove = useMutation({ mutationFn: (page) => websiteApi.deletePage(page.id), onSuccess: () => { setDeleting(null); refresh(); toast.success('Page deleted'); }, onError: (e) => { setDeleting(null); toast.error(e.message); } });
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const ids = list.map((p) => p.id);
    const next = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id));
    setOrder(next);
    reorder.mutate(next);
  };
  return (
    <Card>
      <CardHeader title="Other pages" description="About, contact, workshops… Drag to change their order in the site menu." actions={<Button size="sm" leftIcon={Plus} onClick={() => setOpen(true)}>New page</Button>} />
      {list.length === 0 ? <CardBody><p className="text-sm text-muted">No other pages yet. Add an About or Contact page, or anything else you need.</p></CardBody> : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={list.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <ul className="divide-y divide-line" aria-label="Pages">
              {list.map((p) => <PageRow key={p.id} page={p} onToggleMenu={(page, v) => toggle.mutate({ page, v })} onSetHome={(page) => setHome.mutate(page)} onDelete={setDeleting} />)}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      <NewPageDialog open={open} onClose={() => setOpen(false)} />
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting)} loading={remove.isPending} title={`Delete “${deleting?.title}”?`} description="The page and its history are removed. Links to it will stop working." confirmLabel="Delete page" />
    </Card>
  );
}

function HomeCard({ home }) {
  const status = !home.publishedAt ? ['Not published yet', 'neutral'] : home.hasUnpublishedChanges ? ['Unpublished changes', 'warning'] : ['Published', 'success'];
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center gap-3">
        <Home className="size-5 text-primary-600" aria-hidden />
        <div className="min-w-0 flex-1"><p className="font-semibold">Home page</p><p className="text-sm text-muted">{home.title} · {home.publishedAt ? `published ${formatDate(home.publishedAt, { withTime: true })}` : 'draft'}</p></div>
        <Badge tone={status[1]}>{status[0]}</Badge>
        <Link to={`/creator/website/pages/${home.id}`}><Button leftIcon={PenSquare}>Open in builder</Button></Link>
      </CardBody>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────

export function WebsitePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const academyUrl = useAcademyUrl();
  const q = useQuery({ queryKey: ['website', 'overview'], queryFn: websiteApi.overview });
  const [choice, setChoice] = useState(null);
  const usePlatform = useMutation({ mutationFn: () => websiteApi.saveSettings({ mode: 'PLATFORM' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['website'] }); toast.success('Your academy home is served by us again'); }, onError: (e) => toast.error(e.message) });
  const settings = q.data?.settings;
  const mode = choice ?? settings?.mode ?? 'PLATFORM';
  const pages = q.data?.pages ?? [];
  const home = pages.find((p) => p.isHome);
  return (
    <>
      <PageHeader title="Website" description="Your academy’s public pages." breadcrumbs={[{ label: 'Website' }]}
        actions={academyUrl && <a href={academyUrl} target="_blank" rel="noreferrer noopener"><Button variant="secondary" leftIcon={ExternalLink}>Open my academy</Button></a>} />
      {!settings ? <Skeleton className="h-40" /> : (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            <ModeCard active={mode === 'PLATFORM'} icon={Sparkles} title="Website on this platform" description="An AI landing page from your profile and courses, plus any pages you build with drag and drop." onClick={() => setChoice('PLATFORM')} />
            <ModeCard active={mode === 'EXTERNAL'} icon={Globe} title="My own website" description="Already have a website? Send visitors there and link to your courses from it." onClick={() => setChoice('EXTERNAL')} />
          </div>
          {mode === 'PLATFORM' && settings.mode === 'EXTERNAL' && (
            <Alert tone="info" title="Your academy home currently redirects to your website">
              <div className="mt-2"><Button size="sm" loading={usePlatform.isPending} onClick={() => usePlatform.mutate()}>Use pages on this platform instead</Button></div>
            </Alert>
          )}
          {mode === 'EXTERNAL' ? <ExternalWebsite settings={settings} academyUrl={academyUrl} /> : (
            <>
              <Generator hasPage={Boolean(home)} onGenerated={(page) => { qc.invalidateQueries({ queryKey: ['website'] }); if (page?.id) navigate(`/creator/website/pages/${page.id}`); }} />
              {home ? <HomeCard home={home} /> : <Card><CardBody><p className="text-sm text-muted">Until you publish a home page, your academy home shows your logo, tagline and course catalogue automatically.</p></CardBody></Card>}
              <PagesCard pages={pages} />
            </>
          )}
        </div>
      )}
    </>
  );
}
