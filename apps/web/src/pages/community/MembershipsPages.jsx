import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Crown, Pencil, Plus, Users } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { ListToolbar, MetricCard } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { PERIOD_OPTIONS, inPeriod } from '../../utils/period.js';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, CardBody, Checkbox, DataTable, Drawer, EmptyState, ErrorState, Input, Modal, Select, Skeleton, StatusBadge, Textarea, toast } from '../../components/ui/index.js';
import { membershipsApi } from '../../services/api/community.js';
import { coursesApi } from '../../services/api/creator.js';
import { academyApi } from '../../services/api/auth.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatMoney } from '../../utils/format.js';
import { AcademyHeader } from '../public/AcademyLandingPage.jsx';

const per = (interval) => (interval === 'YEAR' ? 'year' : 'month');

function PlanForm({ plan, onDone }) {
  const qc = useQueryClient();
  const courses = useQuery({ queryKey: ['creator', 'courses', 'all'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const [v, setV] = useState({ name: plan?.name ?? '', description: plan?.description ?? '', priceAmount: plan?.priceAmount ?? '', interval: plan?.interval ?? 'MONTH', courseIds: plan?.courseIds ?? [] });
  const [errors, setErrors] = useState({});
  const save = useMutation({
    mutationFn: () => {
      const body = { name: v.name, description: v.description || null, priceAmount: Number(v.priceAmount), interval: v.interval, courseIds: v.courseIds };
      return plan ? membershipsApi.update(plan.id, body) : membershipsApi.create(body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['memberships'] }); toast.success(plan ? 'Plan updated' : 'Plan created'); onDone(); },
    onError: (e) => { if (e.details?.length) setErrors(Object.fromEntries(e.details.map((x) => [x.field, x.message]))); else toast.error(e.message); },
  });
  const toggle = (id) => setV({ ...v, courseIds: v.courseIds.includes(id) ? v.courseIds.filter((x) => x !== id) : [...v.courseIds, id] });
  const items = courses.data?.items ?? [];
  return (
    <div className="space-y-4">
      <Input label="Plan name" value={v.name} error={errors.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
      <Textarea label="Description" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Price" type="number" min={1} step="0.01" value={v.priceAmount} error={errors.priceAmount} onChange={(e) => setV({ ...v, priceAmount: e.target.value })} required />
        <Select label="Billed every" value={v.interval} onChange={(e) => setV({ ...v, interval: e.target.value })} options={[{ value: 'MONTH', label: 'Month' }, { value: 'YEAR', label: 'Year' }]} />
      </div>
      {plan && <p className="text-xs text-muted">Price changes apply to future payments; current members keep the period they paid for.</p>}
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Courses included</legend>
        {courses.isLoading ? <Skeleton className="h-20" /> : items.length === 0 ? <Alert tone="info">Create a course first.</Alert> : (
          <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-line p-3">
            {items.map((c) => <Checkbox key={c.id} label={c.title} description={c.status === 'PUBLISHED' ? undefined : 'Not published yet — members get it once you publish'} checked={v.courseIds.includes(c.id)} onChange={() => toggle(c.id)} />)}
          </div>
        )}
        {errors.courseIds && <p role="alert" className="mt-1.5 text-xs text-red-600">{errors.courseIds}</p>}
      </fieldset>
      <p className="text-xs text-muted">Members renew by paying again before the period ends; we email them a reminder 7 days before. There is no automatic card charge.</p>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Cancel</Button><Button disabled={!v.name.trim() || !v.priceAmount || v.courseIds.length === 0} loading={save.isPending} onClick={() => save.mutate()}>{plan ? 'Save' : 'Create plan'}</Button></div>
    </div>
  );
}

function MembersDrawer({ plan, onClose }) {
  const q = useQuery({ queryKey: ['memberships', 'members', plan?.id], queryFn: () => membershipsApi.members(plan.id), enabled: Boolean(plan) });
  return (
    <Drawer open={Boolean(plan)} onClose={onClose} title={plan ? `${plan.name} — members` : ''}>
      <div className="p-5">
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-40" /> : q.data.length === 0 ? <EmptyState icon={Users} title="No members yet" /> : (
          <ul className="divide-y divide-line">
            {q.data.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div><p className="font-medium">{m.user?.fullName ?? 'Deleted user'}</p><p className="text-xs text-muted">{m.user?.email}</p></div>
                <div className="text-right"><StatusBadge status={m.status} /><p className="mt-1 text-xs text-muted">{m.status === 'ACTIVE' ? 'Until' : 'Ended'} {formatDate(m.currentPeriodEnd)}</p></div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

export function CreatorMembershipsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['memberships', 'plans'], queryFn: membershipsApi.plans });
  const [editing, setEditing] = useState(null); // null | 'new' | plan
  const [members, setMembers] = useState(null);
  const setStatus = useMutation({ mutationFn: ({ id, status }) => membershipsApi.update(id, { status }), onSuccess: () => qc.invalidateQueries({ queryKey: ['memberships'] }), onError: (e) => toast.error(e.message) });
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState();
  const [periodF, setPeriodF] = useState();
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const rows = all.filter((r) => (!term || r.name.toLowerCase().includes(term)) && (!statusF || r.status === statusF) && inPeriod(r.createdAt, periodF));
  const mrr = all.filter((r) => r.status === 'ACTIVE').reduce((n, r) => n + Number(r.priceAmount) * (r.activeMembers ?? 0) / (r.interval === 'YEAR' ? 12 : 1), 0);
  return (
    <>
      <PageHeader title="Memberships" count={q.data ? all.length : undefined} description="Sell access to a bundle of courses for a monthly or yearly price." breadcrumbs={[{ label: 'Memberships' }]} actions={<Button leftIcon={Plus} onClick={() => setEditing('new')}>Create</Button>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <MetricCard label="Total members" value={all.reduce((n, r) => n + (r.activeMembers ?? 0), 0).toLocaleString('en-IN')} hint="With an active membership" loading={q.isLoading} />
        <MetricCard label="Monthly revenue" value={formatMoney(mrr, all[0]?.currency ?? 'INR')} hint="Active members × plan price, per month" loading={q.isLoading} />
      </div>
      <Card>
        <div className="border-b border-line px-4 pt-4"><h2 className="font-semibold">All plans</h2></div>
        <ListToolbar search={search} onSearch={setSearch} placeholder="Search by plan name" count={rows.length} noun="plan"
          filtered={Boolean(term || statusF || periodF)} onReset={() => { setSearch(''); setStatusF(undefined); setPeriodF(undefined); }}
          filters={<>
            <FilterChip label="Status" value={statusF} onChange={setStatusF} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }]} />
            <FilterChip label="Created on" value={periodF} onChange={setPeriodF} options={PERIOD_OPTIONS} />
          </>} />
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={rows}
          empty={all.length ? <EmptyState icon={Crown} title="No plans match" description="Try a different search or clear the filters." /> : <EmptyState icon={Crown} title="No membership plans" description="Bundle courses into a plan students pay for every month or year." action={<Button leftIcon={Plus} onClick={() => setEditing('new')}>New plan</Button>} />}
          columns={[
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'name', header: 'Plan', cell: (r) => <div><p className="font-medium text-fg">{r.name}</p><p className="text-xs text-muted">{r.courseIds.length} course{r.courseIds.length === 1 ? '' : 's'}</p></div> },
            { key: 'priceAmount', header: 'Price', cell: (r) => `${formatMoney(r.priceAmount, r.currency)} / ${per(r.interval)}` },
            { key: 'activeMembers', header: 'Active members', align: 'right' },
            {
              key: 'actions', header: '', align: 'right',
              cell: (r) => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" leftIcon={Users} onClick={() => setMembers(r)}>Members</Button>
                  <Button size="sm" variant="ghost" leftIcon={Pencil} aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}>Edit</Button>
                  {r.status === 'ACTIVE'
                    ? <Button size="sm" variant="ghost" leftIcon={Archive} onClick={() => setStatus.mutate({ id: r.id, status: 'ARCHIVED' })}>Archive</Button>
                    : <Button size="sm" variant="secondary" onClick={() => setStatus.mutate({ id: r.id, status: 'ACTIVE' })}>Restore</Button>}
                </div>
              ),
            },
          ]} />
      </Card>
      <p className="mt-3 text-xs text-muted">Archiving stops new sales; existing members keep access until their period ends. Share <span className="font-mono">/memberships</span> on your academy to sell plans.</p>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} size="lg" title={editing === 'new' ? 'New membership plan' : 'Edit plan'}>
        {editing && <PlanForm plan={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
      <MembersDrawer plan={members} onClose={() => setMembers(null)} />
    </>
  );
}

/** Public plan list on the academy host. */
export function PublicMembershipsPage() {
  const auth = useAuth();
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000 });
  const plans = useQuery({ queryKey: ['public', 'memberships'], queryFn: membershipsApi.publicPlans });
  const mine = useQuery({ queryKey: ['learn', 'memberships'], queryFn: membershipsApi.mine, enabled: Boolean(auth.user) });
  const active = (planId) => mine.data?.find((m) => m.plan.id === planId && m.active);
  return (
    <div className="min-h-dvh bg-surface-2" style={{ fontFamily: site.data?.theme?.fontBody }}>
      <AcademyHeader site={site.data} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-3xl font-semibold">Memberships</h1>
        <p className="mt-2 text-muted">One price, many courses. Renew whenever you like — no automatic charges.</p>
        <div className="mt-8">
          {plans.isError ? <ErrorState error={plans.error} onRetry={() => plans.refetch()} /> : !plans.data ? <Skeleton className="h-64" /> : plans.data.length === 0 ? (
            <Card><EmptyState icon={Crown} title="No memberships available" description="Check back later, or browse individual courses." action={<Link to="/courses"><Button variant="secondary">Browse courses</Button></Link>} /></Card>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {plans.data.map((p) => {
                const a = active(p.id);
                return (
                  <Card key={p.id} className="flex flex-col">
                    <CardBody className="flex flex-1 flex-col gap-4">
                      <div>
                        <p className="text-lg font-semibold">{p.name}</p>
                        <p className="mt-1"><span className="text-2xl font-bold">{formatMoney(p.priceAmount, p.currency)}</span><span className="text-muted"> / {per(p.interval)}</span></p>
                        {p.description && <p className="mt-2 text-sm text-fg-2">{p.description}</p>}
                      </div>
                      <ul className="flex-1 space-y-1 text-sm">{p.courses.map((c) => <li key={c.id}>✓ <Link className="hover:underline" to={`/courses/${c.slug}`}>{c.title}</Link></li>)}</ul>
                      {a && <Badge tone="success">Active until {formatDate(a.currentPeriodEnd)}</Badge>}
                      <Link to={`/checkout/membership/${p.id}`}><Button className="w-full" style={{ background: site.data?.theme?.primaryColor }}>{a ? 'Renew' : 'Join'}</Button></Link>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
