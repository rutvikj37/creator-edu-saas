import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowDown, ArrowUp, Layers, Plus, X } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { ListToolbar, MetricCard } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { PERIOD_OPTIONS, inPeriod } from '../../utils/period.js';
import { Badge, Button, Card, Checkbox, DataTable, EmptyState, Input, Modal, StatusBadge, Textarea, toast } from '../../components/ui/index.js';
import { FileUpload } from '../../components/forms/FileUpload.jsx';
import { bundlesApi } from '../../services/api/commerce.js';
import { coursesApi } from '../../services/api/creator.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { applyApiErrors } from '../../utils/forms.js';
import { formatMoney } from '../../utils/format.js';

const schema = z.object({
  title: z.string().trim().min(1, 'Give the bundle a name').max(200),
  description: z.string().max(2000).optional(),
  priceAmount: z.coerce.number({ message: 'Enter a price' }).positive('Enter a price'),
  courseIds: z.array(z.string()).min(2, 'Choose at least 2 courses').max(30, 'Up to 30 courses'),
});

function BundleForm({ bundle, onDone }) {
  const courses = useQuery({ queryKey: ['creator', 'courses', 'all'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const [cover, setCover] = useState(bundle?.coverFileId ? { id: bundle.coverFileId, url: bundle.coverUrl } : null);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { title: bundle?.title ?? '', description: bundle?.description ?? '', priceAmount: bundle ? Number(bundle.priceAmount) : '', courseIds: bundle?.courses.map((c) => c.id) ?? [] } });
  const { register, watch, setValue, formState: { errors, isSubmitting } } = form;
  const ids = watch('courseIds');
  const all = courses.data?.items ?? [];
  const byId = new Map(all.map((c) => [c.id, c]));
  const worth = ids.reduce((s, id) => s + (byId.get(id)?.isFree ? 0 : Number(byId.get(id)?.priceAmount ?? 0)), 0);
  const currency = byId.get(ids[0])?.currency ?? 'INR';
  const price = Number(watch('priceAmount')) || 0;
  const toggle = (id) => setValue('courseIds', ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id], { shouldValidate: true });
  const move = (i, d) => { const next = [...ids]; [next[i], next[i + d]] = [next[i + d], next[i]]; setValue('courseIds', next); };
  const submit = form.handleSubmit(async (v) => {
    const body = { ...v, description: v.description || null, coverFileId: cover?.id ?? null };
    try {
      if (bundle) await bundlesApi.update(bundle.id, body);
      else await bundlesApi.create(body);
      toast.success(bundle ? 'Bundle saved' : 'Bundle created — publish it when you are ready');
      onDone();
    } catch (e) {
      applyApiErrors(e, form.setError, ['title', 'description', 'priceAmount', 'courseIds']);
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Input label="Name" {...register('title')} error={errors.title?.message} required />
      <Textarea label="Description" rows={3} {...register('description')} />
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Courses</legend>
        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-line p-3">
          {all.length === 0 ? <p className="text-sm text-muted">Create courses first.</p> : all.map((c) => (
            <Checkbox key={c.id} label={`${c.title}${c.status !== 'PUBLISHED' ? ' (not published)' : ''}`} description={c.isFree ? 'Free' : formatMoney(c.priceAmount, c.currency)} checked={ids.includes(c.id)} onChange={() => toggle(c.id)} />
          ))}
        </div>
        {errors.courseIds && <p className="mt-1 text-xs text-red-600">{errors.courseIds.message}</p>}
      </fieldset>
      {ids.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium">Order on the bundle page</p>
          <ol className="space-y-1 text-sm">
            {ids.map((id, i) => (
              <li key={id} className="flex items-center gap-2 rounded-md border border-line px-2 py-1">
                <span className="w-5 text-muted">{i + 1}.</span><span className="min-w-0 flex-1 truncate">{byId.get(id)?.title ?? bundle?.courses.find((c) => c.id === id)?.title}</span>
                <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === ids.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => toggle(id)}><X className="size-4" /></Button>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={`Bundle price (${currency})`} type="number" min={1} step="0.01" {...register('priceAmount')} error={errors.priceAmount?.message} required
          hint={worth > 0 ? (price > 0 && price < worth ? `Courses separately: ${formatMoney(worth, currency)} — students save ${formatMoney(worth - price, currency)}` : `Courses separately: ${formatMoney(worth, currency)}`) : undefined} />
      </div>
      <FileUpload purpose="IMAGE" accept="image/png,image/jpeg,image/webp" label="Cover image (optional)" value={cover} onUploaded={(f) => setCover({ id: f.id, url: f.url })} onClear={() => setCover(null)} />
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{bundle ? 'Save' : 'Create bundle'}</Button>
      </div>
    </form>
  );
}

export function BundlesPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [editing, setEditing] = useState(null);
  const q = useQuery({ queryKey: ['creator', 'bundles'], queryFn: bundlesApi.list });
  const done = () => { setEditing(null); qc.invalidateQueries({ queryKey: ['creator', 'bundles'] }); };
  const status = useMutation({
    mutationFn: ({ id, status: s }) => bundlesApi.setStatus(id, s),
    onSuccess: (b) => { toast.success({ PUBLISHED: 'Bundle published', DRAFT: 'Bundle unpublished', ARCHIVED: 'Bundle archived' }[b.status]); qc.invalidateQueries({ queryKey: ['creator', 'bundles'] }); },
    onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });
  const manage = can('courses.manage');
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState();
  const [periodF, setPeriodF] = useState();
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const rows = all.filter((r) => (!term || r.title.toLowerCase().includes(term)) && (!statusF || r.status === statusF) && inPeriod(r.createdAt, periodF));
  return (
    <>
      <PageHeader title="Bundles" count={q.data ? all.length : undefined} description="Sell several courses together at one price." breadcrumbs={[{ label: 'Bundles' }]}
        actions={manage && <Button leftIcon={Plus} onClick={() => setEditing('new')}>Create</Button>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <MetricCard label="Total sold" value={all.reduce((n, r) => n + (r.sold ?? 0), 0).toLocaleString('en-IN')} loading={q.isLoading} />
        <MetricCard label="Published bundles" value={all.filter((r) => r.status === 'PUBLISHED').length} hint={`${all.length} in total`} loading={q.isLoading} />
      </div>
      <Card>
        <div className="border-b border-line px-4 pt-4"><h2 className="font-semibold">All bundles</h2></div>
        <ListToolbar search={search} onSearch={setSearch} placeholder="Search by bundle name" count={rows.length} noun="bundle"
          filtered={Boolean(term || statusF || periodF)} onReset={() => { setSearch(''); setStatusF(undefined); setPeriodF(undefined); }}
          filters={<>
            <FilterChip label="Status" value={statusF} onChange={setStatusF} options={[{ value: 'PUBLISHED', label: 'Published' }, { value: 'DRAFT', label: 'Draft' }]} />
            <FilterChip label="Date created" value={periodF} onChange={setPeriodF} options={PERIOD_OPTIONS} />
          </>} />
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={rows} onRowClick={manage ? (r) => setEditing(r) : undefined}
          empty={all.length ? <EmptyState icon={Layers} title="No bundles match" description="Try a different search or clear the filters." /> : <EmptyState icon={Layers} title="No bundles yet" description="Group courses into a bundle with a saving, e.g. a learning path." action={manage && <Button size="sm" leftIcon={Plus} onClick={() => setEditing('new')}>Create a bundle</Button>} />}
          columns={[
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'title', header: 'Bundle', cell: (r) => <div><p className="font-medium text-fg">{r.title}</p><p className="text-xs text-muted">{r.courses.length} courses{r.courses.some((c) => c.status !== 'PUBLISHED') ? ' · some not published' : ''}</p></div> },
            { key: 'price', header: 'Price', cell: (r) => <span className="tabular-nums">{formatMoney(r.priceAmount, r.currency)}{Number(r.worthAmount) > Number(r.priceAmount) && <span className="ml-1 text-xs text-muted line-through">{formatMoney(r.worthAmount, r.currency)}</span>}</span> },
            { key: 'sold', header: 'Sold', align: 'right', cell: (r) => r.sold },
            {
              key: 'actions', header: '', cell: (r) => manage && (
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  {r.status !== 'PUBLISHED'
                    ? <Button size="sm" variant="secondary" loading={status.isPending && status.variables?.id === r.id} onClick={() => status.mutate({ id: r.id, status: 'PUBLISHED' })}>Publish</Button>
                    : <Button size="sm" variant="ghost" onClick={() => status.mutate({ id: r.id, status: 'DRAFT' })}>Unpublish</Button>}
                  <Button size="sm" variant="ghost" aria-label={`Archive ${r.title}`} onClick={() => status.mutate({ id: r.id, status: 'ARCHIVED' })}>Archive</Button>
                </div>
              ),
            },
          ]} />
      </Card>
      {q.data?.some((b) => b.status === 'PUBLISHED') && <p className="mt-3 text-sm text-muted">Published bundles appear on your academy's course page and at <Badge>/bundles/&lt;name&gt;</Badge>.</p>}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New bundle' : 'Edit bundle'} size="lg">
        {editing && <BundleForm bundle={editing === 'new' ? null : editing} onDone={done} />}
      </Modal>
    </>
  );
}
