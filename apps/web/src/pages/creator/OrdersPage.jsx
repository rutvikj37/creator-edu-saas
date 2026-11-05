import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Banknote, IndianRupee, Percent, ReceiptText, RotateCcw, ShoppingCart } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Card, DataTable, EmptyState, Select, StatCard, StatusBadge } from '../../components/ui/index.js';
import { creatorCommerceApi } from '../../services/api/commerce.js';
import { useListParams } from '../../hooks/useListParams.js';
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
        <StatCard label="Gross sales" value={m(t?.gross)} hint={`${formatNumber(s.data?.paidOrders ?? 0)} paid orders`} icon={IndianRupee} loading={s.isLoading} />
        <StatCard label="Refunds" value={m(t?.refunds)} hint={s.data?.refundsPending ? `${s.data.refundsPending} pending` : undefined} icon={RotateCcw} loading={s.isLoading} />
        <StatCard label="GST · fees · commission" value={m((Number(t?.tax ?? 0) + Number(t?.gatewayFees ?? 0) + Number(t?.platformCommission ?? 0)).toFixed(2))} hint={t ? `GST ${m(t.tax)} · Razorpay ${m(t.gatewayFees)} · Platform ${m(t.platformCommission)}` : undefined} icon={Percent} loading={s.isLoading} />
        <StatCard label="Net earnings" value={m(t?.net)} icon={Banknote} loading={s.isLoading} />
      </div>
      {s.data && s.data.totals.length > 1 && <Alert tone="info" className="mt-3">Sales in other currencies: {s.data.totals.slice(1).map((x) => `${formatMoney(x.net, x.currency)} net`).join(' · ')}</Alert>}
    </>
  );
}

export function OrdersPage() {
  const [params, update] = useListParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['creator', 'orders', params], queryFn: () => creatorCommerceApi.orders(params), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Orders" description="Every purchase at your academy, confirmed with Razorpay." breadcrumbs={[{ label: 'Sales' }, { label: 'Orders' }]} />
      <RevenueSummary />
      <Card className="mt-6">
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row">
          <SearchInput className="sm:w-80" value={params.q ?? ''} onChange={(v) => update({ q: v })} placeholder="Order number, name or email" />
          <Select aria-label="Status" className="sm:w-52" options={ORDER_STATUS_OPTIONS} value={params.status ?? ''} onChange={(e) => update({ status: e.target.value || undefined })} />
        </div>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta} onPageChange={(page) => update({ page }, { resetPage: false })} onRowClick={(r) => navigate(`/creator/orders/${r.id}`)}
          empty={<EmptyState icon={ShoppingCart} title="No orders yet" description={<>Orders appear when students buy a paid course. <Link className="text-primary-600 underline" to="/creator/payments">Connect Razorpay</Link> to start selling.</>} />}
          columns={[
            { key: 'number', header: 'Order', cell: (r) => <div><p className="font-mono text-xs font-medium text-fg">{r.number}</p><p className="text-xs text-muted">{formatDate(r.createdAt, { withTime: true })}</p></div> },
            { key: 'buyer', header: 'Student', cell: (r) => <div><p className="font-medium text-fg">{r.buyer?.fullName ?? r.billing?.name}</p><p className="text-xs text-muted">{r.buyer?.email ?? r.billing?.email}</p></div> },
            { key: 'items', header: 'Course', cell: (r) => <span className="line-clamp-1">{r.items?.map((i) => i.title).join(', ')}</span> },
            { key: 'totalAmount', header: 'Amount', align: 'right', cell: (r) => <div><p className="tabular-nums">{formatMoney(r.totalAmount, r.currency)}</p>{r.couponCode && <p className="text-xs text-muted">{r.couponCode}</p>}</div> },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
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
      <PageHeader title="Transactions" description="Payment attempts recorded with Razorpay, including failed ones." breadcrumbs={[{ label: 'Sales' }, { label: 'Transactions' }]} />
      <Card>
        <div className="border-b border-line p-4">
          <Select aria-label="Status" className="sm:w-52" value={params.status ?? ''} onChange={(e) => update({ status: e.target.value || undefined })}
            options={[{ value: '', label: 'All' }, { value: 'CAPTURED', label: 'Captured' }, { value: 'CREATED', label: 'Started' }, { value: 'FAILED', label: 'Failed' }, { value: 'PARTIALLY_REFUNDED', label: 'Partially refunded' }, { value: 'REFUNDED', label: 'Refunded' }]} />
        </div>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta} onPageChange={(page) => update({ page }, { resetPage: false })}
          empty={<EmptyState icon={ReceiptText} title="No transactions yet" />}
          columns={[
            { key: 'createdAt', header: 'Date', cell: (r) => formatDate(r.createdAt, { withTime: true }) },
            { key: 'orderNumber', header: 'Order', cell: (r) => <Link className="font-mono text-xs text-primary-600 hover:underline" to={`/creator/orders/${r.orderId}`}>{r.orderNumber}</Link> },
            { key: 'providerPaymentId', header: 'Razorpay ID', cell: (r) => <span className="font-mono text-xs">{r.providerPaymentId ?? r.providerOrderId}</span> },
            { key: 'method', header: 'Method', cell: (r) => (r.method ? r.method.toUpperCase() : '—') },
            { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <span className="tabular-nums">{formatMoney(r.amount, r.currency)}</span> },
            { key: 'feeAmount', header: 'Fee', align: 'right', cell: (r) => (r.feeAmount ? formatMoney(r.feeAmount, r.currency) : '—') },
            { key: 'status', header: 'Status', cell: (r) => <div><StatusBadge status={r.status} />{r.failureReason && <p className="mt-1 max-w-56 text-xs text-muted">{r.failureReason}</p>}</div> },
          ]} />
      </Card>
    </>
  );
}
