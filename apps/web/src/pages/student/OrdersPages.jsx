import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Download, Gift, Receipt, XCircle } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, CardBody, DataTable, EmptyState, ErrorState, Skeleton, Spinner, StatusBadge, toast } from '../../components/ui/index.js';
import { ListToolbar, MetricCard } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { checkoutApi } from '../../services/api/commerce.js';
import { academyApi } from '../../services/api/auth.js';
import { adEvent, initAdTracking } from '../../utils/adTracking.js';
import { saveBlob } from '../../utils/download.js';
import { formatDate, formatMoney } from '../../utils/format.js';

const WAITING = ['PENDING', 'PAYMENT_INITIATED'];
const POLL_MS = 3000;
const POLL_FOR_MS = 3 * 60_000;
const PRIMARY_LINK = 'inline-flex h-9 items-center rounded-md bg-primary-600 px-4 text-sm font-medium text-on-primary shadow-xs hover:bg-primary-700';
const PURCHASE_EVENT_WINDOW_MS = 24 * 3600_000;

function useCountdown(until) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, new Date(until).getTime() - now) : null;
}

/** One-time offer right after a successful payment (configured under Sales → Upsells & bumps). */
function UpsellCard({ orderId }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['learn', 'order', orderId, 'upsell'], queryFn: () => checkoutApi.upsell(orderId), retry: false });
  const offer = q.data?.offer;
  const left = useCountdown(offer?.expiresAt);
  const decline = useMutation({
    mutationFn: () => checkoutApi.declineUpsell(orderId, offer.offerId),
    onSuccess: () => qc.setQueryData(['learn', 'order', orderId, 'upsell'], { offer: null }),
    onError: () => qc.setQueryData(['learn', 'order', orderId, 'upsell'], { offer: null }),
  });
  if (!offer || left === 0) return null;
  const mins = Math.floor(left / 60_000);
  const secs = Math.floor((left % 60_000) / 1000);
  return (
    <Card className="mt-4 border-2 border-dashed border-primary-400">
      <CardBody className="space-y-3 p-6">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-primary-700 uppercase dark:text-primary-300"><Gift className="size-4" />One-time offer · ends in {mins}:{String(secs).padStart(2, '0')}</p>
        <h2 className="text-lg font-semibold">{offer.headline}</h2>
        {offer.description && <p className="text-sm text-fg-2">{offer.description}</p>}
        <p className="text-sm">
          {offer.title} — <span className="font-semibold">{formatMoney(offer.price, offer.currency)}</span>
          {Number(offer.regularPrice) > Number(offer.price) && <span className="ml-1.5 text-muted line-through">{formatMoney(offer.regularPrice, offer.currency)}</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate(`/checkout/offer/${offer.offerId}?from=${orderId}`)}>Yes, add it</Button>
          <Button variant="ghost" loading={decline.isPending} onClick={() => decline.mutate()}>No thanks</Button>
        </div>
      </CardBody>
    </Card>
  );
}

function useInvoice(order) {
  return useMutation({
    mutationFn: () => checkoutApi.invoice(order.id),
    onSuccess: (blob) => saveBlob(blob, `${(order.invoiceNumber ?? order.number).replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`),
    onError: (e) => toast.error(e.message),
  });
}

/** Shown after Razorpay checkout. Polls until the server has confirmed the payment with Razorpay. */
export function OrderStatusPage() {
  const { id } = useParams();
  const [started] = useState(() => Date.now());
  const q = useQuery({
    queryKey: ['learn', 'order', id],
    queryFn: () => checkoutApi.order(id),
    refetchInterval: (query) => (WAITING.includes(query.state.data?.status) && Date.now() - started < POLL_FOR_MS ? POLL_MS : false),
  });
  const o = q.data;
  const invoice = useInvoice(o ?? { id });
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000 });
  useEffect(() => { initAdTracking(site.data?.tracking); }, [site.data?.tracking]);
  const isPaid = ['PAID', 'PARTIALLY_REFUNDED'].includes(o?.status);
  useEffect(() => {
    if (!isPaid || !o.paidAt || Date.now() - new Date(o.paidAt).getTime() > PURCHASE_EVENT_WINDOW_MS) return;
    adEvent('Purchase', {
      orderId: o.id, value: Number(o.totalAmount), currency: o.currency,
      items: o.items.map((i) => ({ id: i.courseId ?? i.bundleId ?? i.digitalProductId ?? i.liveClassId ?? i.membershipPlanId, title: i.title, unit: i.unitAmount, kind: i.bundleId ? 'bundle' : i.digitalProductId ? 'product' : i.liveClassId ? 'webinar' : i.membershipPlanId ? 'membership' : 'course' })),
    });
  }, [isPaid, o?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const courseId = o?.items?.[0]?.courseId;
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  if (!o) return <Skeleton className="h-64" />;
  const paid = ['PAID', 'PARTIALLY_REFUNDED'].includes(o.status);
  const waiting = WAITING.includes(o.status) && !o.failureReason;
  return (
    <div className="mx-auto max-w-xl py-6">
      <Card>
        <CardBody className="space-y-5 p-8 text-center">
          {paid ? <CheckCircle2 className="mx-auto size-12 text-green-600" /> : waiting ? <Spinner className="mx-auto size-10" /> : o.status === 'REFUNDED' ? <Receipt className="mx-auto size-12 text-muted" /> : <XCircle className="mx-auto size-12 text-red-500" />}
          <div>
            <h1 className="text-xl font-semibold">
              {paid ? (Number(o.totalAmount) === 0 ? 'You’re enrolled' : 'Payment successful') : waiting ? 'Confirming your payment…' : o.status === 'REFUNDED' ? 'Order refunded' : o.status === 'EXPIRED' ? 'Order expired' : 'Payment not completed'}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {paid ? `You now have access to ${o.items.map((i) => i.title).join(', ')}.` : waiting ? 'This usually takes a few seconds. You can safely leave this page — we will email you when it is done.' : o.failureReason ?? 'No money was taken for this order.'}
            </p>
          </div>
          <dl className="mx-auto max-w-xs space-y-1 text-left text-sm">
            <div className="flex justify-between"><dt className="text-muted">Order</dt><dd className="font-mono text-xs">{o.number}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Amount</dt><dd className="tabular-nums">{formatMoney(o.totalAmount, o.currency)}</dd></div>
            {o.paidAt && <div className="flex justify-between"><dt className="text-muted">Paid</dt><dd>{formatDate(o.paidAt, { withTime: true })}</dd></div>}
          </dl>
          <div className="flex flex-wrap justify-center gap-2">
            {paid && courseId && <Link className={PRIMARY_LINK} to={`/learn/courses/${courseId}`}>Start learning</Link>}
            {o.invoiceNumber && <Button variant="secondary" leftIcon={Download} loading={invoice.isPending} onClick={() => invoice.mutate()}>Invoice</Button>}
            {!paid && !waiting && o.status !== 'REFUNDED' && o.items[0]?.courseSlug && <Link className={PRIMARY_LINK} to={`/checkout/${o.items[0].courseSlug}`}>Try again</Link>}
          </div>
          {waiting && Date.now() - started > POLL_FOR_MS && <Alert tone="info">Still waiting for Razorpay. If money was deducted, access is granted automatically once Razorpay confirms — usually within a few minutes.</Alert>}
        </CardBody>
      </Card>
      {paid && <UpsellCard orderId={o.id} />}
      <p className="mt-4 text-center text-sm"><Link className="text-primary-600 hover:underline" to="/learn/orders">View all orders</Link></p>
    </div>
  );
}

const KIND = (i) => (i.bundleId ? 'Bundle' : i.digitalProductId ? 'Digital product' : i.liveClassId ? 'Webinar ticket' : i.membershipPlanId ? 'Membership' : i.coachingProgramId ? 'Coaching' : 'Course');
const PAID = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];

export function StudentOrdersPage() {
  const q = useQuery({ queryKey: ['learn', 'orders'], queryFn: checkoutApi.orders });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState();
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const rows = all.filter((r) => (!term || r.number.toLowerCase().includes(term) || r.items.some((i) => i.title.toLowerCase().includes(term)))
    && (!status || (status === 'PAID' ? PAID.includes(r.status) : status === 'WAITING' ? WAITING.includes(r.status) : !PAID.includes(r.status) && !WAITING.includes(r.status))));
  const spent = all.filter((r) => PAID.includes(r.status)).reduce((n, r) => n + Number(r.totalAmount) - Number(r.refundedAmount ?? 0), 0);
  return (
    <>
      <PageHeader title="Orders" count={q.data ? all.length : undefined} description="Your purchases and invoices." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <MetricCard label="Total spent" value={formatMoney(spent, all[0]?.currency ?? 'INR')} hint="Paid orders, after refunds" loading={q.isLoading} />
        <MetricCard label="Purchases" value={String(all.filter((r) => PAID.includes(r.status)).length)} hint="Including free enrolments" loading={q.isLoading} />
      </div>
      <Card>
        <ListToolbar search={search} onSearch={setSearch} placeholder="Search by course or order number" count={rows.length} noun="order"
          filtered={Boolean(term || status)} onReset={() => { setSearch(''); setStatus(undefined); }}
          filters={<FilterChip label="Status" value={status} onChange={setStatus} options={[{ value: 'PAID', label: 'Paid' }, { value: 'WAITING', label: 'Awaiting payment' }, { value: 'OTHER', label: 'Failed or expired' }]} />} />
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={rows}
          empty={all.length ? <EmptyState icon={Receipt} title="No orders match" description="Try a different search or filter." /> : <EmptyState icon={Receipt} title="No orders yet" description="Courses you buy appear here with their invoices." action={<Link className="text-sm text-primary-600 underline" to="/courses">Browse courses</Link>} />}
          columns={[
            { key: 'createdAt', header: 'Date', cell: (r) => <div className="leading-tight"><p className="text-fg-2">{formatDate(r.paidAt ?? r.createdAt)}</p><Link className="font-mono text-xs text-primary-600 hover:underline" to={`/learn/orders/${r.id}`}>{r.number}</Link></div> },
            { key: 'items', header: 'Item', cell: (r) => <div className="max-w-72"><p className="line-clamp-1 text-fg">{r.items.map((i) => i.title).join(', ')}</p><p className="text-xs text-muted">{Number(r.totalAmount) === 0 ? 'FREE' : 'Paid'} | {r.items[0] ? KIND(r.items[0]) : ''}{r.items.length > 1 ? ` +${r.items.length - 1}` : ''}</p></div> },
            { key: 'totalAmount', header: 'Amount', cell: (r) => <span className="font-medium tabular-nums">{formatMoney(r.totalAmount, r.currency)}</span> },
            { key: 'status', header: 'Status', cell: (r) => (WAITING.includes(r.status) ? <Link to={`/learn/orders/${r.id}`} className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline"><Clock className="size-3.5" />Complete payment</Link> : r.status === 'PAID' ? <Badge tone="success">Success</Badge> : <StatusBadge status={r.status} />) },
            { key: 'invoice', header: '', align: 'right', cell: (r) => (PAID.includes(r.status) && Number(r.totalAmount) > 0 ? <InvoiceButton order={r} /> : null) },
          ]} />
      </Card>
    </>
  );
}

function InvoiceButton({ order }) {
  const invoice = useInvoice(order);
  return <Button variant="ghost" size="sm" leftIcon={Download} loading={invoice.isPending} onClick={() => invoice.mutate()}>Invoice</Button>;
}
