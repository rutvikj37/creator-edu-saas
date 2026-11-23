import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, CreditCard, Download, RefreshCw } from 'lucide-react';
import { ListToolbar } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Input, Modal, StatusBadge, Tabs, toast } from '../../components/ui/index.js';
import { platformBillingApi } from '../../services/api/commerce.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useListParams } from '../../hooks/useListParams.js';
import { saveBlob } from '../../utils/download.js';
import { formatDate, formatMoney } from '../../utils/format.js';

const KIND = { PLAN: 'Plan', RENEWAL: 'Renewal', COMMISSION: 'Commission' };

function GatewayCard() {
  const [verify, setVerify] = useState(false);
  const q = useQuery({ queryKey: ['platform', 'billing', 'gateway', verify], queryFn: () => platformBillingApi.gateway(verify) });
  const g = q.data;
  return (
    <Card className="mb-6">
      <CardHeader title={<span className="flex items-center gap-2"><CreditCard className="size-4" />Platform Razorpay account</span>} description="Academies pay plan and commission invoices here."
        actions={g?.configured && (g.status === 'VERIFIED' ? <Badge tone="success">Verified</Badge> : g.status === 'ERROR' ? <Badge tone="danger">Check failed</Badge> : <Badge tone="warning">Not checked</Badge>)} />
      <CardBody className="space-y-3 text-sm">
        {!g ? null : !g.configured ? (
          <Alert tone="warning" title="Not configured">Add the platform key id and secret in <Link className="font-semibold underline" to="/super-admin/settings">Settings → payments</Link>. Until then academies can only change plans through support.</Alert>
        ) : (
          <>
            {g.status === 'ERROR' && <Alert tone="error">{g.error}</Alert>}
            <dl className="grid gap-y-1 sm:grid-cols-[160px_1fr]">
              <dt className="text-muted">Mode</dt><dd>{g.mode === 'LIVE' ? 'Live' : 'Test'}</dd>
              <dt className="text-muted">Key ID</dt><dd className="font-mono text-xs">{g.keyId}</dd>
              <dt className="text-muted">Webhook secret</dt><dd>{g.hasWebhookSecret ? 'Saved' : 'Missing — add it in Settings'}</dd>
            </dl>
            <Button size="sm" variant="secondary" leftIcon={RefreshCw} loading={q.isFetching && verify} onClick={() => (verify ? q.refetch() : setVerify(true))}>Check keys with Razorpay</Button>
          </>
        )}
        {g && (
          <div>
            <p className="text-muted">Webhook URL (events: payment.captured, payment.failed, order.paid)</p>
            <div className="mt-1 flex items-center gap-2 rounded-md border border-line bg-surface-2 p-2"><code className="flex-1 break-all text-xs">{g.webhookUrl}</code>
              <Button variant="ghost" size="icon-sm" aria-label="Copy webhook URL" onClick={() => navigator.clipboard?.writeText(g.webhookUrl).then(() => toast.success('Copied'))}><Copy className="size-3.5" /></Button></div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function InvoiceActions({ invoice, onDone }) {
  const [mode, setMode] = useState(null);
  const [value, setValue] = useState('');
  const run = useMutation({
    mutationFn: () => (mode === 'pay' ? platformBillingApi.recordPayment(invoice.id, value.trim()) : platformBillingApi.void(invoice.id, value.trim())),
    onSuccess: () => { toast.success(mode === 'pay' ? 'Payment recorded' : 'Invoice voided'); setMode(null); setValue(''); onDone(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="secondary" onClick={() => setMode('pay')}>Record payment</Button>
        <Button size="sm" variant="ghost" onClick={() => setMode('void')}>Void</Button>
      </div>
      <Modal open={Boolean(mode)} onClose={() => setMode(null)} title={mode === 'pay' ? 'Record a bank transfer' : 'Void invoice'}>
        <div className="space-y-4">
          <p className="text-sm text-fg-2">{mode === 'pay' ? `Marks this ${formatMoney(invoice.totalAmount, invoice.currency)} invoice as paid and applies it (plan or renewal) immediately.` : 'The academy no longer owes this invoice. This cannot be undone.'}</p>
          <Input label={mode === 'pay' ? 'Bank reference / UTR' : 'Reason'} value={value} onChange={(e) => setValue(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode(null)}>Cancel</Button>
            <Button variant={mode === 'void' ? 'danger' : 'primary'} disabled={value.trim().length < 3} loading={run.isPending} onClick={() => run.mutate()}>{mode === 'pay' ? 'Mark paid' : 'Void invoice'}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function SubscriptionsAdminPage({ initialTab = 'subscriptions' }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const [params, update] = useListParams();
  const subs = useQuery({ queryKey: ['platform', 'billing', 'subs', params], queryFn: () => platformBillingApi.subscriptions(params), enabled: tab === 'subscriptions', placeholderData: (p) => p });
  const invoices = useQuery({ queryKey: ['platform', 'billing', 'invoices', params], queryFn: () => platformBillingApi.invoices(params), enabled: tab === 'invoices', placeholderData: (p) => p });
  const pdf = useMutation({ mutationFn: (i) => platformBillingApi.pdf(i.id).then((b) => saveBlob(b, `${(i.number ?? `draft-${i.id.slice(-8)}`).replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`)), onError: (e) => toast.error(e.message) });
  const canManage = auth.can('platform.finance.manage');
  return (
    <>
      <PageHeader title="Plan billing" description="Academy subscriptions and the invoices they pay the platform." />
      <GatewayCard />
      <Tabs className="mb-4" value={tab} onChange={(v) => { setTab(v); update({ status: undefined, page: undefined }); }} tabs={[{ value: 'subscriptions', label: 'Subscriptions' }, { value: 'invoices', label: 'Invoices' }]} />
      {tab === 'subscriptions' ? (
        <Card>
          <ListToolbar count={subs.data?.meta?.total} noun="subscription" filtered={Boolean(params.status)} onReset={() => update({ status: undefined })}
            filters={<FilterChip label="Status" value={params.status} onChange={(v) => update({ status: v })} options={['TRIALING', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELED'].map((s) => ({ value: s, label: s.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) }))} />} />
          <DataTable loading={subs.isLoading} error={subs.error} onRetry={() => subs.refetch()} rows={subs.data?.items ?? []} meta={subs.data?.meta} onPageChange={(page) => update({ page }, { resetPage: false })}
            empty={<EmptyState title="No subscriptions" />}
            columns={[
              { key: 'tenant', header: 'Academy', cell: (r) => <Link className="font-medium text-primary-600 hover:underline" to={`/super-admin/tenants/${r.tenant.id}`}>{r.tenant.name}</Link> },
              { key: 'plan', header: 'Plan', cell: (r) => r.plan.name },
              { key: 'amount', header: 'Price', cell: (r) => (r.amount ? `${formatMoney(r.amount, r.currency)} / ${r.interval.toLowerCase()}` : r.status === 'TRIALING' ? 'Trial' : 'Complimentary') },
              { key: 'end', header: 'Period / trial ends', cell: (r) => formatDate(r.status === 'TRIALING' ? r.trialEndsAt : r.currentPeriodEnd) },
              { key: 'status', header: 'Status', cell: (r) => <div><StatusBadge status={r.status} />{r.cancelAtPeriodEnd && <p className="mt-1 text-xs text-muted">Cancels at period end</p>}{r.graceEndsAt && r.status === 'PAST_DUE' && <p className="mt-1 text-xs text-muted">Grace until {formatDate(r.graceEndsAt)}</p>}</div> },
            ]} />
        </Card>
      ) : (
        <Card>
          <ListToolbar count={invoices.data?.meta?.total} noun="invoice" filtered={Boolean(params.status)} onReset={() => update({ status: undefined })}
            filters={<FilterChip label="Status" value={params.status} onChange={(v) => update({ status: v })} options={[{ value: 'OPEN', label: 'Open' }, { value: 'PAID', label: 'Paid' }, { value: 'VOID', label: 'Void' }]} />} />
          <DataTable loading={invoices.isLoading} error={invoices.error} onRetry={() => invoices.refetch()} rows={invoices.data?.items ?? []} meta={invoices.data?.meta} onPageChange={(page) => update({ page }, { resetPage: false })}
            empty={<EmptyState title="No invoices" />}
            columns={[
              { key: 'number', header: 'Invoice', cell: (r) => <span className="font-mono text-xs">{r.number ?? 'Draft'}</span> },
              { key: 'tenant', header: 'Academy', cell: (r) => r.tenant?.name ?? '—' },
              { key: 'kind', header: 'Type', cell: (r) => KIND[r.kind] },
              { key: 'totalAmount', header: 'Amount', align: 'right', cell: (r) => <span className="tabular-nums">{formatMoney(r.totalAmount, r.currency)}</span> },
              { key: 'dueAt', header: 'Due / paid', cell: (r) => formatDate(r.paidAt ?? r.dueAt) },
              { key: 'status', header: 'Status', cell: (r) => <div><StatusBadge status={r.status === 'OPEN' ? 'PENDING' : r.status === 'VOID' ? 'CANCELLED' : r.status} label={r.status === 'OPEN' ? 'Open' : r.status === 'VOID' ? 'Void' : r.paidVia === 'OFFLINE' ? 'Paid (bank)' : 'Paid'} /></div> },
              {
                key: 'actions', header: '', align: 'right',
                cell: (r) => (
                  <div className="flex items-center justify-end gap-1">
                    {r.status === 'OPEN' && canManage && <InvoiceActions invoice={r} onDone={() => qc.invalidateQueries({ queryKey: ['platform', 'billing'] })} />}
                    <Button variant="ghost" size="icon-sm" aria-label="Download PDF" onClick={() => pdf.mutate(r)}><Download className="size-4" /></Button>
                  </div>
                ),
              },
            ]} />
        </Card>
      )}
    </>
  );
}
