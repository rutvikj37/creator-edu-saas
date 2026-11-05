import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CreditCard, Percent, ShoppingBag, Store, TrendingUp, Wallet } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Card, CardBody, DataTable, EmptyState, ErrorState, Select, StatCard, StatusBadge } from '../../components/ui/index.js';
import { BreakdownChart, TrendChart } from '../../components/charts/ChartCard.jsx';
import { platformApi } from '../../services/api/platform.js';
import { financeApi } from '../../services/api/commerce.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDate, formatMoney, formatNumber } from '../../utils/format.js';

const money = (list) => (list?.length ? list.map((m) => formatMoney(m.amount, m.currency)).join(' · ') : formatMoney(0, 'INR'));

/** Platform finance: SaaS subscription revenue plus academy sales recorded in the commerce ledger. */
export function FinanceDashboardPage() {
  const q = useQuery({ queryKey: ['platform', 'dashboard', 'finance'], queryFn: () => platformApi.dashboard({}) });
  const d = q.data;
  const c = d?.commerce;
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  return (
    <>
      <PageHeader title="Finance overview" description="Subscription revenue and academy sales for the last 30 days." breadcrumbs={[{ label: 'Finance' }]} />
      <h2 className="mb-3 text-sm font-semibold text-fg-2">Academy sales</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Gross sales (GMV)" value={c && money(c.gmv)} hint="Collected by academies via their own Razorpay" icon={ShoppingBag} loading={q.isLoading} />
        <StatCard label="Platform commission" value={c && money(c.platformCommission)} hint="Owed by academies under their plan" icon={Percent} loading={q.isLoading} />
        <StatCard label="Refunds" value={c && money(c.refunds)} icon={Wallet} loading={q.isLoading} />
        <StatCard label="Academies selling" value={formatNumber(c?.sellingAcademies)} hint={c ? `${formatNumber(c.paidOrders)} paid orders` : undefined} icon={Store} loading={q.isLoading} />
      </div>
      <div className="mt-6"><TrendChart title="Paid orders" description="Per day" data={c?.series} loading={q.isLoading} /></div>
      <h2 className="mt-8 mb-3 text-sm font-semibold text-fg-2">Subscriptions</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="MRR" value={d && money(d.subscriptions.mrr)} icon={TrendingUp} loading={q.isLoading} />
        <StatCard label="ARR" value={d && money(d.subscriptions.arr)} icon={CreditCard} loading={q.isLoading} />
        <StatCard label="Past due / grace" value={formatNumber(d?.subscriptions.failed)} icon={AlertTriangle} loading={q.isLoading} />
        <StatCard label="Renewals in 7 days" value={formatNumber(d?.subscriptions.expiringIn7Days)} icon={CalendarClock} loading={q.isLoading} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <BreakdownChart title="Subscriptions by plan" loading={q.isLoading} data={d?.planDistribution.map((p) => ({ name: p.name, value: p.count }))} />
        <Card><CardBody className="space-y-2 text-sm text-fg-2">
          <p className="font-medium text-fg">How money flows</p>
          <p>Academies sell with their own Razorpay accounts, so sale proceeds settle directly to them. The platform records every sale in the ledger and computes the commission set on each plan.</p>
          <p>Collecting commission and paid plan subscriptions from academies is part of SaaS billing, which is not enabled yet.</p>
        </CardBody></Card>
      </div>
    </>
  );
}

export function PlatformTransactionsPage() {
  const [params, update] = useListParams();
  const q = useQuery({ queryKey: ['platform', 'transactions', params], queryFn: () => financeApi.transactions(params), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Transactions" description="Razorpay payments across all academies." breadcrumbs={[{ label: 'Finance' }, { label: 'Transactions' }]} />
      <Card>
        <div className="border-b border-line p-4">
          <Select aria-label="Status" className="sm:w-52" value={params.status ?? ''} onChange={(e) => update({ status: e.target.value || undefined })}
            options={[{ value: '', label: 'All' }, { value: 'CAPTURED', label: 'Captured' }, { value: 'FAILED', label: 'Failed' }, { value: 'CREATED', label: 'Started' }, { value: 'PARTIALLY_REFUNDED', label: 'Partially refunded' }, { value: 'REFUNDED', label: 'Refunded' }]} />
        </div>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta} onPageChange={(page) => update({ page }, { resetPage: false })}
          empty={<EmptyState icon={CreditCard} title="No transactions yet" />}
          columns={[
            { key: 'createdAt', header: 'Date', cell: (r) => formatDate(r.createdAt, { withTime: true }) },
            { key: 'tenant', header: 'Academy', cell: (r) => r.tenant?.name ?? '—' },
            { key: 'orderNumber', header: 'Order', cell: (r) => <span className="font-mono text-xs">{r.orderNumber}</span> },
            { key: 'providerPaymentId', header: 'Razorpay ID', cell: (r) => <span className="font-mono text-xs">{r.providerPaymentId ?? '—'}</span> },
            { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <span className="tabular-nums">{formatMoney(r.amount, r.currency)}</span> },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          ]} />
      </Card>
    </>
  );
}
