import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Info, MoreHorizontal, Pencil, Plus, ReceiptText, RotateCcw, ShoppingCart } from 'lucide-react';
import { INDIAN_STATES } from '../../utils/indianStates.js';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { ListToolbar, MetricCard } from '../../components/common/ListToolbar.jsx';
import { presetRange } from '../../components/common/DateRangeFilter.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Avatar, Badge, Button, Card, DataTable, Drawer, Dropdown, DropdownItem, EmptyState, Input, Modal, Select, Skeleton, StatusBadge, toast } from '../../components/ui/index.js';
import { bundlesApi, creatorCommerceApi, productsApi } from '../../services/api/commerce.js';
import { membershipsApi } from '../../services/api/community.js';
import { coachingApi } from '../../services/api/coaching.js';
import { creatorLearnApi } from '../../services/api/learn.js';
import { affiliatesApi } from '../../services/api/affiliates.js';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { cn } from '../../utils/cn.js';
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

const CHANNEL = { RAZORPAY: 'Razorpay', CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', UPI: 'UPI (direct)', CHEQUE: 'Cheque', OTHER: 'Offline' };
const TYPES = [{ value: 'course', label: 'Course' }, { value: 'bundle', label: 'Bundle' }, { value: 'membership', label: 'Membership' }, { value: 'webinar', label: 'Webinar ticket' }, { value: 'product', label: 'Digital product' }, { value: 'coaching', label: 'Coaching' }];
const STATUS_LABEL = { PAID: 'Success', PAYMENT_INITIATED: 'Initiated payment', PENDING: 'Initiated payment', FAILED: 'Failed', REFUNDED: 'Refunded', PARTIALLY_REFUNDED: 'Partially refunded', EXPIRED: 'Expired' };

/** Transactions (Graphy style): every order with channel, type and period filters, plus offline payments. */
export function TransactionsPage() {
  const [params, update] = useListParams();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);
  const range = params.period ? presetRange(params.period) : {};
  const query = { q: params.q, status: params.status, courseId: params.courseId, channel: params.channel, type: params.type, ...range, page: params.page, pageSize: params.pageSize };
  const q = useQuery({ queryKey: ['creator', 'orders', query], queryFn: () => creatorCommerceApi.orders(query), placeholderData: (p) => p });
  const s = useQuery({ queryKey: ['creator', 'orders', 'summary', range], queryFn: () => creatorCommerceApi.summary(range) });
  const courses = useQuery({ queryKey: ['creator', 'courses', 'picker'], queryFn: () => coursesApi.list({ pageSize: 100, sort: 'title' }) });
  const csv = useMutation({
    mutationFn: () => analyticsApi.exportCsv('orders', range.from ? range : presetRange('90d')),
    onSuccess: (b) => saveBlob(b, `orders-${range.from ?? 'last-90-days'}.csv`),
    onError: (e) => toast.error(e.status === 422 ? 'Too much data for one file — choose a shorter period.' : e.message),
  });
  const invoice = useMutation({ mutationFn: (o) => creatorCommerceApi.invoice(o.id).then((b) => saveBlob(b, `${o.number}.pdf`)), onError: (e) => toast.error(e.message) });
  const t = s.data?.totals?.[0];
  const filtered = Boolean(params.q || params.status || params.courseId || params.channel || params.type || params.period);
  return (
    <>
      <PageHeader title="Transactions" count={q.data?.meta?.total} description="Get an in-depth breakdown of each sale." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <MetricCard label="Total revenue" value={formatMoney(t?.gross ?? 0, t?.currency ?? 'INR')} hint={`${formatNumber(s.data?.paidOrders ?? 0)} paid orders${params.period ? ' in this period' : ''}`} loading={s.isLoading} />
        <MetricCard label="Total refunds" value={formatMoney(t?.refunds ?? 0, t?.currency ?? 'INR')} hint={s.data?.refundsPending ? `${s.data.refundsPending} pending` : 'No refunds pending'} loading={s.isLoading} />
      </div>
      <Card>
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchInput className="sm:flex-1" value={params.q ?? ''} onChange={(v) => update({ q: v })} placeholder="Search by email, name, order number, transaction ID or promo code" />
            <Button variant="ghost" leftIcon={Download} loading={csv.isPending} onClick={() => csv.mutate()}>CSV</Button>
            <Button variant="secondary" leftIcon={Plus} onClick={() => setAdding(true)}>Add a transaction</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Filter by:</span>
            <FilterChip label="Products" value={params.courseId} onChange={(v) => update({ courseId: v })} options={(courses.data?.items ?? []).map((c) => ({ value: c.id, label: c.title }))} panelClassName="w-72" />
            <FilterChip label="Channel" value={params.channel} onChange={(v) => update({ channel: v })} options={[{ value: 'razorpay', label: 'Razorpay' }, { value: 'offline', label: 'Offline' }, { value: 'free', label: 'Free' }]} />
            <FilterChip label="Status" value={params.status} onChange={(v) => update({ status: v })} options={STATUS_FILTERS} />
            <FilterChip label="Type" value={params.type} onChange={(v) => update({ type: v })} options={TYPES} />
            <FilterChip label="Time period" value={params.period} onChange={(v) => update({ period: v })} options={PERIODS} />
            {filtered && <button type="button" className="ml-1 text-sm font-medium text-primary-700 hover:underline dark:text-primary-300" onClick={() => update({ q: undefined, status: undefined, courseId: undefined, channel: undefined, type: undefined, period: undefined })}>Reset</button>}
          </div>
        </div>
        {q.data && <p className="px-4 pt-3 text-sm text-muted">{formatNumber(q.data.meta.total)} transaction{q.data.meta.total === 1 ? '' : 's'}</p>}
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta} onPageChange={(page) => update({ page }, { resetPage: false })} onPageSizeChange={(pageSize) => update({ pageSize })}
          empty={filtered ? <EmptyState icon={ReceiptText} title="No transactions match" description="Try a different search or clear the filters." /> : <EmptyState icon={ReceiptText} title="No transactions yet" description="Sales and free enrolments through checkout appear here. Record offline payments with Add a transaction." />}
          columns={[
            { key: 'createdAt', header: 'Payment date', cell: (r) => <TwoLineDate value={r.paidAt ?? r.createdAt} /> },
            { key: 'totalAmount', header: 'Amount', cell: (r) => <span className="font-medium text-fg tabular-nums">{formatMoney(r.totalAmount, r.currency)}</span> },
            { key: 'buyer', header: 'User', cell: (r) => { const name = r.buyer?.fullName || r.billing?.name || r.buyer?.email || 'Unknown'; return <div className="flex items-center gap-2"><Avatar name={name} size="sm" /><div className="min-w-0"><p className="truncate text-fg">{name}</p><p className="truncate text-xs text-muted">{r.buyer?.email ?? r.billing?.email}</p></div></div>; } },
            { key: 'items', header: 'Item', cell: (r) => <div className="max-w-64"><p className="line-clamp-1 text-fg-2">{r.items?.map((i) => i.title).join(', ')}</p><p className="text-xs text-muted">{Number(r.totalAmount) === 0 ? 'FREE' : CHANNEL[r.paymentMode] ?? 'Online'} | {r.items?.[0] ? itemKind(r.items[0]) : ''}</p></div> },
            { key: 'status', header: 'Payment status', cell: (r) => r.status === 'PAID' ? <Badge tone="success">Success</Badge> : <StatusBadge status={r.status} label={STATUS_LABEL[r.status]} /> },
            { key: 'ref', header: 'Reference', cell: (r) => <span className="font-mono text-xs text-muted">{r.externalReference ?? r.number}</span> },
            {
              key: 'actions', header: '', align: 'right', cell: (r) => (
                <Dropdown trigger={(p) => <button type="button" {...p} aria-label={`Actions for ${r.number}`} className="grid size-8 place-items-center rounded-md text-fg-2 hover:bg-surface-2"><MoreHorizontal className="size-4" aria-hidden /></button>}>
                  <DropdownItem icon={Info} onClick={() => setOpen(r.id)}>More information</DropdownItem>
                  {['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(r.status) && <DropdownItem icon={Download} onClick={() => invoice.mutate(r)}>Download invoice</DropdownItem>}
                </Dropdown>
              ),
            },
          ]} />
      </Card>
      <AddTransactionModal open={adding} onClose={() => setAdding(false)} />
      <TransactionDrawer orderId={open} onClose={() => setOpen(null)} onOpenFull={(id) => navigate(`/creator/orders/${id}`)} />
    </>
  );
}

/** Transaction details: key info, internal comments, Refund and Edit order. */
function TransactionDrawer({ orderId, onClose, onOpenFull }) {
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const o = useQuery({ queryKey: ['creator', 'order', orderId], queryFn: () => creatorCommerceApi.order(orderId), enabled: Boolean(orderId) });
  const c = useQuery({ queryKey: ['creator', 'order', orderId, 'comments'], queryFn: () => creatorCommerceApi.comments(orderId), enabled: Boolean(orderId) });
  const add = useMutation({ mutationFn: () => creatorCommerceApi.addComment(orderId, comment), onSuccess: (d) => { qc.setQueryData(['creator', 'order', orderId, 'comments'], d); setComment(''); }, onError: (e) => toast.error(e.message) });
  const d = o.data;
  const txn = d?.externalReference ?? d?.payments?.find((p) => p.providerPaymentId)?.providerPaymentId ?? null;
  const row = (k, v) => <div className="grid grid-cols-[9rem_1fr] gap-2 py-1.5 text-sm"><dt className="text-muted">{k}</dt><dd className="break-all text-fg">{v ?? 'NA'}</dd></div>;
  const refundable = d && d.provider === 'RAZORPAY' && ['PAID', 'PARTIALLY_REFUNDED'].includes(d.status);
  return (
    <Drawer open={Boolean(orderId)} onClose={() => { setAll(false); onClose(); }} title="Transaction details">
      {!d ? <Skeleton className="m-5 h-40" /> : (
        <div className="flex h-full flex-col">
          <div className="flex-1 space-y-6 overflow-y-auto p-5">
            <section>
              <h3 className="mb-2 font-semibold">Info</h3>
              <dl>
                {row('Transaction ID', txn)}{row('User email', d.buyer?.email ?? d.billing?.email)}{row('User phone', d.buyer?.phone ?? d.billing?.phone)}{row('Amount', formatMoney(d.totalAmount, d.currency))}
                {all && <>{row('Order', d.number)}{row('Status', STATUS_LABEL[d.status] ?? d.status)}{row('Channel', Number(d.totalAmount) === 0 ? 'Free' : CHANNEL[d.paymentMode] ?? 'Online')}{row('Item', d.items?.map((i) => i.title).join(', '))}{row('Promo code', d.couponCode)}{row('GST', d.taxAmount && Number(d.taxAmount) ? `${formatMoney(d.taxAmount, d.currency)} (${d.taxRate}%)` : null)}{row('State', d.billing?.state)}{row('GSTIN', d.billing?.gstin)}{row('Invoice', d.invoiceNumber)}{row('Paid at', d.paidAt ? formatDate(d.paidAt, { withTime: true }) : null)}</>}
              </dl>
              <div className="mt-1 flex gap-4"><button type="button" className="text-sm font-medium text-primary-700 dark:text-primary-300" onClick={() => setAll((x) => !x)}>{all ? 'Show less' : 'See all info'}</button><button type="button" className="text-sm text-muted hover:text-fg" onClick={() => onOpenFull(d.id)}>Open full order</button></div>
            </section>
            <section className="border-t border-line pt-5">
              <h3 className="mb-3 font-semibold">Comments</h3>
              <ul className="mb-3 space-y-3">{(c.data ?? []).map((x) => <li key={x.id} className="rounded-lg bg-surface-2/70 p-3 text-sm"><p className="whitespace-pre-line">{x.body}</p><p className="mt-1 text-xs text-muted">{x.author} · {formatDate(x.createdAt, { withTime: true })}</p></li>)}</ul>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) add.mutate(); }}>
                <Input className="flex-1" aria-label="Add comment" placeholder="Add comment…" maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
                <Button type="submit" disabled={!comment.trim()} loading={add.isPending}>Add</Button>
              </form>
              <p className="mt-1 text-xs text-muted">Only your team sees comments.</p>
            </section>
          </div>
          <div className="grid grid-cols-2 border-t border-line">
            <button type="button" disabled={!refundable} title={refundable ? undefined : 'Only paid Razorpay orders can be refunded'} onClick={() => onOpenFull(d.id)} className="flex flex-col items-center gap-1 py-3 text-sm text-fg-2 hover:bg-surface-2 disabled:opacity-40"><RotateCcw className="size-4" aria-hidden />Refund</button>
            <button type="button" onClick={() => setEditing(true)} className="flex flex-col items-center gap-1 border-l border-line py-3 text-sm text-fg-2 hover:bg-surface-2"><Pencil className="size-4" aria-hidden />Edit order</button>
          </div>
        </div>
      )}
      {d && <EditOrderModal order={d} open={editing} onClose={() => setEditing(false)} />}
    </Drawer>
  );
}

function EditOrderModal({ order, open, onClose }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ affiliateCode: '', state: '', gstin: '', gstAddress: '' });
  const [errors, setErrors] = useState({});
  useEffect(() => { if (open) { setF({ affiliateCode: '', state: order.billing?.state ?? '', gstin: order.billing?.gstin ?? '', gstAddress: order.billing?.address ?? '' }); setErrors({}); } }, [open, order]);
  const save = useMutation({
    mutationFn: () => creatorCommerceApi.editOrder(order.id, { state: f.state || null, gstin: f.gstin.trim() || null, gstAddress: f.gstAddress.trim() || null, ...(f.affiliateCode.trim() ? { affiliateCode: f.affiliateCode.trim() } : {}) }),
    onSuccess: (d) => { qc.setQueryData(['creator', 'order', order.id], d); qc.invalidateQueries({ queryKey: ['creator', 'orders'] }); toast.success('Order updated'); onClose(); },
    onError: (e) => { setErrors(Object.fromEntries((e.details ?? []).map((x) => [x.field, x.message]))); toast.error(e.details?.[0]?.message ?? e.message); },
  });
  return (
    <Modal open={open} onClose={onClose} title="Edit order" footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>}>
      <div className="space-y-4">
        {!order.affiliateId && ['PAID', 'PARTIALLY_REFUNDED'].includes(order.status) && <Input label="Affiliate code" placeholder="Credit an affiliate for this sale" maxLength={32} value={f.affiliateCode} error={errors.affiliateCode} onChange={(e) => setF({ ...f, affiliateCode: e.target.value })} />}
        <Select label="State" placeholder="Select state" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} options={INDIAN_STATES.map((x) => ({ value: x, label: x }))} />
        <Input label="GST number" placeholder="22AAAAA0000A1Z5" value={f.gstin} error={errors.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
        <Input label="GST address" maxLength={300} value={f.gstAddress} onChange={(e) => setF({ ...f, gstAddress: e.target.value })} />
        <p className="text-xs text-muted">Changes also update the buyer details on the invoice.</p>
      </div>
    </Modal>
  );
}

const PICKERS = {
  course: { label: 'Course', load: () => coursesApi.list({ pageSize: 100, sort: 'title' }).then((r) => r.items.filter((c) => c.status === 'PUBLISHED' && !c.isFree)) },
  bundle: { label: 'Bundle', load: () => bundlesApi.list().then((r) => r.filter((b) => b.status === 'PUBLISHED')) },
  membership: { label: 'Membership', load: () => membershipsApi.plans().then((r) => r.filter((p) => p.status === 'ACTIVE').map((p) => ({ ...p, title: p.name }))) },
  product: { label: 'Digital product', load: () => productsApi.list().then((r) => r.filter((p) => p.status === 'PUBLISHED' && !p.isFree && Number(p.priceAmount) > 0)) },
  coaching: { label: 'Coaching program', load: () => coachingApi.programs().then((r) => r.filter((p) => p.status === 'PUBLISHED' && !p.isFree)) },
};

/** Record a payment received outside checkout and give the learner access. */
export function AddTransactionModal({ open, onClose }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ kind: 'course', itemId: '', itemTerm: '', learner: null, learnerTerm: '', mode: 'CASH', reference: '', amount: '', sendEmail: true, affiliate: null, affiliateTerm: '' });
  const [errors, setErrors] = useState({});
  useEffect(() => { if (open) { setF({ kind: 'course', itemId: '', itemTerm: '', learner: null, learnerTerm: '', mode: 'CASH', reference: '', amount: '', sendEmail: true, affiliate: null, affiliateTerm: '' }); setErrors({}); } }, [open]);
  const items = useQuery({ queryKey: ['offline', 'items', f.kind], queryFn: PICKERS[f.kind].load, enabled: open });
  const debounced = useDebouncedValue(f.learnerTerm.trim(), 300);
  const learners = useQuery({ queryKey: ['offline', 'learners', debounced], queryFn: () => creatorLearnApi.students({ q: debounced, pageSize: 8 }), enabled: open && debounced.length >= 2 && !f.learner });
  const affiliates = useQuery({ queryKey: ['offline', 'affiliates'], queryFn: () => affiliatesApi.list().catch(() => []), enabled: open });
  const aTerm = f.affiliateTerm.trim().toLowerCase();
  const shownAffiliates = aTerm.length < 2 || f.affiliate ? [] : (affiliates.data ?? []).filter((a) => a.status === 'ACTIVE' && a.userId !== f.learner?.id && [a.code, a.user?.fullName, a.user?.email].some((v) => v?.toLowerCase().includes(aTerm))).slice(0, 8);
  const shownItems = (items.data ?? []).filter((i) => i.title.toLowerCase().includes(f.itemTerm.trim().toLowerCase())).slice(0, 50);
  const save = useMutation({
    mutationFn: () => creatorCommerceApi.recordOffline({ itemKind: f.kind, itemId: f.itemId, userId: f.learner.id, mode: f.mode, reference: f.reference.trim() || null, amount: Number(f.amount), sendEmail: f.sendEmail, ...(f.affiliate ? { affiliateCode: f.affiliate.code } : {}) }),
    onSuccess: (o) => { toast.success(`Recorded ${o.number}`, { description: 'The learner now has access.' }); qc.invalidateQueries({ queryKey: ['creator', 'orders'] }); onClose(); },
    onError: (e) => { setErrors(Object.fromEntries((e.details ?? []).map((x) => [x.field, x.message]))); toast.error(e.details?.[0]?.message ?? e.message); },
  });
  const ready = f.itemId && f.learner && f.reference.trim() && Number(f.amount) >= 1;
  return (
    <Modal open={open} onClose={onClose} title="Add a transaction" size="lg" description="Record a payment you received outside checkout. The learner gets access right away."
      footer={<Button disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>Add a transaction</Button>}>
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-sm font-medium text-fg">Products *</p>
          <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
            <Select aria-label="Product type" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, itemId: '', itemTerm: '' })} options={Object.entries(PICKERS).map(([v, p]) => ({ value: v, label: p.label }))} />
            <Input aria-label="Search products" placeholder="Search by title" value={f.itemTerm} onChange={(e) => setF({ ...f, itemTerm: e.target.value })} />
          </div>
          <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-line" role="listbox" aria-label="Products">
            {items.isLoading ? <Skeleton className="m-2 h-16" /> : !shownItems.length ? <p className="p-3 text-sm text-muted">No paid, published {PICKERS[f.kind].label.toLowerCase()}s found.</p> : shownItems.map((i) => (
              <button key={i.id} type="button" role="option" aria-selected={f.itemId === i.id} onClick={() => setF({ ...f, itemId: i.id, amount: f.amount || String(Number(i.priceAmount) || '') })}
                className={cn('flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2', f.itemId === i.id && 'bg-primary-50 font-medium dark:bg-primary-500/10')}>
                <span className="truncate">{i.title}</span>{i.priceAmount && <span className="shrink-0 text-xs text-muted">{formatMoney(i.priceAmount, i.currency ?? 'INR')}</span>}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-fg">Learner *</p>
          {f.learner ? (
            <div className="flex items-center gap-2 rounded-md border border-line p-2"><Avatar name={f.learner.fullName} size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{f.learner.fullName}</p><p className="truncate text-xs text-muted">{f.learner.email}</p></div><Button size="sm" variant="ghost" onClick={() => setF({ ...f, learner: null })}>Change</Button></div>
          ) : <>
            <Input aria-label="Search learners" placeholder="Search by name, email or mobile number" value={f.learnerTerm} error={errors.userId} onChange={(e) => setF({ ...f, learnerTerm: e.target.value })} />
            {(learners.data?.items ?? []).length > 0 && <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-line" role="listbox" aria-label="Learners">{learners.data.items.map((u) => (
              <li key={u.id}><button type="button" role="option" aria-selected={false} onClick={() => setF({ ...f, learner: u })} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"><Avatar name={u.fullName} size="sm" /><span className="truncate">{u.fullName} · <span className="text-muted">{u.email}</span></span></button></li>
            ))}</ul>}
            <p className="mt-1 text-xs text-muted">Not signed up yet? Add them first under Students.</p>
          </>}
        </div>
        <Input label="Transaction ID *" placeholder="UTR, cheque number or receipt number" maxLength={191} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Payment mode *" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} options={[{ value: 'CASH', label: 'Cash' }, { value: 'BANK_TRANSFER', label: 'Bank transfer' }, { value: 'UPI', label: 'UPI (direct)' }, { value: 'CHEQUE', label: 'Cheque' }, { value: 'OTHER', label: 'Other' }]} />
          <Input label="Amount *" type="number" min={1} step="0.01" placeholder="Amount received" value={f.amount} error={errors.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-fg">Affiliate</p>
          {f.affiliate ? (
            <div className="flex items-center gap-2 rounded-md border border-line p-2"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{f.affiliate.user?.fullName ?? f.affiliate.code}</p><p className="text-xs text-muted">Code {f.affiliate.code} · {f.affiliate.commissionPercent}% commission</p></div><Button size="sm" variant="ghost" onClick={() => setF({ ...f, affiliate: null })}>Remove</Button></div>
          ) : <>
            <Input aria-label="Search affiliates" placeholder="Search by name, email or code (optional)" value={f.affiliateTerm} error={errors.affiliateCode} onChange={(e) => setF({ ...f, affiliateTerm: e.target.value })} />
            {shownAffiliates.length > 0 && <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-line" role="listbox" aria-label="Affiliates">{shownAffiliates.map((a) => (
              <li key={a.id}><button type="button" role="option" aria-selected={false} onClick={() => setF({ ...f, affiliate: a })} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"><span className="truncate">{a.user?.fullName ?? 'Affiliate'} · <span className="text-muted">{a.user?.email}</span></span><span className="shrink-0 font-mono text-xs text-muted">{a.code}</span></button></li>
            ))}</ul>}
          </>}
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-fg">Send the learner a receipt email</legend>
          <div className="flex gap-6 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="send-email" checked={f.sendEmail} onChange={() => setF({ ...f, sendEmail: true })} />Yes</label>
            <label className="flex items-center gap-2"><input type="radio" name="send-email" checked={!f.sendEmail} onChange={() => setF({ ...f, sendEmail: false })} />No</label>
          </div>
        </fieldset>
        <p className="text-xs text-muted">GST and your plan’s commission apply as for online sales. Offline payments can’t be refunded through Razorpay.</p>
      </div>
    </Modal>
  );
}
