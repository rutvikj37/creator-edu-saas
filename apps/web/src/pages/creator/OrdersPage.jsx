import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, ReceiptText, ShoppingCart } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { ListToolbar, MetricCard } from '../../components/common/ListToolbar.jsx';
import { presetRange } from '../../components/common/DateRangeFilter.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Avatar, Button, Card, DataTable, EmptyState, Select, Skeleton, StatusBadge, toast } from '../../components/ui/index.js';
import { creatorCommerceApi } from '../../services/api/commerce.js';
import { analyticsApi } from '../../services/api/analytics.js';
import { coursesApi } from '../../services/api/creator.js';
import { useListParams } from '../../hooks/useListParams.js';
import { saveBlob } from '../../utils/download.js';
import { formatDate, formatMoney, formatNumber } from '../../utils/format.js';

export const ORDER_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PAID', label: 'Paid' },
  { value: 'PAYMENT_INITIATED', label: 'Awaiting payment' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'PARTIALLY_REFUNDED', label: 'Partially refunded' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'EXPIRED', label: 'Expired' },
];

export function RevenueSummary() {
  const s = useQuery({ queryKey: ['creator', 'orders', 'summary'], queryFn: () => creatorCommerceApi.summary({}) });
  const t = s.data?.totals?.[0];
  const cur = t?.currency ?? 'INR';
  const m = (v) => formatMoney(v ?? 0, cur);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total revenue" value={m(t?.gross)} hint={`${formatNumber(s.data?.paidOrders ?? 0)} paid orders, incl. GST`} loading={s.isLoading} />
        <MetricCard label="Total refunds" value={m(t?.refunds)} hint={s.data?.refundsPending ? `${s.data.refundsPending} pending` : 'No refunds pending'} loading={s.isLoading} />
        <MetricCard label="GST · fees · commission" value={m((Number(t?.tax ?? 0) + Number(t?.gatewayFees ?? 0) + Number(t?.platformCommission ?? 0)).toFixed(2))} hint={t ? `GST ${m(t.tax)} · Razorpay ${m(t.gatewayFees)} · Platform ${m(t.platformCommission)}` : undefined} loading={s.isLoading} />
        <MetricCard label="Net earnings" value={m(t?.net)} hint="What you keep after all deductions" loading={s.isLoading} />
      </div>
      {s.data && s.data.totals.length > 1 && <Alert tone="info" className="mt-3">Sales in other currencies: {s.data.totals.slice(1).map((x) => `${formatMoney(x.net, x.currency)} net`).join(' · ')}</Alert>}
    </>
  );
}

const PERIODS = [{ value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: '90d', label: 'Last 90 days' }, { value: 'month', label: 'This month' }, { value: 'lastMonth', label: 'Last month' }];
const STATUS_FILTERS = ORDER_STATUS_OPTIONS.filter((o) => o.value);

function itemKind(i) {
  if (i.bundleId) return 'Bundle';
  if (i.digitalProductId) return 'Digital product';
  if (i.liveClassId) return 'Webinar ticket';
  if (i.membershipPlanId) return 'Membership';
  return 'Course';
}

function TwoLineDate({ value }) {
  return <div className="leading-tight"><p className="text-fg-2">{formatDate(value)}</p><p className="text-xs text-muted">{new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p></div>;
}

export function OrdersPage() {
  const [params, update] = useListParams();
  const navigate = useNavigate();
  const range = params.period ? presetRange(params.period) : {};
  const query = { q: params.q, status: params.status, courseId: params.courseId, ...range, page: params.page, pageSize: params.pageSize };
  const q = useQuery({ queryKey: ['creator', 'orders', query], queryFn: () => creatorCommerceApi.orders(query), placeholderData: (p) => p });
  const courses = useQuery({ queryKey: ['creator', 'courses', 'picker'], queryFn: () => coursesApi.list({ pageSize: 100, sort: 'title' }) });
  const csv = useMutation({
    mutationFn: () => analyticsApi.exportCsv('orders', range.from ? range : presetRange('90d')),
    onSuccess: (b) => saveBlob(b, `orders-${range.from ?? 'last-90-days'}.csv`),
    onError: (e) => toast.error(e.status === 422 ? 'Too much data for one file — choose a shorter period.' : e.message),
  });
  const filtered = Boolean(params.q || params.status || params.courseId || params.period);
  return (
    <>
      <PageHeader title="Orders" count={q.data?.meta?.total} description="An in-depth breakdown of every sale at your academy." breadcrumbs={[{ label: 'Orders' }]} />
      <RevenueSummary />
      <Card className="mt-6">
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchInput className="sm:flex-1" value={params.q ?? ''} onChange={(v) => update({ q: v })} placeholder="Search by email, name or order number" />
            <Button variant="secondary" leftIcon={Download} loading={csv.isPending} onClick={() => csv.mutate()}>CSV</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Filter by:</span>
            <FilterChip label="Course" value={params.courseId} onChange={(v) => update({ courseId: v })} options={(courses.data?.items ?? []).map((c) => ({ value: c.id, label: c.title }))} panelClassName="w-72" />
            <FilterChip label="Status" value={params.status} onChange={(v) => update({ status: v })} options={STATUS_FILTERS} />
            <FilterChip label="Time period" value={params.period} onChange={(v) => update({ period: v })} options={PERIODS} />
            {filtered && <button type="button" className="ml-1 text-sm font-medium text-primary-700 hover:underline dark:text-primary-300" onClick={() => update({ q: undefined, status: undefined, courseId: undefined, period: undefined })}>Reset</button>}
          </div>
        </div>
        {q.data && <p className="px-4 pt-3 text-sm text-muted">{formatNumber(q.data.meta.total)} order{q.data.meta.total === 1 ? '' : 's'}</p>}
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta} onPageChange={(page) => update({ page }, { resetPage: false })} onPageSizeChange={(pageSize) => update({ pageSize })} onRowClick={(r) => navigate(`/creator/orders/${r.id}`)}
          empty={filtered ? <EmptyState icon={ShoppingCart} title="No orders match" description="Try a different search or clear the filters." /> : <EmptyState icon={ShoppingCart} title="No orders yet" description={<>Orders appear when students buy a paid course. <Link className="text-primary-600 underline" to="/creator/payments">Connect Razorpay</Link> to start selling.</>} />}
          columns={[
            { key: 'createdAt', header: 'Payment date', cell: (r) => <TwoLineDate value={r.paidAt ?? r.createdAt} /> },
            { key: 'totalAmount', header: 'Amount', cell: (r) => <div><p className="font-medium text-fg tabular-nums">{formatMoney(r.totalAmount, r.currency)}</p>{r.couponCode && <p className="text-xs text-muted">Coupon {r.couponCode}</p>}</div> },
            { key: 'buyer', header: 'Student', cell: (r) => { const name = r.buyer?.fullName || r.billing?.name || r.buyer?.email || 'Unknown'; return <div className="flex items-center gap-2.5"><Avatar name={name} size="sm" /><div className="min-w-0"><p className="truncate font-medium text-fg">{name}</p><p className="truncate text-xs text-muted">{r.buyer?.email ?? r.billing?.email}</p></div></div>; } },
            { key: 'items', header: 'Item', cell: (r) => <div className="max-w-64"><p className="line-clamp-1 text-fg-2">{r.items?.map((i) => i.title).join(', ')}</p><p className="text-xs text-muted">{r.items?.[0] ? itemKind(r.items[0]) : ''}{r.items?.length > 1 ? ` +${r.items.length - 1} more` : ''}</p></div> },
            { key: 'status', header: 'Payment status', cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'number', header: 'Order', cell: (r) => <span className="font-mono text-xs text-muted">{r.number}</span> },
          ]} />
      </Card>
    </>
  );
}

export function TransactionsPage() {
  const [params, update] = useListParams();
  const q = useQuery({ queryKey: ['creator', 'transactions', params], queryFn: () => creatorCommerceApi.transactions(params), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Transactions" count={q.data?.meta?.total} description="Every payment attempt recorded with Razorpay, including failed ones." breadcrumbs={[{ label: 'Transactions' }]} />
      <Card>
        <ListToolbar count={q.data?.meta?.total} noun="transaction" filtered={Boolean(params.status)} onReset={() => update({ status: undefined })}
          filters={<FilterChip label="Payment status" value={params.status} onChange={(v) => update({ status: v })}
            options={[{ value: 'CAPTURED', label: 'Success' }, { value: 'CREATED', label: 'Initiated payment' }, { value: 'FAILED', label: 'Failed' }, { value: 'PARTIALLY_REFUNDED', label: 'Partially refunded' }, { value: 'REFUNDED', label: 'Refunded' }]} />} />
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta} onPageChange={(page) => update({ page }, { resetPage: false })} onPageSizeChange={(pageSize) => update({ pageSize })}
          empty={params.status ? <EmptyState icon={ReceiptText} title="No transactions match" description="Try another status." /> : <EmptyState icon={ReceiptText} title="No transactions yet" description="Payment attempts show here as soon as students start checking out." />}
          columns={[
            { key: 'createdAt', header: 'Payment date', cell: (r) => <TwoLineDate value={r.createdAt} /> },
            { key: 'amount', header: 'Amount', cell: (r) => <span className="font-medium text-fg tabular-nums">{formatMoney(r.amount, r.currency)}</span> },
            { key: 'orderNumber', header: 'Order', cell: (r) => <Link className="font-mono text-xs text-primary-600 hover:underline" to={`/creator/orders/${r.orderId}`}>{r.orderNumber}</Link> },
            { key: 'method', header: 'Method', cell: (r) => (r.method ? r.method.toUpperCase() : '—') },
            { key: 'feeAmount', header: 'Gateway fee', align: 'right', cell: (r) => (r.feeAmount ? formatMoney(r.feeAmount, r.currency) : '—') },
            { key: 'status', header: 'Payment status', cell: (r) => <div><StatusBadge status={r.status} />{r.failureReason && <p className="mt-1 max-w-56 text-xs text-muted">{r.failureReason}</p>}</div> },
            { key: 'providerPaymentId', header: 'Razorpay ID', cell: (r) => <span className="font-mono text-xs text-muted">{r.providerPaymentId ?? r.providerOrderId}</span> },
          ]} />
      </Card>
    </>
  );
}
