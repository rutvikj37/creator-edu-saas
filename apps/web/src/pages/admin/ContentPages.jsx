import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, Input, Modal, Select, Textarea, toast } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { formatDate } from '../../utils/format.js';

export function CategoriesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'categories'], queryFn: platformApi.categories });
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [form, setForm] = useState({ name: '', parentId: '' });
  const [error, setError] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform', 'categories'] });
  const save = useMutation({
    mutationFn: () => { const body = { name: form.name, parentId: form.parentId || null }; return editing === 'new' ? platformApi.createCategory(body) : platformApi.updateCategory(editing.id, body); },
    onSuccess: () => { toast.success('Category saved'); setEditing(null); refresh(); },
    onError: (e) => setError(e.details?.[0]?.message ?? e.message),
  });
  const remove = useMutation({ mutationFn: (id) => platformApi.deleteCategory(id), onSuccess: () => { toast.success('Category deleted'); setToDelete(null); refresh(); }, onError: (e) => toast.error(e.message) });
  const byId = new Map((q.data ?? []).map((c) => [c.id, c]));
  const open = (c) => { setError(null); setEditing(c); setForm(c === 'new' ? { name: '', parentId: '' } : { name: c.name, parentId: c.parentId ?? '' }); };

  return (
    <>
      <PageHeader title="Course categories" description="Shared categories creators can assign to courses." breadcrumbs={[{ label: 'Content' }, { label: 'Categories' }]}
        actions={<Button leftIcon={Plus} onClick={() => open('new')}>Add category</Button>} />
      <Card>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data ?? []}
          empty={<EmptyState icon={Tags} title="No categories yet" action={<Button size="sm" onClick={() => open('new')}>Add category</Button>} />}
          columns={[
            { key: 'name', header: 'Name', cell: (r) => <span className="font-medium text-fg">{r.name}</span> },
            { key: 'slug', header: 'Slug' },
            { key: 'parent', header: 'Parent', cell: (r) => byId.get(r.parentId)?.name ?? '—' },
            { key: 'a', header: '', align: 'right', cell: (r) => (
              <span className="inline-flex gap-1">
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${r.name}`} onClick={() => open(r)}><Pencil className="size-4" /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.name}`} onClick={() => setToDelete(r)}><Trash2 className="size-4" /></Button>
              </span>
            ) },
          ]} />
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add category' : 'Edit category'}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={form.name.trim().length < 2} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
        <div className="space-y-4">
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={error} autoFocus />
          <Select label="Parent (optional)" placeholder="None" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}
            options={(q.data ?? []).filter((c) => editing === 'new' || c.id !== editing?.id).map((c) => ({ value: c.id, label: c.name }))} />
        </div>
      </Modal>
      <ConfirmDialog open={Boolean(toDelete)} onClose={() => setToDelete(null)} title={`Delete ${toDelete?.name}?`} description="Sub-categories become top-level." confirmLabel="Delete" loading={remove.isPending} onConfirm={() => remove.mutate(toDelete.id)} />
    </>
  );
}

const toLocalInput = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

export function AnnouncementsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'announcements'], queryFn: platformApi.announcements });
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform', 'announcements'] });
  const open = (a) => {
    setErrors({});
    setEditing(a);
    setForm(a === 'new' ? { audience: 'CREATORS', title: '', body: '', tone: 'info', startsAt: toLocalInput(new Date().toISOString()), endsAt: '' } : { ...a, startsAt: toLocalInput(a.startsAt), endsAt: toLocalInput(a.endsAt) });
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { audience: form.audience, title: form.title, body: form.body, tone: form.tone, startsAt: new Date(form.startsAt).toISOString(), endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null };
      return editing === 'new' ? platformApi.createAnnouncement(body) : platformApi.updateAnnouncement(editing.id, body);
    },
    onSuccess: () => { toast.success('Announcement saved'); setEditing(null); refresh(); },
    onError: (e) => { setErrors(Object.fromEntries((e.details ?? []).map((d) => [d.field, d.message]))); if (!e.details?.length) toast.error(e.message); },
  });
  const remove = useMutation({ mutationFn: (id) => platformApi.deleteAnnouncement(id), onSuccess: () => { toast.success('Deleted'); setToDelete(null); refresh(); }, onError: (e) => toast.error(e.message) });
  const now = Date.now();
  return (
    <>
      <PageHeader title="Announcements" description="Banners shown to creators and/or students." breadcrumbs={[{ label: 'Content' }, { label: 'Announcements' }]}
        actions={<Button leftIcon={Plus} onClick={() => open('new')}>New announcement</Button>} />
      <Card>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data ?? []}
          empty={<EmptyState icon={Megaphone} title="No announcements" />}
          columns={[
            { key: 'title', header: 'Title', cell: (r) => <span className="font-medium text-fg">{r.title}</span> },
            { key: 'audience', header: 'Audience', cell: (r) => <Badge>{r.audience.toLowerCase()}</Badge> },
            { key: 'window', header: 'Visible', cell: (r) => `${formatDate(r.startsAt, { withTime: true })} → ${r.endsAt ? formatDate(r.endsAt, { withTime: true }) : 'no end'}` },
            { key: 'state', header: 'State', cell: (r) => { const live = new Date(r.startsAt) <= now && (!r.endsAt || new Date(r.endsAt) > now); return <Badge tone={live ? 'success' : 'neutral'}>{live ? 'Live' : new Date(r.startsAt) > now ? 'Scheduled' : 'Ended'}</Badge>; } },
            { key: 'a', header: '', align: 'right', cell: (r) => (
              <span className="inline-flex gap-1">
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${r.title}`} onClick={() => open(r)}><Pencil className="size-4" /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.title}`} onClick={() => setToDelete(r)}><Trash2 className="size-4" /></Button>
              </span>
            ) },
          ]} />
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New announcement' : 'Edit announcement'} size="lg"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={save.isPending} disabled={!form.title || !form.body} onClick={() => save.mutate()}>Save</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Input label="Title" value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} error={errors.title} /></div>
          <div className="sm:col-span-2"><Textarea label="Message" rows={4} value={form.body ?? ''} onChange={(e) => setForm({ ...form, body: e.target.value })} error={errors.body} /></div>
          <Select label="Audience" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} options={[{ value: 'CREATORS', label: 'Creators' }, { value: 'STUDENTS', label: 'Students' }, { value: 'ALL', label: 'Everyone' }]} />
          <Select label="Style" value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} options={[{ value: 'info', label: 'Information' }, { value: 'warning', label: 'Warning' }, { value: 'success', label: 'Success' }]} />
          <Input label="Starts" type="datetime-local" value={form.startsAt ?? ''} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} error={errors.startsAt} />
          <Input label="Ends (optional)" type="datetime-local" value={form.endsAt ?? ''} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} error={errors.endsAt} />
        </div>
      </Modal>
      <ConfirmDialog open={Boolean(toDelete)} onClose={() => setToDelete(null)} title="Delete announcement?" confirmLabel="Delete" loading={remove.isPending} onConfirm={() => remove.mutate(toDelete.id)} />
    </>
  );
}
