import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Mail, Plus, Send, Trash2, Upload, Users, Workflow } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { ListToolbar } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { PERIOD_OPTIONS, inPeriod } from '../../utils/period.js';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { RichTextEditor } from '../../components/forms/RichTextEditor.jsx';
import { Avatar, Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, Drawer, EmptyState, Input, Modal, Select, Skeleton, StatusBadge, Tabs, Textarea, toast } from '../../components/ui/index.js';
import { marketingApi, parseContacts } from '../../services/api/marketing.js';
import { coursesApi } from '../../services/api/creator.js';
import { batchesApi } from '../../services/api/live.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDate } from '../../utils/format.js';

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
const TRIGGERS = [['student.registered', 'A student signs up'], ['course.enrolled', 'A student enrols in a course'], ['course.completed', 'A student completes a course'], ['order.paid', 'A purchase is paid'], ['lead.created', 'A new contact is added']];
const STEP_LABELS = { notify: 'In-app notification', email: 'Send email', wait: 'Wait', tag: 'Add tag', enroll: 'Enrol in course', batch: 'Add to batch' };

// ── Contacts ────────────────────────────────────────────────
function ContactDrawer({ id, onClose }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['marketing', 'lead', id], queryFn: () => marketingApi.lead(id), enabled: Boolean(id) });
  const [tags, setTags] = useState(null);
  const [erase, setErase] = useState(false);
  const save = useMutation({ mutationFn: () => marketingApi.updateLead(id, { tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['marketing'] }); setTags(null); toast.success('Saved'); } });
  const del = useMutation({ mutationFn: () => marketingApi.eraseLead(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['marketing'] }); setErase(false); onClose(); toast.success('Contact erased'); } });
  const l = q.data;
  return (
    <Drawer open={Boolean(id)} onClose={onClose} title={l?.name || l?.email || 'Contact'}>
      {!l ? <Skeleton className="h-40" /> : (
        <div className="space-y-5 text-sm">
          <dl className="grid grid-cols-3 gap-2"><dt className="text-muted">Email</dt><dd className="col-span-2 break-all">{l.email}</dd><dt className="text-muted">Source</dt><dd className="col-span-2">{l.source}</dd><dt className="text-muted">Added</dt><dd className="col-span-2">{formatDate(l.createdAt)}</dd>
            <dt className="text-muted">Marketing</dt><dd className="col-span-2">{l.canEmail ? <Badge tone="success">Can email</Badge> : l.unsubscribedAt ? <Badge>Unsubscribed</Badge> : <Badge>No consent</Badge>}</dd></dl>
          <div className="space-y-2">
            <Input label="Tags (comma separated)" value={tags ?? (l.tags ?? []).join(', ')} onChange={(e) => setTags(e.target.value)} />
            {tags !== null && <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Save tags</Button>}
          </div>
          <div><p className="mb-1 font-semibold">Consent history</p>{l.consentHistory.length ? <ul className="space-y-1">{l.consentHistory.map((e, i) => <li key={i} className="text-muted">{e.action === 'GRANTED' ? 'Agreed' : 'Withdrew'} · {e.source} · {formatDate(e.createdAt, { withTime: true })}</li>)}</ul> : <p className="text-muted">No consent recorded.</p>}</div>
          <Button variant="ghost" className="text-red-600" onClick={() => setErase(true)}>Erase contact</Button>
          <ConfirmDialog open={erase} onClose={() => setErase(false)} title="Erase this contact?" description="Removes the contact and their consent history (right to erasure). This cannot be undone." confirmLabel="Erase" loading={del.isPending} onConfirm={() => del.mutate()} />
        </div>
      )}
    </Drawer>
  );
}

function ImportModal({ open, onClose }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [confirm, setConfirm] = useState(false);
  const rows = parseContacts(text);
  const imp = useMutation({ mutationFn: () => marketingApi.importLeads(rows, confirm), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['marketing'] }); toast.success(`${r.created} added, ${r.updated} updated${r.invalid.length ? `, ${r.invalid.length} invalid` : ''}`); setText(''); onClose(); }, onError: (e) => toast.error(e.message) });
  return (
    <Modal open={open} onClose={onClose} title="Import contacts" size="lg">
      <div className="space-y-4">
        <Textarea label="Paste contacts — one per line: email, name, tag1;tag2" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'priya@example.com, Priya, webinar;vip\nraj@example.com'} />
        <Checkbox label="These people agreed to receive marketing email from me" description="Leave unticked if you are not sure — they are added as contacts you cannot email campaigns to." checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button leftIcon={Upload} disabled={!rows.length} loading={imp.isPending} onClick={() => imp.mutate()}>Import {rows.length || ''}</Button></div>
      </div>
    </Modal>
  );
}

function Contacts() {
  const [params, update] = useListParams();
  const [selected, setSelected] = useState(null);
  const [importing, setImporting] = useState(false);
  const q = useQuery({ queryKey: ['marketing', 'leads', params], queryFn: () => marketingApi.leads(params), placeholderData: (p) => p });
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <SearchInput className="sm:w-72" value={params.q ?? ''} onChange={(v) => update({ q: v })} placeholder="Search name or email" />
        <Select aria-label="Consent" className="sm:w-48" value={params.consent ?? ''} onChange={(e) => update({ consent: e.target.value || undefined })} options={[{ value: '', label: 'All contacts' }, { value: 'yes', label: 'Can email' }, { value: 'no', label: 'Cannot email' }]} />
        <Input aria-label="Tag" className="sm:w-40" placeholder="Tag" defaultValue={params.tag ?? ''} onBlur={(e) => update({ tag: e.target.value || undefined })} />
        <Button className="sm:ml-auto" variant="secondary" leftIcon={Upload} onClick={() => setImporting(true)}>Import</Button>
      </div>
      {q.data && <p className="px-4 pt-3 text-sm text-muted">{q.data.meta.total.toLocaleString('en-IN')} contact{q.data.meta.total === 1 ? '' : 's'}</p>}
      <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta} onPageChange={(page) => update({ page }, { resetPage: false })} onPageSizeChange={(pageSize) => update({ pageSize })} onRowClick={(r) => setSelected(r.id)}
        empty={<EmptyState icon={Users} title="No contacts yet" description="Students, webinar registrants and lead-form sign-ups appear here." />}
        columns={[
          { key: 'email', header: 'Contact', cell: (r) => <div className="flex items-center gap-2.5"><Avatar name={r.name || r.email} size="sm" /><div className="min-w-0"><p className="truncate font-medium text-fg">{r.name || r.email}</p>{r.name && <p className="truncate text-xs text-muted">{r.email}</p>}</div></div> },
          { key: 'source', header: 'Source' },
          { key: 'tags', header: 'Tags', cell: (r) => <span className="flex flex-wrap gap-1">{(r.tags ?? []).slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}</span> },
          { key: 'canEmail', header: 'Marketing', cell: (r) => (r.canEmail ? <Badge tone="success">Can email</Badge> : r.unsubscribedAt ? <Badge>Unsubscribed</Badge> : <Badge>No consent</Badge>) },
          { key: 'createdAt', header: 'Added', cell: (r) => formatDate(r.createdAt) },
        ]} />
      <ContactDrawer id={selected} onClose={() => setSelected(null)} />
      <ImportModal open={importing} onClose={() => setImporting(false)} />
    </Card>
  );
}

// ── Campaigns ───────────────────────────────────────────────
function SegmentPicker({ value, onChange, courses }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Select label="Send to" value={value.type} onChange={(e) => onChange({ type: e.target.value })} options={[{ value: 'all', label: 'All contacts who agreed' }, { value: 'tag', label: 'Contacts with a tag' }, { value: 'course', label: 'Students of a course' }]} />
      {value.type === 'tag' && <Input label="Tag" value={value.tag ?? ''} onChange={(e) => onChange({ ...value, tag: e.target.value })} />}
      {value.type === 'course' && <Select label="Course" placeholder="Choose" value={value.courseId ?? ''} onChange={(e) => onChange({ ...value, courseId: e.target.value })} options={courses.map((c) => ({ value: c.id, label: c.title }))} />}
    </div>
  );
}

function CampaignEditor({ id, onClose }) {
  const qc = useQueryClient();
  const courses = useQuery({ queryKey: ['creator', 'courses', 'all'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const existing = useQuery({ queryKey: ['marketing', 'campaign', id], queryFn: () => marketingApi.campaign(id), enabled: Boolean(id && id !== 'new') });
  const [draft, setDraft] = useState(null);
  const c = existing.data;
  const v = draft ?? (c ? { name: c.name, subject: c.subject, previewText: c.previewText ?? '', content: c.content, segment: c.segment } : { name: '', subject: '', previewText: '', content: emptyDoc, segment: { type: 'all' } });
  const set = (patch) => setDraft({ ...v, ...patch });
  const readOnly = c && c.status !== 'DRAFT';
  const refresh = () => qc.invalidateQueries({ queryKey: ['marketing'] });
  const save = useMutation({
    mutationFn: () => (id === 'new' ? marketingApi.createCampaign(v) : marketingApi.updateCampaign(id, v)),
    onSuccess: (r) => { refresh(); setDraft(null); qc.setQueryData(['marketing', 'campaign', r.id], r); toast.success('Saved'); if (id === 'new') onClose(r.id); },
    onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });
  const test = useMutation({ mutationFn: () => marketingApi.testCampaign(id), onSuccess: (r) => toast.success(`Test sent to ${r.to}`), onError: (e) => toast.error(e.message) });
  const send = useMutation({ mutationFn: () => marketingApi.scheduleCampaign(id), onSuccess: () => { refresh(); toast.success('Sending now'); onClose(); }, onError: (e) => toast.error(e.details?.[0]?.message ?? e.message) });
  const cancel = useMutation({ mutationFn: () => marketingApi.cancelCampaign(id), onSuccess: () => { refresh(); toast.success('Back to draft'); } });
  if (id !== 'new' && !c) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      {readOnly && <Alert tone="info">{c.status === 'SENT' ? `Sent ${formatDate(c.sentAt, { withTime: true })} to ${c.stats?.queued ?? 0} contacts.` : 'Scheduled — cancel to edit.'}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Internal name" value={v.name} disabled={readOnly} onChange={(e) => set({ name: e.target.value })} />
        <Input label="Subject" value={v.subject} disabled={readOnly} onChange={(e) => set({ subject: e.target.value })} />
      </div>
      <Input label="Preview text (optional)" value={v.previewText} disabled={readOnly} onChange={(e) => set({ previewText: e.target.value })} />
      {readOnly ? null : <RichTextEditor label="Email" value={v.content} onChange={(content) => set({ content })} />}
      <SegmentPicker value={v.segment} onChange={(segment) => !readOnly && set({ segment })} courses={courses.data?.items ?? []} />
      {c && <p className="text-sm text-muted">Reaches <strong className="text-fg">{c.audience.recipients}</strong> contacts who agreed to marketing email{c.audience.excludedWithoutConsent ? ` · ${c.audience.excludedWithoutConsent} without consent are left out` : ''}.</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        {c?.status === 'SCHEDULED' && <Button variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel schedule</Button>}
        {!readOnly && <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>{id === 'new' ? 'Create draft' : 'Save draft'}</Button>}
        {c && !readOnly && <Button variant="secondary" leftIcon={Mail} loading={test.isPending} disabled={Boolean(draft)} onClick={() => test.mutate()}>Send me a test</Button>}
        {c && !readOnly && <Button leftIcon={Send} loading={send.isPending} disabled={Boolean(draft)} onClick={() => send.mutate()}>Send now</Button>}
      </div>
    </div>
  );
}

function Campaigns() {
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState();
  const [periodF, setPeriodF] = useState();
  const q = useQuery({ queryKey: ['marketing', 'campaigns'], queryFn: marketingApi.campaigns });
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const rows = all.filter((r) => (!term || `${r.name} ${r.subject ?? ''}`.toLowerCase().includes(term)) && (!statusF || r.status === statusF) && inPeriod(r.createdAt, periodF));
  const when = (d) => (d ? <div className="leading-tight"><p className="text-fg-2">{formatDate(d)}</p><p className="text-xs text-muted">{new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p></div> : <span className="text-muted">—</span>);
  return (
    <>
      <Card>
        <ListToolbar search={search} onSearch={setSearch} placeholder="Search campaigns" count={rows.length} noun="campaign"
          actions={<Button leftIcon={Plus} onClick={() => setEditing('new')}>New campaign</Button>}
          filtered={Boolean(term || statusF || periodF)} onReset={() => { setSearch(''); setStatusF(undefined); setPeriodF(undefined); }}
          filters={<>
            <FilterChip label="Status" value={statusF} onChange={setStatusF} options={[{ value: 'DRAFT', label: 'Draft' }, { value: 'SCHEDULED', label: 'Scheduled' }, { value: 'SENDING', label: 'Sending' }, { value: 'SENT', label: 'Sent' }]} />
            <FilterChip label="Created on" value={periodF} onChange={setPeriodF} options={PERIOD_OPTIONS} />
          </>} />
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={rows} onRowClick={(r) => setEditing(r.id)}
          empty={all.length ? <EmptyState icon={Mail} title="No campaigns match" description="Try a different search or clear the filters." /> : <EmptyState icon={Mail} title="No campaigns yet" description="Email your contacts about new courses and offers." />}
          columns={[
            { key: 'name', header: 'Campaign name', cell: (r) => <div><p className="font-medium text-fg">{r.name}</p><p className="text-xs text-muted">{r.subject}</p></div> },
            { key: 'updatedAt', header: 'Modified on', cell: (r) => when(r.updatedAt ?? r.createdAt) },
            { key: 'sentAt', header: 'Sent', cell: (r) => when(r.sentAt) },
            { key: 'delivered', header: 'Delivered', align: 'right', cell: (r) => (r.stats?.queued != null ? r.stats.queued.toLocaleString('en-IN') : '—') },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status === 'SENT' ? 'COMPLETED' : r.status} label={r.status.charAt(0) + r.status.slice(1).toLowerCase()} /> },
          ]} />
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New campaign' : 'Campaign'} size="xl">
        {editing && <CampaignEditor key={editing} id={editing} onClose={(newId) => setEditing(newId ?? null)} />}
      </Modal>
    </>
  );
}

// ── Automations ─────────────────────────────────────────────
function StepEditor({ step, onChange, courses, batches }) {
  switch (step.type) {
    case 'wait': return <Input label="Minutes" type="number" min={1} value={step.minutes} onChange={(e) => onChange({ ...step, minutes: Number(e.target.value) })} />;
    case 'notify': return <div className="grid gap-2 sm:grid-cols-2"><Input label="Title" value={step.title} onChange={(e) => onChange({ ...step, title: e.target.value })} /><Input label="Message" value={step.body} onChange={(e) => onChange({ ...step, body: e.target.value })} /></div>;
    case 'tag': return <Input label="Tag" value={step.tag} onChange={(e) => onChange({ ...step, tag: e.target.value })} />;
    case 'enroll': return <Select label="Course" placeholder="Choose" value={step.courseId} onChange={(e) => onChange({ ...step, courseId: e.target.value })} options={courses.map((c) => ({ value: c.id, label: c.title }))} />;
    case 'batch': return <Select label="Batch" placeholder="Choose" value={step.batchId} onChange={(e) => onChange({ ...step, batchId: e.target.value })} options={batches.map((b) => ({ value: b.id, label: b.name }))} />;
    case 'email': return <div className="space-y-2"><Input label="Subject" value={step.subject} onChange={(e) => onChange({ ...step, subject: e.target.value })} /><RichTextEditor label="Email" value={step.content} onChange={(content) => onChange({ ...step, content })} minHeight={100} /></div>;
    default: return null;
  }
}

const BLANK = { wait: { type: 'wait', minutes: 60 }, notify: { type: 'notify', title: '', body: '' }, tag: { type: 'tag', tag: '' }, enroll: { type: 'enroll', courseId: '' }, batch: { type: 'batch', batchId: '' }, email: { type: 'email', subject: '', content: emptyDoc } };

function AutomationEditor({ automation, onDone }) {
  const courses = useQuery({ queryKey: ['creator', 'courses', 'all'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const batches = useQuery({ queryKey: ['creator', 'batches'], queryFn: batchesApi.list });
  const [name, setName] = useState(automation?.name ?? '');
  const [trigger, setTrigger] = useState(automation?.trigger ?? 'course.enrolled');
  const [courseId, setCourseId] = useState(automation?.filter?.courseId ?? '');
  const [steps, setSteps] = useState(automation?.steps ?? [BLANK.notify]);
  const save = useMutation({
    mutationFn: () => { const body = { name, trigger, filter: courseId ? { courseId } : null, steps }; return automation ? marketingApi.updateAutomation(automation.id, body) : marketingApi.createAutomation(body); },
    onSuccess: () => { toast.success('Automation saved'); onDone(true); },
    onError: (e) => toast.error(e.details?.[0] ? `${e.details[0].field}: ${e.details[0].message}` : e.message),
  });
  const move = (i, dir) => { const next = [...steps]; [next[i], next[i + dir]] = [next[i + dir], next[i]]; setSteps(next); };
  const courseTriggers = ['course.enrolled', 'course.completed', 'order.paid'];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2"><Input label="Name" value={name} onChange={(e) => setName(e.target.value)} /><Select label="When" value={trigger} onChange={(e) => setTrigger(e.target.value)} options={TRIGGERS.map(([v, l]) => ({ value: v, label: l }))} /></div>
      {courseTriggers.includes(trigger) && <Select label="Only for course (optional)" placeholder="Any course" value={courseId} onChange={(e) => setCourseId(e.target.value)} options={(courses.data?.items ?? []).map((c) => ({ value: c.id, label: c.title }))} />}
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="rounded-lg border border-line p-3">
            <div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium">{i + 1}. {STEP_LABELS[s.type]}</p>
              <span className="flex gap-1">
                <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Remove step" onClick={() => setSteps(steps.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
              </span>
            </div>
            <StepEditor step={s} onChange={(n) => setSteps(steps.map((x, j) => (j === i ? n : x)))} courses={courses.data?.items ?? []} batches={batches.data ?? []} />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">{Object.entries(STEP_LABELS).filter(([k]) => trigger !== 'lead.created' || !['enroll', 'batch', 'notify'].includes(k)).map(([k, l]) => <Button key={k} size="sm" variant="secondary" leftIcon={Plus} onClick={() => setSteps([...steps, BLANK[k]])}>{l}</Button>)}</div>
      <p className="text-xs text-muted">Emails to contacts without an account are only sent with their marketing consent. Each person goes through an automation once per trigger.</p>
      <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="secondary" onClick={() => onDone(false)}>Cancel</Button><Button loading={save.isPending} disabled={!name.trim() || !steps.length} onClick={() => save.mutate()}>Save</Button></div>
    </div>
  );
}

function Automations() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const q = useQuery({ queryKey: ['marketing', 'automations'], queryFn: marketingApi.automations });
  const toggle = useMutation({ mutationFn: (a) => marketingApi.updateAutomation(a.id, { status: a.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['marketing', 'automations'] }) });
  return (
    <>
      <div className="mb-3 flex justify-end"><Button leftIcon={Plus} onClick={() => setEditing('new')}>New automation</Button></div>
      <Card>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data ?? []} onRowClick={(r) => setEditing(r)}
          empty={<EmptyState icon={Workflow} title="No automations yet" description="Welcome new students, nudge them later, tag buyers — automatically." />}
          columns={[
            { key: 'name', header: 'Automation', cell: (r) => <div><p className="font-medium text-fg">{r.name}</p><p className="text-xs text-muted">{TRIGGERS.find((t) => t[0] === r.trigger)?.[1]} · {r.steps.length} step{r.steps.length === 1 ? '' : 's'}</p></div> },
            { key: 'runCount', header: 'Runs', align: 'right' },
            { key: 'status', header: 'Status', cell: (r) => <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); toggle.mutate(r); }}>{r.status === 'ACTIVE' ? 'Pause' : 'Resume'}</Button> },
          ]} />
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New automation' : 'Edit automation'} size="xl">
        {editing && <AutomationEditor automation={editing === 'new' ? null : editing} onDone={(ok) => { setEditing(null); if (ok) qc.invalidateQueries({ queryKey: ['marketing', 'automations'] }); }} />}
      </Modal>
    </>
  );
}

export function MarketingPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'contacts';
  return (
    <>
      <PageHeader title="Marketing" description="Contacts, email campaigns and automations — always with consent." breadcrumbs={[{ label: 'Marketing' }]} />
      <Tabs className="mb-4" value={tab} onChange={(t) => setSp({ tab: t })} tabs={[{ value: 'contacts', label: 'Contacts' }, { value: 'campaigns', label: 'Campaigns' }, { value: 'automations', label: 'Automations' }]} />
      {tab === 'contacts' && <Contacts />}
      {tab === 'campaigns' && <Campaigns />}
      {tab === 'automations' && <Automations />}
    </>
  );
}
