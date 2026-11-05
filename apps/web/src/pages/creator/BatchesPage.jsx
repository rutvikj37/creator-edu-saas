import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Boxes, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Card, ConfirmDialog, DataTable, Drawer, EmptyState, Input, Modal, Select, Skeleton, Textarea, toast } from '../../components/ui/index.js';
import { batchesApi } from '../../services/api/live.js';
import { coursesApi } from '../../services/api/creator.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { applyApiErrors } from '../../utils/forms.js';
import { formatDate } from '../../utils/format.js';

const schema = z.object({ name: z.string().trim().min(1, 'Name the batch').max(120), description: z.string().max(500).optional(), courseId: z.string().optional(), startsAt: z.string().optional(), endsAt: z.string().optional(), capacity: z.union([z.literal(''), z.coerce.number().int().min(1)]) });

function BatchForm({ onDone }) {
  const courses = useQuery({ queryKey: ['creator', 'courses', 'all'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: '', description: '', courseId: '', startsAt: '', endsAt: '', capacity: '' } });
  const submit = form.handleSubmit(async (v) => {
    try {
      await batchesApi.create({ name: v.name, description: v.description || null, courseId: v.courseId || null, startsAt: v.startsAt ? new Date(v.startsAt).toISOString() : null, endsAt: v.endsAt ? new Date(v.endsAt).toISOString() : null, capacity: v.capacity === '' ? null : v.capacity });
      toast.success('Batch created');
      onDone(true);
    } catch (e) {
      applyApiErrors(e, form.setError, ['name', 'courseId', 'endsAt']);
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Input label="Name" placeholder="November 2026 cohort" {...form.register('name')} error={form.formState.errors.name?.message} />
      <Textarea label="Description" rows={2} {...form.register('description')} />
      <Select label="Course (optional)" placeholder="No course" hint="Members are enrolled in this course." {...form.register('courseId')} options={(courses.data?.items ?? []).map((c) => ({ value: c.id, label: c.title }))} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Starts" type="date" {...form.register('startsAt')} />
        <Input label="Ends" type="date" {...form.register('endsAt')} error={form.formState.errors.endsAt?.message} />
        <Input label="Capacity" type="number" min={1} placeholder="No limit" {...form.register('capacity')} />
      </div>
      <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="secondary" onClick={() => onDone(false)}>Cancel</Button><Button type="submit" loading={form.formState.isSubmitting}>Create batch</Button></div>
    </form>
  );
}

function BatchDrawer({ id, onClose, canManage }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['creator', 'batch', id], queryFn: () => batchesApi.get(id), enabled: Boolean(id) });
  const [emails, setEmails] = useState('');
  const [notFound, setNotFound] = useState([]);
  const [archive, setArchive] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['creator', 'batches'] });
  const add = useMutation({
    mutationFn: () => batchesApi.addMembers(id, emails.split(/[\s,;]+/).filter(Boolean)),
    onSuccess: (r) => { qc.setQueryData(['creator', 'batch', id], r.batch); setNotFound(r.notFound); setEmails(''); refresh(); toast.success(`${r.added} added`); },
    onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });
  const remove = useMutation({ mutationFn: (mid) => batchesApi.removeMember(id, mid), onSuccess: (b) => { qc.setQueryData(['creator', 'batch', id], b); refresh(); } });
  const doArchive = useMutation({ mutationFn: () => batchesApi.archive(id), onSuccess: () => { setArchive(false); refresh(); onClose(); toast.success('Batch archived'); } });
  const b = q.data;
  return (
    <Drawer open={Boolean(id)} onClose={onClose} title={b?.name ?? 'Batch'}>
      {!b ? <Skeleton className="h-40" /> : (
        <div className="space-y-5 text-sm">
          {b.description && <p className="text-fg-2">{b.description}</p>}
          {canManage && (
            <div className="space-y-2">
              <Textarea label="Add students by email" rows={3} placeholder="one@example.com, two@example.com" value={emails} onChange={(e) => setEmails(e.target.value)} hint="They must already have an account at your academy." />
              <Button size="sm" leftIcon={Plus} disabled={!emails.trim()} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
              {notFound.length > 0 && <Alert tone="warning">No student account for: {notFound.join(', ')}</Alert>}
            </div>
          )}
          <div>
            <p className="mb-2 font-semibold">{b.members.length} member{b.members.length === 1 ? '' : 's'}{b.capacity ? ` / ${b.capacity}` : ''}</p>
            <ul className="divide-y divide-line">{b.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <div><p className="font-medium">{m.user?.fullName}</p><p className="text-xs text-muted">{m.user?.email}</p></div>
                {canManage && <Button size="icon-sm" variant="ghost" aria-label={`Remove ${m.user?.fullName}`} onClick={() => remove.mutate(m.id)}><Trash2 className="size-4" /></Button>}
              </li>
            ))}</ul>
          </div>
          {canManage && <Button variant="ghost" className="text-red-600" onClick={() => setArchive(true)}>Archive batch</Button>}
          <ConfirmDialog open={archive} onClose={() => setArchive(false)} title="Archive this batch?" description="Members keep their course access." confirmLabel="Archive" loading={doArchive.isPending} onConfirm={() => doArchive.mutate()} />
        </div>
      )}
    </Drawer>
  );
}

export function BatchesPage() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const q = useQuery({ queryKey: ['creator', 'batches'], queryFn: batchesApi.list });
  const canManage = auth.can('students.manage');
  return (
    <>
      <PageHeader title="Batches" description="Group students into cohorts for live classes and shared timelines." breadcrumbs={[{ label: 'Students' }, { label: 'Batches' }]}
        actions={canManage && <Button leftIcon={Plus} onClick={() => setOpen(true)}>New batch</Button>} />
      <Card>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data ?? []} onRowClick={(r) => setSelected(r.id)}
          empty={<EmptyState icon={Boxes} title="No batches yet" description="Create a batch, add students, then schedule live classes for it." />}
          columns={[
            { key: 'name', header: 'Batch', cell: (r) => <span className="font-medium text-fg">{r.name}</span> },
            { key: 'memberCount', header: 'Members', align: 'right', cell: (r) => `${r.memberCount}${r.capacity ? ` / ${r.capacity}` : ''}` },
            { key: 'startsAt', header: 'Dates', cell: (r) => (r.startsAt ? `${formatDate(r.startsAt)}${r.endsAt ? ` – ${formatDate(r.endsAt)}` : ''}` : '—') },
          ]} />
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="New batch">{open && <BatchForm onDone={(ok) => { setOpen(false); if (ok) qc.invalidateQueries({ queryKey: ['creator', 'batches'] }); }} />}</Modal>
      <BatchDrawer id={selected} onClose={() => setSelected(null)} canManage={canManage} />
    </>
  );
}
