import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Copy, ExternalLink, Eye, EyeOff, Globe, History, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Dropdown, DropdownItem, Input, Modal, Select, Skeleton, Textarea, toast } from '../../components/ui/index.js';
import { RichTextEditor } from '../../components/forms/RichTextEditor.jsx';
import { FileUpload } from '../../components/forms/FileUpload.jsx';
import { BLOCK_DEFS, SiteBlocks } from '../../components/site/blocks.jsx';
import { websiteApi } from '../../services/api/website.js';
import { workspaceApi } from '../../services/api/auth.js';
import { academyApi2, coursesApi } from '../../services/api/creator.js';
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

function Field({ f, value, onChange, courses, files }) {
  if (f.type === 'textarea') return <Textarea label={f.label} rows={3} maxLength={f.max} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  if (f.type === 'select') return <Select label={f.label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} options={f.options.map(([v, l]) => ({ value: v, label: l }))} />;
  if (f.type === 'number') return <Input label={f.label} type="number" min={f.min} max={f.max} value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} />;
  if (f.type === 'richtext') return <RichTextEditor label={f.label} value={value} onChange={onChange} minHeight={140} />;
  if (f.type === 'image') return <FileUpload purpose="IMAGE" accept="image/png,image/jpeg,image/webp" label={f.label} value={value ? { id: value, url: files?.[value] } : null} onUploaded={(file) => onChange(file.id, file.url)} onClear={() => onChange(null)} />;
  if (f.type === 'courses') {
    const ids = value ?? [];
    return (
      <fieldset><legend className="mb-1 text-sm font-medium">{f.label}</legend>
        <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-line p-3">
          {courses.map((c) => <Checkbox key={c.id} label={c.title} checked={ids.includes(c.id)} onChange={() => onChange(ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id])} />)}
        </div>
      </fieldset>
    );
  }
  if (f.type === 'list') {
    const items = value ?? [];
    const set = (i, patch) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
    return (
      <fieldset className="space-y-2"><legend className="text-sm font-medium">{f.label}</legend>
        {items.map((it, i) => (
          <div key={i} className="space-y-2 rounded-md border border-line p-3">
            {f.item.map((sub) => <Field key={sub.key} f={sub} value={it[sub.key]} onChange={(val) => set(i, { [sub.key]: val })} courses={courses} />)}
            <div className="text-right"><Button size="sm" variant="ghost" leftIcon={Trash2} onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</Button></div>
          </div>
        ))}
        {items.length < f.max && <Button size="sm" variant="secondary" onClick={() => onChange([...items, { ...f.blank }])}>Add</Button>}
      </fieldset>
    );
  }
  return <Input label={f.label} maxLength={f.max ?? 500} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={f.type === 'href' ? '/courses or https://…' : undefined} />;
}

function BlockEditor({ block, index, total, courses, files, onChange, onMove, onRemove }) {
  const def = BLOCK_DEFS[block.type];
  const [open, setOpen] = useState(index === 0);
  if (!def) return null;
  const Icon = def.icon;
  return (
    <div className={`rounded-lg border border-line ${block.hidden ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" className="flex flex-1 items-center gap-2 text-left text-sm font-medium" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon className="size-4 text-muted" aria-hidden />{def.label}{block.hidden && <Badge>Hidden</Badge>}
        </button>
        <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={index === total - 1} onClick={() => onMove(1)}><ArrowDown className="size-4" /></Button>
        <Button size="icon-sm" variant="ghost" aria-label={block.hidden ? 'Show block' : 'Hide block'} onClick={() => onChange({ hidden: !block.hidden })}>{block.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button>
        <Button size="icon-sm" variant="ghost" aria-label="Remove block" onClick={onRemove}><Trash2 className="size-4" /></Button>
      </div>
      {open && (
        <div className="space-y-3 border-t border-line p-3">
          {def.fields.filter((f) => !f.when || f.when(block.props)).map((f) => (
            <Field key={f.key} f={f} value={block.props[f.key]} courses={courses} files={files}
              onChange={(val, url) => onChange({ props: { ...block.props, [f.key]: val } }, url ? { [val]: url } : undefined)} />
          ))}
        </div>
      )}
    </div>
  );
}

function LandingEditor({ pageId, academyUrl, site }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['website', 'page', pageId], queryFn: () => websiteApi.page(pageId) });
  const versions = useQuery({ queryKey: ['website', 'versions', pageId], queryFn: () => websiteApi.versions(pageId) });
  const courses = useQuery({ queryKey: ['creator', 'courses', 'all'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const [draft, setDraft] = useState(null);
  const [files, setFiles] = useState({});
  const [errors, setErrors] = useState([]);
  useEffect(() => { if (q.data) { setDraft({ blocks: q.data.draftBlocks, seoTitle: q.data.seoTitle ?? '', seoDescription: q.data.seoDescription ?? '' }); setFiles(q.data.files ?? {}); } }, [q.data]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['website'] }); };
  const save = useMutation({
    mutationFn: () => websiteApi.savePage(pageId, { draftBlocks: draft.blocks, seoTitle: draft.seoTitle || null, seoDescription: draft.seoDescription || null }),
    onSuccess: (p) => { setErrors([]); qc.setQueryData(['website', 'page', pageId], p); toast.success('Draft saved'); },
    onError: (e) => { setErrors(e.details ?? []); toast.error(e.message); },
  });
  const publish = useMutation({
    mutationFn: async () => { await websiteApi.savePage(pageId, { draftBlocks: draft.blocks, seoTitle: draft.seoTitle || null, seoDescription: draft.seoDescription || null }); return websiteApi.publish(pageId, 'Published from the website page'); },
    onSuccess: (p) => { setErrors([]); qc.setQueryData(['website', 'page', pageId], p); refresh(); toast.success('Your landing page is live'); },
    onError: (e) => { setErrors(e.details ?? []); toast.error(e.message); },
  });
  const restore = useMutation({ mutationFn: (versionId) => websiteApi.restore(pageId, versionId), onSuccess: (p) => { qc.setQueryData(['website', 'page', pageId], p); toast.success('Version restored to the draft'); }, onError: (e) => toast.error(e.message) });
  const openPreview = useMutation({ mutationFn: async () => { await websiteApi.savePage(pageId, { draftBlocks: draft.blocks }); return websiteApi.previewToken(); }, onSuccess: ({ token }) => window.open(`${academyUrl}/?preview=${encodeURIComponent(token)}`, '_blank', 'noopener'), onError: (e) => toast.error(e.message) });

  const published = (courses.data?.items ?? []).filter((c) => c.status === 'PUBLISHED');
  const previewData = useMemo(() => {
    const cardsFor = (b) => {
      const list = b.props.mode === 'selected' ? (b.props.courseIds ?? []).map((id) => published.find((c) => c.id === id)).filter(Boolean) : published.slice(0, b.props.limit ?? 6);
      return list.map((c) => ({ id: c.id, slug: c.slug, title: c.title, shortDescription: c.shortDescription, isFree: c.isFree, priceAmount: c.priceAmount, currency: c.currency, thumbnailUrl: c.thumbnailUrl ?? null }));
    };
    return { files, courses: Object.fromEntries((draft?.blocks ?? []).filter((b) => b.type === 'courseGrid').map((b) => [b.id, cardsFor(b)])) };
  }, [draft, files, published]);

  if (!draft) return <Skeleton className="h-96" />;
  const setBlock = (i, patch, newFiles) => { if (newFiles) setFiles((f) => ({ ...f, ...newFiles })); setDraft({ ...draft, blocks: draft.blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)) }); };
  const move = (i, dir) => { const b = [...draft.blocks]; [b[i], b[i + dir]] = [b[i + dir], b[i]]; setDraft({ ...draft, blocks: b }); };
  const p = q.data;
  return (
    <Card>
      <CardHeader title="Home page" description={p.publishedAt ? `Published ${formatDate(p.publishedAt, { withTime: true })}${p.hasUnpublishedChanges ? ' · draft has unpublished changes' : ''}` : 'Not published yet'}
        actions={(
          <div className="flex flex-wrap gap-2">
            {versions.data?.length > 0 && (
              <Dropdown trigger={(t) => <Button size="sm" variant="ghost" leftIcon={History} {...t}>History</Button>}>
                {versions.data.slice(0, 10).map((v) => <DropdownItem key={v.id} onClick={() => restore.mutate(v.id)}>{v.note ?? 'Published version'} · {formatDate(v.createdAt, { withTime: true })}</DropdownItem>)}
              </Dropdown>
            )}
            {academyUrl && <Button size="sm" variant="secondary" leftIcon={ExternalLink} loading={openPreview.isPending} onClick={() => openPreview.mutate()}>Preview on site</Button>}
            <Button size="sm" variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>Save draft</Button>
            <Button size="sm" loading={publish.isPending} onClick={() => publish.mutate()}>Publish</Button>
          </div>
        )} />
      <CardBody className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <div className="space-y-3">
          {errors.length > 0 && <Alert tone="error" title="Fix these before saving">{errors.slice(0, 5).map((e) => <div key={e.field}>{e.message}</div>)}</Alert>}
          {draft.blocks.map((b, i) => (
            <BlockEditor key={b.id} block={b} index={i} total={draft.blocks.length} courses={published} files={files}
              onChange={(patch, newFiles) => setBlock(i, patch, newFiles)} onMove={(dir) => move(i, dir)} onRemove={() => setDraft({ ...draft, blocks: draft.blocks.filter((_, j) => j !== i) })} />
          ))}
          <div className="space-y-3 rounded-lg border border-line p-3">
            <p className="text-sm font-medium">Search engines</p>
            <Input label="Page title" maxLength={70} value={draft.seoTitle} onChange={(e) => setDraft({ ...draft, seoTitle: e.target.value })} hint={`${draft.seoTitle.length}/70`} />
            <Textarea label="Description" rows={2} maxLength={170} value={draft.seoDescription} onChange={(e) => setDraft({ ...draft, seoDescription: e.target.value })} hint={`${draft.seoDescription.length}/170`} />
          </div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-lg border border-line" aria-label="Page preview">
          <div className="border-b border-line bg-surface-2 px-3 py-1.5 text-xs text-muted">Preview</div>
          <div className="max-h-[80vh] overflow-y-auto bg-surface" style={{ fontFamily: site?.theme?.fontBody }}>
            <SiteBlocks blocks={draft.blocks.filter((b) => !b.hidden)} data={previewData} theme={site?.theme} template="classic" />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────

export function WebsitePage() {
  const qc = useQueryClient();
  const academyUrl = useAcademyUrl();
  const q = useQuery({ queryKey: ['website', 'overview'], queryFn: websiteApi.overview });
  const brand = useQuery({ queryKey: ['creator', 'academy'], queryFn: academyApi2.get, staleTime: 5 * 60_000 });
  const [choice, setChoice] = useState(null);
  const usePlatform = useMutation({ mutationFn: () => websiteApi.saveSettings({ mode: 'PLATFORM' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['website'] }); toast.success('Your academy home is served by us again'); }, onError: (e) => toast.error(e.message) });
  const settings = q.data?.settings;
  const mode = choice ?? settings?.mode ?? 'PLATFORM';
  const home = q.data?.pages?.find((p) => p.isHome);
  const a = brand.data?.academy ?? brand.data ?? {};
  const site = { theme: { primaryColor: a.primaryColor ?? '#4f46e5', fontHeading: a.fontHeading, fontBody: a.fontBody } };
  return (
    <>
      <PageHeader title="Website" description="Your academy’s public home page." breadcrumbs={[{ label: 'Website' }]}
        actions={academyUrl && <a href={academyUrl} target="_blank" rel="noreferrer noopener"><Button variant="secondary" leftIcon={ExternalLink}>Open my academy</Button></a>} />
      {!settings ? <Skeleton className="h-40" /> : (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            <ModeCard active={mode === 'PLATFORM'} icon={Sparkles} title="AI landing page" description="We build your home page from your profile, courses and industry. Edit anything, then publish." onClick={() => setChoice('PLATFORM')} />
            <ModeCard active={mode === 'EXTERNAL'} icon={Globe} title="My own website" description="Already have a website? Send visitors there and link to your courses from it." onClick={() => setChoice('EXTERNAL')} />
          </div>
          {mode === 'PLATFORM' && settings.mode === 'EXTERNAL' && (
            <Alert tone="info" title="Your academy home currently redirects to your website">
              <div className="mt-2"><Button size="sm" loading={usePlatform.isPending} onClick={() => usePlatform.mutate()}>Use the landing page instead</Button></div>
            </Alert>
          )}
          {mode === 'EXTERNAL' ? <ExternalWebsite settings={settings} academyUrl={academyUrl} /> : (
            <>
              <Generator hasPage={Boolean(home)} onGenerated={() => qc.invalidateQueries({ queryKey: ['website'] })} />
              {home ? <LandingEditor key={home.id} pageId={home.id} academyUrl={academyUrl} site={site} /> : (
                <Card><CardBody><p className="text-sm text-muted">Until you publish a landing page, your academy home shows your logo, tagline and course catalogue automatically.</p></CardBody></Card>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

