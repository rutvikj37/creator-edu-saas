import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Download, Receipt, XCircle } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Card, CardBody, DataTable, EmptyState, ErrorState, Skeleton, Spinner, StatusBadge, toast } from '../../components/ui/index.js';
import { checkoutApi } from '../../services/api/commerce.js';
import { saveBlob } from '../../utils/download.js';
import { formatDate, formatMoney } from '../../utils/format.js';

const WAITING = ['PENDING', 'PAYMENT_INITIATED'];
const POLL_MS = 3000;
const POLL_FOR_MS = 3 * 60_000;
const PRIMARY_LINK = 'inline-flex h-9 items-center rounded-md bg-primary-600 px-4 text-sm font-medium text-on-primary shadow-xs hover:bg-primary-700';

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
      <p className="mt-4 text-center text-sm"><Link className="text-primary-600 hover:underline" to="/learn/orders">View all orders</Link></p>
    </div>
  );
}

export function StudentOrdersPage() {
  const q = useQuery({ queryKey: ['learn', 'orders'], queryFn: checkoutApi.orders });
  return (
    <>
      <PageHeader title="Orders" description="Your purchases and invoices." breadcrumbs={[{ label: 'Orders' }]} />
      <Card>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data ?? []}
          empty={<EmptyState icon={Receipt} title="No orders yet" description="Courses you buy appear here with their invoices." action={<Link className="text-sm text-primary-600 underline" to="/courses">Browse courses</Link>} />}
          columns={[
            { key: 'number', header: 'Order', cell: (r) => <Link className="font-mono text-xs text-primary-600 hover:underline" to={`/learn/orders/${r.id}`}>{r.number}</Link> },
            { key: 'items', header: 'Course', cell: (r) => r.items.map((i) => i.title).join(', ') },
            { key: 'createdAt', header: 'Date', cell: (r) => formatDate(r.createdAt) },
            { key: 'totalAmount', header: 'Amount', align: 'right', cell: (r) => <span className="tabular-nums">{formatMoney(r.totalAmount, r.currency)}</span> },
            { key: 'status', header: 'Status', cell: (r) => (WAITING.includes(r.status) ? <span className="inline-flex items-center gap-1 text-xs text-muted"><Clock className="size-3.5" />Awaiting payment</span> : <StatusBadge status={r.status} />) },
            { key: 'invoice', header: '', align: 'right', cell: (r) => (['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(r.status) ? <InvoiceButton order={r} /> : null) },
          ]} />
      </Card>
    </>
  );
}

function InvoiceButton({ order }) {
  const invoice = useInvoice(order);
  return <Button variant="ghost" size="sm" leftIcon={Download} loading={invoice.isPending} onClick={() => invoice.mutate()}>Invoice</Button>;
}
