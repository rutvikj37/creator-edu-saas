import { useState } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Download, RotateCcw } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Card, CardBody, CardHeader, Checkbox, ErrorState, Input, Modal, Skeleton, StatusBadge, Textarea, toast } from '../../components/ui/index.js';
import { creatorCommerceApi } from '../../services/api/commerce.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { applyApiErrors } from '../../utils/forms.js';
import { saveBlob } from '../../utils/download.js';
import { formatDate, formatMoney } from '../../utils/format.js';

const LEDGER_LABELS = { SALE: 'Sale', TAX: 'GST', GATEWAY_FEE: 'Razorpay fee', PLATFORM_COMMISSION: 'Platform commission', REFUND: 'Refund', TAX_REVERSAL: 'GST reversal', COMMISSION_REVERSAL: 'Commission reversal' };

function RefundDialog({ order, open, onClose }) {
  const qc = useQueryClient();
  const reserved = order.refunds.filter((r) => r.status !== 'FAILED').reduce((s, r) => s + Number(r.amount), 0);
  const max = Math.round((Number(order.totalAmount) - reserved) * 100) / 100;
  const schema = z.object({
    amount: z.coerce.number({ message: 'Enter an amount' }).positive('Enter an amount above zero').max(max, `At most ${formatMoney(max, order.currency)}`),
    reason: z.string().trim().max(500).optional(),
    revokeAccess: z.boolean(),
  });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { amount: max, reason: '', revokeAccess: false } });
  const amount = Number(form.watch('amount'));
  const full = amount === max && reserved === 0;
  const submit = form.handleSubmit(async (v) => {
    try {
      const out = await creatorCommerceApi.refund(order.id, { amount: v.amount, reason: v.reason || undefined, revokeAccess: full && v.revokeAccess });
      qc.setQueryData(['creator', 'order', order.id], out);
      qc.invalidateQueries({ queryKey: ['creator', 'orders'] });
      const latest = out.refunds[0];
      toast.success(latest?.status === 'PROCESSED' ? 'Refund processed' : 'Refund requested — Razorpay will confirm shortly');
      onClose();
    } catch (e) {
      applyApiErrors(e, form.setError, ['amount']);
    }
  });
  return (
    <Modal open={open} onClose={onClose} title={`Refund ${order.number}`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-fg-2">The money goes back to the student's original payment method through Razorpay. Refunds can't be undone.</p>
        <Input label={`Amount (${order.currency})`} type="number" step="0.01" min="0.01" max={max} {...form.register('amount')} error={form.formState.errors.amount?.message} hint={`Refundable: ${formatMoney(max, order.currency)}`} />
        <Textarea label="Reason (shared with Razorpay)" rows={2} {...form.register('reason')} error={form.formState.errors.reason?.message} />
        <Checkbox label="Also remove course access" disabled={!full} {...form.register('revokeAccess')} />
        {!full && <p className="-mt-2 text-xs text-muted">Access can only be removed with a full refund.</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" loading={form.formState.isSubmitting}>Refund {Number.isFinite(amount) && amount > 0 ? formatMoney(amount, order.currency) : ''}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function OrderDetailPage() {
  const { id } = useParams();
  const auth = useAuth();
  const [refundOpen, setRefundOpen] = useState(false);
  const q = useQuery({ queryKey: ['creator', 'order', id], queryFn: () => creatorCommerceApi.order(id) });
  const invoice = useMutation({ mutationFn: () => creatorCommerceApi.invoice(id), onSuccess: (blob) => saveBlob(blob, `${o.invoiceNumber.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`), onError: (e) => toast.error(e.message) });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const o = q.data;
  if (!o) return <Skeleton className="h-96" />;
  const m = (v) => formatMoney(v, o.currency);
  const canRefund = auth.can('refunds.manage') && ['PAID', 'PARTIALLY_REFUNDED'].includes(o.status) && o.payments.some((p) => ['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status));
  return (
    <>
      <PageHeader title={`Order ${o.number}`} description={`Placed ${formatDate(o.createdAt, { withTime: true })}`} breadcrumbs={[{ label: 'Sales' }, { label: 'Orders', to: '/creator/orders' }, { label: o.number }]}
        actions={<div className="flex gap-2">
          {o.invoiceNumber && <Button variant="secondary" leftIcon={Download} loading={invoice.isPending} onClick={() => invoice.mutate()}>Invoice</Button>}
          {canRefund && <Button variant="secondary" leftIcon={RotateCcw} onClick={() => setRefundOpen(true)}>Refund</Button>}
        </div>} />
      {o.failureReason && !['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(o.status) && <Alert tone="warning" className="mb-4">{o.failureReason}</Alert>}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Summary" actions={<StatusBadge status={o.status} />} />
            <CardBody className="space-y-2 text-sm">
              {o.items.map((i) => <div key={i.id} className="flex justify-between gap-4"><span>{i.title}</span><span className="tabular-nums">{m(i.unitAmount)}</span></div>)}
              {Number(o.discountAmount) > 0 && <div className="flex justify-between text-muted"><span>Coupon {o.couponCode}</span><span className="tabular-nums">−{m(o.discountAmount)}</span></div>}
              {Number(o.taxAmount) > 0 && <div className="flex justify-between text-muted"><span>GST {Number(o.taxRate)}%{o.taxInclusive ? ' (included)' : ''}</span><span className="tabular-nums">{m(o.taxAmount)}</span></div>}
              <div className="flex justify-between border-t border-line pt-2 font-semibold"><span>Total</span><span className="tabular-nums">{m(o.totalAmount)}</span></div>
              {Number(o.refundedAmount) > 0 && <div className="flex justify-between text-red-600"><span>Refunded</span><span className="tabular-nums">−{m(o.refundedAmount)}</span></div>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Payments" description="Each attempt opens a separate Razorpay order." />
            <CardBody className="divide-y divide-line p-0">
              {o.payments.length === 0 && <p className="p-5 text-sm text-muted">{Number(o.totalAmount) === 0 ? 'Free order (100% coupon) — no payment needed.' : 'No payment attempt yet.'}</p>}
              {o.payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <div><p className="font-mono text-xs">{p.providerPaymentId ?? p.providerOrderId}</p><p className="text-xs text-muted">{formatDate(p.createdAt, { withTime: true })}{p.method ? ` · ${p.method.toUpperCase()}` : ''}{p.feeAmount ? ` · fee ${m(p.feeAmount)}` : ''}</p>{p.failureReason && <p className="text-xs text-red-600">{p.failureReason}</p>}</div>
                  <StatusBadge status={p.status} />
                </div>
              ))}
            </CardBody>
          </Card>
          {o.refunds.length > 0 && (
            <Card>
              <CardHeader title="Refunds" />
              <CardBody className="divide-y divide-line p-0">
                {o.refunds.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <div><p className="font-medium tabular-nums">{m(r.amount)}{r.revokeAccess && <span className="ml-2 text-xs font-normal text-muted">access removed</span>}</p><p className="text-xs text-muted">{formatDate(r.createdAt, { withTime: true })}{r.reason ? ` · ${r.reason}` : ''}</p>{r.failureReason && <p className="text-xs text-red-600">{r.failureReason}</p>}</div>
                    <StatusBadge status={r.status} />
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Student" />
            <CardBody className="space-y-1 text-sm">
              <p className="font-medium">{o.buyer?.fullName ?? o.billing.name}</p>
              <p className="text-muted">{o.billing.email}</p>
              {o.billing.phone && <p className="text-muted">{o.billing.phone}</p>}
              {o.billing.state && <p className="text-muted">{o.billing.state}</p>}
              {o.billing.gstin && <p className="text-muted">GSTIN {o.billing.gstin}</p>}
            </CardBody>
          </Card>
          {o.ledger.length > 0 && (
            <Card>
              <CardHeader title="Ledger" description="How this order affects your earnings." />
              <CardBody className="space-y-1.5 text-sm">
                {o.ledger.map((l, i) => <div key={i} className="flex justify-between"><span className="text-fg-2">{LEDGER_LABELS[l.type] ?? l.type}</span><span className={`tabular-nums ${Number(l.amount) < 0 ? 'text-red-600' : ''}`}>{m(l.amount)}</span></div>)}
                <div className="flex justify-between border-t border-line pt-2 font-semibold"><span>Net</span><span className="tabular-nums">{m(o.ledger.reduce((s, l) => s + Number(l.amount), 0).toFixed(2))}</span></div>
              </CardBody>
            </Card>
          )}
          {o.invoiceNumber && <p className="px-1 text-xs text-muted">Invoice {o.invoiceNumber}</p>}
        </div>
      </div>
      {canRefund && <RefundDialog key={o.refunds.length} order={o} open={refundOpen} onClose={() => setRefundOpen(false)} />}
    </>
  );
}
