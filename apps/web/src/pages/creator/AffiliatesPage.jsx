import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Handshake, UserPlus, Wallet } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, Input, Modal, Skeleton, StatusBadge, Switch, Tabs, Textarea, toast } from '../../components/ui/index.js';
import { ListToolbar, MetricCard } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { affiliatesApi } from '../../services/api/affiliates.js';
import { formatDate, formatMoney } from '../../utils/format.js';

const HOW_STEPS = [
  { title: 'Turn the program on', text: 'Set commission %, cookie window and approval rules in Program settings.' },
  { title: 'Invite partners', text: 'Add an existing student or team member by email, or let them join from Earn by sharing.' },
  { title: 'They share their link', text: 'Each affiliate gets a unique ?ref=CODE link. Clicks are tracked for the cookie window.' },
  { title: 'Sales earn commission', text: 'Paid orders through their link create commissions (ex-GST). After the hold, mark them paid.' },
];

function HowItWorks() {
  return (
    <Card className="mb-6 overflow-hidden border-primary-200 bg-gradient-to-br from-primary-50/80 to-surface">
      <CardHeader title="How affiliates work" description="A short path from setup to payout — so your partners know exactly what to do." />
      <CardBody>
        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {HOW_STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-xl border border-line bg-surface p-4 shadow-xs">
              <span className="mb-3 grid size-8 place-items-center rounded-full bg-primary-600 text-sm font-semibold text-on-primary">{i + 1}</span>
              <p className="font-medium text-fg">{s.title}</p>
              <p className="mt-1 text-sm text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-muted">
          Students find the program under <strong>Earn by sharing</strong> on the academy. Referral links look like{' '}
          <code className="rounded bg-surface-2 px-1.5 py-0.5">https://your-academy/?ref=THEIRCODE</code>
        </p>
      </CardBody>
    </Card>
  );
}

function InviteModal({ open, onClose }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [rate, setRate] = useState('');
  const invite = useMutation({
    mutationFn: () => affiliatesApi.invite({ email: email.trim(), commissionPercent: rate === '' ? undefined : Number(rate) }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['affiliates'] });
      toast.success(`${row?.user?.fullName || email} is now an affiliate`);
      setEmail('');
      setRate('');
      onClose();
    },
    onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });
  return (
    <Modal open={open} onClose={onClose} title="Invite an affiliate" description="They must already have an account in this academy (student or team).">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
        <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="partner@example.com" />
        <Input label="Commission % (optional)" type="number" min={1} max={90} value={rate} onChange={(e) => setRate(e.target.value)} hint="Leave blank to use the program default" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" leftIcon={UserPlus} loading={invite.isPending} disabled={!email.trim()}>Invite</Button>
        </div>
      </form>
    </Modal>
  );
}

function ProgramCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['affiliates', 'program'], queryFn: affiliatesApi.program });
  const [draft, setDraft] = useState(null);
  const save = useMutation({ mutationFn: (body) => affiliatesApi.saveProgram(body), onSuccess: (d) => { qc.setQueryData(['affiliates', 'program'], d); setDraft(null); toast.success('Saved'); }, onError: (e) => toast.error(e.details?.[0]?.message ?? e.message) });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  if (!q.data) return <Skeleton className="h-48" />;
  const v = draft ?? q.data;
  const set = (patch) => setDraft({ ...v, ...patch });
  return (
    <Card>
      <CardHeader title="Program" description="Students share your courses with their link and earn a share of each sale (excluding GST)." actions={<Switch label="Program on" checked={q.data.enabled} onChange={(enabled) => save.mutate({ enabled })} />} />
      <CardBody className="space-y-4">
        {!q.data.enabled && <Alert tone="info">Turn the program on so partners can join and referral links start tracking.</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Commission %" type="number" min={1} max={90} value={v.defaultPercent} onChange={(e) => set({ defaultPercent: Number(e.target.value) })} />
          <Input label="Link counts for (days)" type="number" min={1} max={365} value={v.cookieDays} onChange={(e) => set({ cookieDays: Number(e.target.value) })} />
          <Input label="Hold before approval (days)" type="number" min={0} max={90} hint="Covers your refund window" value={v.holdDays} onChange={(e) => set({ holdDays: Number(e.target.value) })} />
        </div>
        <Switch label="Approve new affiliates automatically" checked={v.autoApprove} onChange={(autoApprove) => set({ autoApprove })} />
        <Textarea label="Program terms (shown to students)" rows={3} value={v.terms ?? ''} onChange={(e) => set({ terms: e.target.value })} />
        {draft && <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setDraft(null)}>Discard</Button><Button loading={save.isPending} onClick={() => save.mutate({ defaultPercent: v.defaultPercent, cookieDays: v.cookieDays, holdDays: v.holdDays, autoApprove: v.autoApprove, terms: v.terms })}>Save</Button></div>}
        <p className="text-xs text-muted">The default rate applies to new affiliates; you can change it per affiliate below.</p>
      </CardBody>
    </Card>
  );
}

function PayoutModal({ affiliate, onClose }) {
  const qc = useQueryClient();
  const [ref, setRef] = useState('');
  const pay = useMutation({ mutationFn: () => affiliatesApi.payout(affiliate.id, ref.trim()), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['affiliates'] }); toast.success(`${r.paid} commission${r.paid === 1 ? '' : 's'} marked paid`); onClose(); }, onError: (e) => toast.error(e.message) });
  return (
    <Modal open={Boolean(affiliate)} onClose={onClose} title={`Pay ${affiliate?.user?.fullName ?? ''}`}>
      {affiliate && (
        <div className="space-y-4 text-sm">
          <p>Approved commissions: <strong>{formatMoney(affiliate.owed, 'INR')}</strong>. Pay them via UPI/bank, then record the reference here.</p>
          {affiliate.payoutDetails ? <p className="rounded-md bg-surface-2 p-3"><span className="text-muted">Payout details:</span> {affiliate.payoutDetails}</p> : <Alert tone="warning">This affiliate has not added payout details yet.</Alert>}
          <Input label="Payment reference (UTR)" value={ref} onChange={(e) => setRef(e.target.value)} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={ref.trim().length < 3} loading={pay.isPending} onClick={() => pay.mutate()}>Mark paid</Button></div>
        </div>
      )}
    </Modal>
  );
}

export function AffiliatesPage() {
  const qc = useQueryClient();
  const program = useQuery({ queryKey: ['affiliates', 'program'], queryFn: affiliatesApi.program });
  const q = useQuery({ queryKey: ['affiliates', 'list'], queryFn: affiliatesApi.list });
  const [paying, setPaying] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [tab, setTab] = useState('affiliates');
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState();
  const update = useMutation({ mutationFn: ({ id, ...body }) => affiliatesApi.update(id, body), onSuccess: () => qc.invalidateQueries({ queryKey: ['affiliates'] }), onError: (e) => toast.error(e.message) });
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const rows = all.filter((r) => (!term || `${r.user?.fullName ?? ''} ${r.user?.email ?? ''} ${r.code}`.toLowerCase().includes(term)) && (!statusF || r.status === statusF));
  const sum = (k) => all.reduce((n, r) => n + Number(r[k] ?? 0), 0);
  const copyLink = (code) => navigator.clipboard?.writeText(`${window.location.origin}/?ref=${code}`).then(() => toast.success('Referral link copied'));
  return (
    <>
      <PageHeader
        title="Affiliates"
        count={q.data ? all.length : undefined}
        description="Manage your reseller and affiliate team: partners earn a share of each sale they bring."
        breadcrumbs={[{ label: 'Affiliates' }]}
        actions={tab === 'affiliates' ? <Button leftIcon={UserPlus} onClick={() => setInviting(true)} disabled={program.data && !program.data.enabled}>Invite affiliate</Button> : undefined}
      />
      <HowItWorks />
      <Tabs className="mb-6" value={tab} onChange={setTab} tabs={[{ value: 'affiliates', label: 'Affiliates', count: q.data ? all.length : undefined }, { value: 'settings', label: 'Program settings' }]} />
      {tab === 'settings' ? <ProgramCard /> : (
        <>
          {program.data && !program.data.enabled && (
            <Alert tone="warning" className="mb-4" title="Program is off">
              Turn it on in Program settings before inviting partners or tracking referral links.{' '}
              <button type="button" className="font-medium underline" onClick={() => setTab('settings')}>Open settings</button>
            </Alert>
          )}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Link clicks" value={sum('clicks').toLocaleString('en-IN')} loading={q.isLoading} />
            <MetricCard label="Sales by affiliates" value={sum('conversions').toLocaleString('en-IN')} loading={q.isLoading} />
            <MetricCard label="Commission on hold" value={formatMoney(sum('pending'), 'INR')} hint="Waiting out the refund window" loading={q.isLoading} />
            <MetricCard label="Commission to pay" value={formatMoney(sum('owed'), 'INR')} hint="Approved, not yet paid" loading={q.isLoading} />
          </div>
          <Card>
            <ListToolbar search={search} onSearch={setSearch} placeholder="Search by name, email or code" count={rows.length} noun="affiliate"
              filtered={Boolean(term || statusF)} onReset={() => { setSearch(''); setStatusF(undefined); }}
              filters={<FilterChip label="Status" value={statusF} onChange={setStatusF} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'PENDING', label: 'Waiting for approval' }, { value: 'SUSPENDED', label: 'Suspended' }]} />} />
            <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={rows}
              empty={all.length ? <EmptyState icon={Handshake} title="No affiliates match" description="Try a different search or clear the filters." />
                : <EmptyState icon={Handshake} title="No affiliates yet" description="Invite a student by email, or turn the program on so they can join from Earn by sharing on the academy." action={<div className="flex flex-wrap justify-center gap-2"><Button size="sm" leftIcon={UserPlus} onClick={() => setInviting(true)}>Invite affiliate</Button><Button size="sm" variant="secondary" onClick={() => setTab('settings')}>Program settings</Button></div>} />}
              columns={[
                { key: 'user', header: 'Affiliate', cell: (r) => <div className="flex items-center gap-2.5"><Avatar name={r.user?.fullName || r.code} size="sm" /><div className="min-w-0"><p className="truncate font-medium text-fg">{r.user?.fullName}</p><p className="truncate text-xs text-muted">{r.user?.email}</p><p className="font-mono text-xs text-muted">{r.code}</p></div></div> },
                { key: 'commissionPercent', header: 'Rate %', cell: (r) => <Input aria-label={`Rate for ${r.user?.fullName}`} type="number" className="w-20" defaultValue={r.commissionPercent} onBlur={(e) => Number(e.target.value) !== r.commissionPercent && update.mutate({ id: r.id, commissionPercent: Number(e.target.value) })} /> },
                { key: 'clicks', header: 'Clicks', align: 'right' },
                { key: 'conversions', header: 'Sales', align: 'right' },
                { key: 'pending', header: 'On hold', align: 'right', cell: (r) => formatMoney(r.pending, 'INR') },
                { key: 'owed', header: 'To pay', align: 'right', cell: (r) => formatMoney(r.owed, 'INR') },
                { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status === 'ACTIVE' ? 'ACTIVE' : r.status === 'PENDING' ? 'PENDING' : 'SUSPENDED'} /> },
                {
                  key: 'actions', header: '', align: 'right',
                  cell: (r) => (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" leftIcon={Copy} aria-label="Copy referral link" onClick={() => copyLink(r.code)} />
                      {r.status !== 'ACTIVE' ? <Button size="sm" onClick={() => update.mutate({ id: r.id, status: 'ACTIVE' })}>{r.status === 'PENDING' ? 'Approve' : 'Reactivate'}</Button> : <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: r.id, status: 'SUSPENDED' })}>Suspend</Button>}
                      {Number(r.owed) > 0 && <Button size="sm" variant="secondary" leftIcon={Wallet} onClick={() => setPaying(r)}>Pay</Button>}
                    </div>
                  ),
                },
              ]} />
          </Card>
        </>
      )}
      <PayoutModal affiliate={paying} onClose={() => setPaying(null)} />
      <InviteModal open={inviting} onClose={() => setInviting(false)} />
    </>
  );
}


/** Student-side affiliate dashboard. */
export function StudentAffiliatePage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['learn', 'affiliate'], queryFn: affiliatesApi.me });
  const [accept, setAccept] = useState(false);
  const [payout, setPayout] = useState(null);
  const join = useMutation({ mutationFn: () => affiliatesApi.join({ acceptTerms: true }), onSuccess: (d) => qc.setQueryData(['learn', 'affiliate'], d), onError: (e) => toast.error(e.message) });
  const savePayout = useMutation({ mutationFn: () => affiliatesApi.setPayoutDetails(payout), onSuccess: (d) => { qc.setQueryData(['learn', 'affiliate'], d); setPayout(null); toast.success('Saved'); } });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const d = q.data;
  const link = d?.affiliate ? `${window.location.origin}/?ref=${d.affiliate.code}` : '';
  const cur = d?.stats?.currency ?? 'INR';
  return (
    <>
      <PageHeader title="Earn by sharing" description="Share courses you love and earn a commission on every sale." breadcrumbs={[{ label: 'Affiliate' }]} />
      {!d ? <Skeleton className="h-48" /> : !d.program.enabled ? <Card><EmptyState icon={Handshake} title="No affiliate program here" description="This academy doesn't run an affiliate program right now." /></Card> : !d.affiliate ? (
        <Card>
          <CardBody className="space-y-4">
            <p>Earn <strong>{d.program.defaultPercent}%</strong> of each sale (excluding GST) made through your link within {d.program.cookieDays} days of the click. Commissions are confirmed after {d.program.holdDays} days.</p>
            {d.program.terms && <p className="whitespace-pre-line rounded-md bg-surface-2 p-3 text-sm text-fg-2">{d.program.terms}</p>}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary-600" checked={accept} onChange={(e) => setAccept(e.target.checked)} />I accept the program terms</label>
            <Button disabled={!accept} loading={join.isPending} onClick={() => join.mutate()}>Join the program</Button>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-6">
          {d.affiliate.status !== 'ACTIVE' && <Alert tone="info">{d.affiliate.status === 'PENDING' ? 'Your application is waiting for approval. Your link starts working once approved.' : 'Your affiliate account is suspended.'}</Alert>}
          <Card>
            <CardHeader title="Your link" description="Add it to any academy page — it works on course pages too." />
            <CardBody className="flex items-center gap-2"><code className="flex-1 break-all rounded-md bg-surface-2 p-2 text-sm">{link}</code><Button variant="secondary" leftIcon={Copy} onClick={() => navigator.clipboard?.writeText(link).then(() => toast.success('Copied'))}>Copy</Button></CardBody>
          </Card>
          <div className="grid gap-4 sm:grid-cols-4">
            {[['Clicks', d.stats.clicks], ['Sales', d.stats.conversions], ['On hold', formatMoney(d.stats.pending, cur)], ['Paid out', formatMoney(d.stats.paid, cur)]].map(([l, v]) => <Card key={l} className="p-4"><p className="text-xs text-muted uppercase">{l}</p><p className="mt-1 text-xl font-semibold">{v}</p></Card>)}
          </div>
          <Card>
            <CardHeader title="Payout details" description="Where the academy sends your earnings (UPI id or bank details)." />
            <CardBody className="space-y-2">
              <Input aria-label="Payout details" value={payout ?? d.affiliate.payoutDetails ?? ''} onChange={(e) => setPayout(e.target.value)} placeholder="yourname@upi" />
              {payout !== null && <Button size="sm" loading={savePayout.isPending} onClick={() => savePayout.mutate()}>Save</Button>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Commissions" />
            <DataTable rows={d.conversions} empty={<EmptyState title="No sales yet" className="py-8" />}
              columns={[
                { key: 'date', header: 'Date', cell: (r) => formatDate(r.date) },
                { key: 'saleAmount', header: 'Sale', align: 'right', cell: (r) => formatMoney(r.saleAmount, r.currency) },
                { key: 'commission', header: 'Commission', align: 'right', cell: (r) => formatMoney(r.commission, r.currency) },
                { key: 'status', header: 'Status', cell: (r) => <Badge tone={r.status === 'PAID' || r.status === 'APPROVED' ? 'success' : r.status === 'REVERSED' ? 'neutral' : 'warning'}>{r.status === 'PENDING' ? `On hold until ${formatDate(r.approvableAt)}` : r.status.toLowerCase()}</Badge> },
              ]} />
          </Card>
        </div>
      )}
    </>
  );
}
