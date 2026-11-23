import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, Crown, MoreHorizontal, Pencil, Plus, Users, Wallet } from 'lucide-react';
import { creatorCommerceApi } from '../../services/api/commerce.js';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { ListToolbar, MetricCard } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { PERIOD_OPTIONS, inPeriod } from '../../utils/period.js';
import { Badge, Button, Card, CardBody, Drawer, Dropdown, DropdownItem, EmptyState, ErrorState, Skeleton, StatusBadge, toast } from '../../components/ui/index.js';
import { membershipsApi } from '../../services/api/community.js';
import { academyApi } from '../../services/api/auth.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatMoney } from '../../utils/format.js';
import { AcademyHeader } from '../public/AcademyLandingPage.jsx';

const per = (interval) => (interval === 'YEAR' ? 'year' : 'month');

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
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['memberships', 'plans'], queryFn: membershipsApi.plans });
  const stats = useQuery({ queryKey: ['memberships', 'stats'], queryFn: membershipsApi.stats });
  const gateway = useQuery({ queryKey: ['creator', 'gateway'], queryFn: creatorCommerceApi.gateway, retry: false });
  const [members, setMembers] = useState(null);
  const setStatus = useMutation({
    mutationFn: ({ id, status }) => membershipsApi.update(id, { status }),
    onSuccess: (p) => { toast.success(p.status === 'ACTIVE' ? 'Membership published' : p.status === 'ARCHIVED' ? 'Membership archived' : 'Moved to drafts'); qc.invalidateQueries({ queryKey: ['memberships'] }); },
    onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState();
  const [periodF, setPeriodF] = useState();
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const rows = all.filter((r) => (!term || r.name.toLowerCase().includes(term)) && (!statusF || r.status === statusF) && inPeriod(r.createdAt, periodF));
  return (
    <>
      <PageHeader title="Memberships" description="Sell a month or a year of access to a bundle of courses." actions={<Button leftIcon={Plus} onClick={() => navigate('/creator/memberships/new')}>Create</Button>} />
      {gateway.data && !(gateway.data.configured && gateway.data.isActive) && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center dark:border-amber-500/30 dark:bg-amber-500/10">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-amber-600 text-white"><AlertTriangle className="size-5" aria-hidden /></span>
          <div className="flex-1"><p className="font-semibold text-amber-800 dark:text-amber-200">Set up payments to receive money</p><p className="text-sm text-amber-800/80 dark:text-amber-200/80">Memberships can’t be bought until you connect Razorpay.</p></div>
          <Link to="/creator/payments" className="inline-flex h-9 items-center rounded-full border border-line bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-2">Set up payments</Link>
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <MetricCard label="Total members" value={(stats.data?.totalMembers ?? 0).toLocaleString('en-IN')} hint="With an active membership" loading={stats.isLoading} />
        <MetricCard label="Total revenue" value={formatMoney(stats.data?.totalRevenue ?? 0, stats.data?.currency ?? 'INR')} hint="Paid membership orders" loading={stats.isLoading} />
      </div>
      <Card>
        <ListToolbar search={search} onSearch={setSearch} placeholder="Search" count={rows.length} noun="membership"
          filtered={Boolean(term || statusF || periodF)} onReset={() => { setSearch(''); setStatusF(undefined); setPeriodF(undefined); }}
          filters={<>
            <FilterChip label="Status" value={statusF} onChange={setStatusF} options={[{ value: 'DRAFT', label: 'Draft' }, { value: 'ACTIVE', label: 'Published' }, { value: 'ARCHIVED', label: 'Archived' }]} />
            <FilterChip label="Created on" value={periodF} onChange={setPeriodF} options={PERIOD_OPTIONS} />
          </>} />
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="m-4 h-64" /> : !rows.length ? (
          all.length ? <EmptyState icon={Crown} title="No memberships match" description="Try a different search or clear the filters." />
            : <EmptyState icon={Crown} title="No memberships yet" description="Bundle courses into a membership people pay for every month or year." action={<Button leftIcon={Plus} onClick={() => navigate('/creator/memberships/new')}>Create a membership</Button>} />
        ) : (
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <article key={r.id} className="flex flex-col rounded-xl border border-line p-3">
                <button type="button" aria-label={`Edit ${r.name}`} onClick={() => navigate(`/creator/memberships/${r.id}/edit`)} className="aspect-[4/3] overflow-hidden rounded-lg bg-gradient-to-br from-sky-200 via-blue-400 to-indigo-600">
                  {r.coverUrl ? <img src={r.coverUrl} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center"><span className="grid size-14 place-items-center rounded-full bg-white/50 text-indigo-700"><Crown className="size-6" aria-hidden /></span></span>}
                </button>
                <div className="mt-3 flex items-center justify-between">
                  <Badge tone={r.status === 'ACTIVE' ? 'success' : 'neutral'}>{r.status === 'ACTIVE' ? 'Published' : r.status === 'DRAFT' ? 'Draft' : 'Archived'}</Badge>
                  <Dropdown trigger={(p) => <button type="button" {...p} aria-label={`Actions for ${r.name}`} className="grid size-8 place-items-center rounded-md text-fg-2 hover:bg-surface-2"><MoreHorizontal className="size-4" aria-hidden /></button>}>
                    <DropdownItem icon={Pencil} onClick={() => navigate(`/creator/memberships/${r.id}/edit`)}>Edit</DropdownItem>
                    <DropdownItem icon={Users} onClick={() => setMembers(r)}>Members</DropdownItem>
                    {r.status !== 'ACTIVE' && <DropdownItem onClick={() => setStatus.mutate({ id: r.id, status: 'ACTIVE' })}>{r.status === 'ARCHIVED' ? 'Restore' : 'Publish'}</DropdownItem>}
                    {r.status === 'ACTIVE' && <DropdownItem icon={Archive} onClick={() => setStatus.mutate({ id: r.id, status: 'ARCHIVED' })}>Archive</DropdownItem>}
                  </Dropdown>
                </div>
                <p className="mt-1 text-lg font-semibold text-fg">{r.name}</p>
                <p className="line-clamp-2 text-sm text-muted">{r.description || `${r.courseIds.length} course${r.courseIds.length === 1 ? '' : 's'}`}</p>
                <p className="mt-1 text-sm text-fg-2">{Number(r.priceAmount) > 0 ? `${formatMoney(r.priceAmount, r.currency)} / ${per(r.interval)}` : 'No price yet'}</p>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5" title="Active members"><Users className="size-3.5" aria-hidden />{r.activeMembers ?? 0}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5" title="Revenue"><Wallet className="size-3.5" aria-hidden />{formatMoney(r.revenue ?? 0, r.currency)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">Archiving stops new sales; existing members keep access until their period ends. Share <span className="font-mono">/memberships</span> on your academy to sell plans.</p>
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
                        <p className="mt-1"><span className="text-2xl font-bold">{formatMoney(p.priceAmount, p.currency)}</span>{p.compareAtAmount && <span className="ml-2 text-muted line-through">{formatMoney(p.compareAtAmount, p.currency)}</span>}<span className="text-muted">{p.lifetime ? ' · lifetime access' : ` / ${per(p.interval)}`}</span>{p.taxExclusive && <span className="text-sm text-muted"> + taxes</span>}</p>
                        {p.description && <p className="mt-2 text-sm text-fg-2">{p.description}</p>}
                      </div>
                      <ul className="flex-1 space-y-1 text-sm">{p.courses.map((c) => <li key={c.id}>✓ <Link className="hover:underline" to={`/courses/${c.slug}`}>{c.title}</Link></li>)}</ul>
                      {a && <Badge tone="success">Active until {formatDate(a.currentPeriodEnd)}</Badge>}
                      <Link to={a && p.lifetime ? '/learn' : `/checkout/membership/${p.id}`}><Button className="w-full" style={{ background: site.data?.theme?.primaryColor }}>{a ? (p.lifetime ? 'Open my courses' : 'Renew') : p.buttonText || 'Join'}</Button></Link>
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
