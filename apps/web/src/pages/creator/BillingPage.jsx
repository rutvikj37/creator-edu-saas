import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SettingsTabs } from '../../components/layout/SettingsTabs.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, EmptyState, ErrorState, Skeleton, StatusBadge, toast } from '../../components/ui/index.js';
import { creatorApi } from '../../services/api/platform.js';
import { planBillingApi } from '../../services/api/commerce.js';
import { saveBlob } from '../../utils/download.js';
import { formatDate, formatMoney } from '../../utils/format.js';
import { openRazorpay } from '../../utils/razorpay.js';

const KIND = { PLAN: 'Plan', RENEWAL: 'Renewal', COMMISSION: 'Commission' };

function intervalLabel(interval) {
  if (interval === 'YEAR') return '12 months';
  if (interval === 'SIX_MONTH') return '6 months';
  if (interval === 'MONTH') return 'month';
  return String(interval ?? '').toLowerCase();
}

/** Pays an open invoice through Razorpay and confirms it on the server. Returns true when paid. */
async function payInvoice(invoiceId) {
  const { checkout } = await planBillingApi.pay(invoiceId);
  const result = await openRazorpay(checkout);
  if (result.dismissed) {
    toast('Payment not completed');
    return false;
  }
  if (result.failed) {
    toast.error('Payment failed', { description: result.failed });
    return false;
  }
  const inv = await planBillingApi.confirm(invoiceId, result);
  if (inv.status === 'PAID') {
    toast.success('Payment received — thank you!');
    return true;
  }
  toast('Payment is being confirmed', { description: 'This page updates once Razorpay confirms it.' });
  return false;
}

export function BillingPage() {
  const qc = useQueryClient();
  const billing = useQuery({ queryKey: ['creator', 'billing'], queryFn: creatorApi.billing });
  const plans = useQuery({ queryKey: ['creator', 'billing', 'plans'], queryFn: planBillingApi.plans });
  const invoices = useQuery({ queryKey: ['creator', 'billing', 'invoices'], queryFn: planBillingApi.invoices });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [paying, setPaying] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['creator', 'billing'] });
  const cancel = useMutation({ mutationFn: planBillingApi.setCancel, onSuccess: (_, v) => { setConfirmCancel(false); refresh(); toast.success(v ? 'Your plan will end at the end of this period' : 'Your plan will keep renewing'); }, onError: (e) => toast.error(e.message) });
  const pdf = useMutation({ mutationFn: (i) => planBillingApi.pdf(i.id).then((b) => saveBlob(b, `${(i.number ?? `draft-${i.id.slice(-8)}`).replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`)), onError: (e) => toast.error(e.message) });
  const pay = async (inv) => {
    setPaying(inv.id);
    try {
      if (await payInvoice(inv.id)) refresh();
      else invoices.refetch();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setPaying(null);
    }
  };

  if (billing.isError) return <Card><ErrorState error={billing.error} onRetry={() => billing.refetch()} /></Card>;
  if (billing.isLoading) return <Skeleton className="h-96" />;
  const { subscription: s, entitlements: e, usage, catalog } = billing.data;
  // Hide metered AI credits and commission from the Usage grid (commission stays in Current plan).
  const limits = catalog.filter((f) => f.kind === 'limit' && f.key !== 'commission.percent' && f.key !== 'ai.credits');
  const open = (invoices.data ?? []).filter((i) => i.status === 'OPEN');
  const renewal = open.find((i) => i.kind === 'RENEWAL');
  const paidPlan = s?.planPrice && ['ACTIVE', 'PAST_DUE'].includes(s.status);
  const paymentsEnabled = plans.data?.paymentsEnabled;

  return (
    <>
      <PageHeader title="Billing & subscription" description="Your plan, invoices and usage." breadcrumbs={[{ label: 'Billing' }]} /><SettingsTabs />
      {s?.status === 'PAST_DUE' && (
        <Alert tone="error" title="Renewal payment overdue" className="mb-4" action={renewal && <Button size="sm" loading={paying === renewal.id} onClick={() => pay(renewal)}>Pay {formatMoney(renewal.totalAmount, renewal.currency)}</Button>}>
          Everything keeps working until {formatDate(s.graceEndsAt)}. After that, creating courses and taking new payments pauses until the invoice is paid.
        </Alert>
      )}
      {!e.active && (
        <Alert tone="error" title={s?.status === 'TRIALING' || s?.trialEndsAt ? 'Your free trial has ended' : 'No active plan'} className="mb-4" action={renewal && <Button size="sm" loading={paying === renewal.id} onClick={() => pay(renewal)}>Pay renewal</Button>}>
          Your academy stays online and students keep their access, but creating courses and taking new payments is paused.{' '}
          {renewal ? 'Pay the renewal invoice to restore your plan immediately.' : (
            <>To activate a plan, <Link className="font-semibold underline" to="/creator/support?new=billing">contact support</Link>.</>
          )}
        </Alert>
      )}
      {open.filter((i) => i.kind === 'COMMISSION').map((i) => (
        <Alert key={i.id} tone="warning" title="Commission invoice due" className="mb-4" action={<Button size="sm" loading={paying === i.id} onClick={() => pay(i)}>Pay {formatMoney(i.totalAmount, i.currency)}</Button>}>
          Platform commission on your course sales, due {formatDate(i.dueAt)}.
        </Alert>
      ))}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Current plan" actions={s && <StatusBadge status={s.status} />} />
          <CardBody>
            {s ? (
              <div className="space-y-3 text-sm">
                <p className="text-2xl font-semibold">{s.plan.name}</p>
                <p className="text-muted">{s.planPrice ? `${formatMoney(s.planPrice.amount, s.planPrice.currency)} / ${intervalLabel(s.planPrice.interval)}` : s.status === 'TRIALING' ? 'Free trial' : 'Complimentary'}</p>
                {s.status === 'TRIALING' && <p>Trial ends <strong>{formatDate(s.trialEndsAt)}</strong></p>}
                {paidPlan && s.currentPeriodEnd && <p>{s.cancelAtPeriodEnd ? 'Ends' : 'Renews'} <strong>{formatDate(s.currentPeriodEnd)}</strong></p>}
                <p className="text-xs text-muted">Transaction fee: {e.features['commission.percent']?.limit ?? 0}% per sale, invoiced monthly</p>
                {paidPlan && (s.cancelAtPeriodEnd
                  ? <Button size="sm" variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate(false)}>Keep my plan</Button>
                  : <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setConfirmCancel(true)}>Cancel plan</Button>)}
              </div>
            ) : <p className="text-sm text-muted">No subscription.</p>}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Usage" />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            {limits.map((f) => {
              const v = e.features[f.key];
              const used = usage[f.key];
              const pct = v?.limit === 0 ? ((used ?? 0) > 0 ? 100 : 0) : v?.limit ? Math.min(100, Math.round(((used ?? 0) / v.limit) * 100)) : 0;
              return (
                <div key={f.key} className="space-y-1.5">
                  <div className="flex justify-between text-sm"><span>{f.label}</span>
                    <span className="text-muted tabular-nums">{!v?.enabled ? 'Not included' : used === undefined ? (v.limit === null ? 'Unlimited' : `Up to ${v.limit}`) : `${used} / ${v.limit === null ? '∞' : v.limit}`}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-2"><div className={`h-1.5 rounded-full ${pct >= 90 ? 'bg-red-500' : 'bg-primary-600'}`} style={{ width: `${used !== undefined && v?.limit !== null && v?.limit !== undefined ? pct : 0}%` }} /></div>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>

      <h2 className="mt-10 mb-4 text-lg font-semibold">Invoices</h2>
      <Card>
        <DataTable loading={invoices.isLoading} error={invoices.error} onRetry={() => invoices.refetch()} rows={invoices.data ?? []}
          empty={<EmptyState title="No invoices yet" description="Plan and commission invoices appear here." />}
          columns={[
            { key: 'number', header: 'Invoice', cell: (r) => <span className="font-mono text-xs">{r.number ?? 'Draft'}</span> },
            { key: 'kind', header: 'Type', cell: (r) => KIND[r.kind] },
            { key: 'createdAt', header: 'Date', cell: (r) => formatDate(r.paidAt ?? r.createdAt) },
            { key: 'period', header: 'Period', cell: (r) => (r.periodStart ? `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}` : '—') },
            { key: 'totalAmount', header: 'Amount', align: 'right', cell: (r) => <span className="tabular-nums">{formatMoney(r.totalAmount, r.currency)}</span> },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status === 'OPEN' ? 'PENDING' : r.status} label={r.status === 'OPEN' ? `Due ${formatDate(r.dueAt)}` : undefined} /> },
            {
              key: 'actions', header: '', align: 'right',
              cell: (r) => (
                <div className="flex justify-end gap-1">
                  {r.status === 'OPEN' && paymentsEnabled && <Button size="sm" loading={paying === r.id} onClick={() => pay(r)}>Pay</Button>}
                  <Button variant="ghost" size="icon-sm" aria-label={`Download ${r.number ?? 'draft invoice'}`} onClick={() => pdf.mutate(r)}><Download className="size-4" /></Button>
                </div>
              ),
            },
          ]} />
      </Card>
      <ConfirmDialog open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Cancel your plan?" description={`Your plan stays active until ${formatDate(s?.currentPeriodEnd)}. After that, creating courses and taking new payments pauses. You can undo this any time before then.`} confirmLabel="Cancel plan" loading={cancel.isPending} onConfirm={() => cancel.mutate(true)} />
    </>
  );
}
