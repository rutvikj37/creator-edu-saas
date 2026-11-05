import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock, ShieldCheck, Tag, X } from 'lucide-react';
import { academyApi } from '../../services/api/auth.js';
import { catalogApi } from '../../services/api/learn.js';
import { checkoutApi } from '../../services/api/commerce.js';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Card, CardBody, CardHeader, ErrorState, Input, Skeleton, toast } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { applyApiErrors } from '../../utils/forms.js';
import { formatMoney } from '../../utils/format.js';
import { openRazorpay } from '../../utils/razorpay.js';
import { storedReferral } from '../../services/api/affiliates.js';
import { AcademyHeader } from '../public/AcademyLandingPage.jsx';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(120),
  phone: z.union([z.literal(''), z.string().trim().regex(/^\+?[0-9]{8,15}$/, 'Enter a valid phone number')]),
  state: z.string().trim().max(100).optional(),
  gstin: z.union([z.literal(''), z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN format')]),
});

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function CheckoutPage() {
  const { slug } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000 });
  const course = useQuery({ queryKey: ['catalog', slug], queryFn: () => catalogApi.course(slug), retry: false });
  const [coupon, setCoupon] = useState('');
  const [applied, setApplied] = useState(null);
  const [couponError, setCouponError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showGst, setShowGst] = useState(false);
  // One idempotency key per distinct checkout attempt; changes when the coupon changes.
  const attempt = useRef({ key: newKey(), orderId: null, coupon: null });
  const courseId = course.data?.id;
  const quote = useQuery({
    queryKey: ['checkout', 'quote', courseId, applied],
    queryFn: () => checkoutApi.quote({ courseId, couponCode: applied || undefined }),
    enabled: Boolean(courseId),
    retry: false,
  });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: auth.user?.fullName ?? '', phone: auth.user?.phone ?? '', state: '', gstin: '' } });

  const applyCoupon = async () => {
    const code = coupon.trim();
    if (!code) return;
    setCouponError(null);
    try {
      await checkoutApi.quote({ courseId, couponCode: code });
      setApplied(code.toUpperCase());
    } catch (e) {
      setCouponError(e.details?.[0]?.message ?? e.message);
    }
  };

  const pay = form.handleSubmit(async (v) => {
    setBusy(true);
    try {
      if (attempt.current.coupon !== applied) attempt.current = { key: newKey(), orderId: null, coupon: applied };
      let orderId = attempt.current.orderId;
      if (!orderId) {
        const order = await checkoutApi.checkout({ courseId, couponCode: applied || undefined, billing: { name: v.name, phone: v.phone || undefined, state: v.state || undefined, gstin: v.gstin || undefined }, affiliateCode: storedReferral() ?? undefined }, attempt.current.key);
        orderId = order.id;
        attempt.current.orderId = orderId;
        if (order.status === 'PAID') return navigate(`/learn/orders/${orderId}`, { replace: true });
      }
      const { checkout } = await checkoutApi.pay(orderId);
      const result = await openRazorpay(checkout, { color: site.data?.theme?.primaryColor });
      if (result.dismissed) {
        await checkoutApi.abandon(orderId, 'Checkout closed').catch(() => {});
        toast('Payment not completed', { description: 'You can try again whenever you are ready.' });
        return;
      }
      if (result.failed) {
        await checkoutApi.abandon(orderId, result.failed).catch(() => {});
        toast.error('Payment failed', { description: result.failed });
        return;
      }
      // Hand off to the order page; it confirms with the server and polls if needed.
      await checkoutApi.confirm(orderId, result).catch(() => {});
      navigate(`/learn/orders/${orderId}`, { replace: true });
    } catch (e) {
      if (e.code === 'CONFLICT' && /already have access/.test(e.message)) {
        toast.success('You already have access');
        return navigate(`/learn/courses/${courseId}`);
      }
      if (e.status === 409 && /expired/i.test(e.message)) attempt.current = { key: newKey(), orderId: null, coupon: applied };
      if (e.details?.[0]?.field === 'couponCode') setCouponError(e.details[0].message);
      else applyApiErrors(e, form.setError, ['name', 'phone', 'state', 'gstin']);
    } finally {
      setBusy(false);
    }
  });

  if (course.isError) return <div className="grid min-h-dvh place-items-center"><ErrorState title="Course not found" error={course.error} /></div>;
  const c = course.data;
  const qd = quote.data;
  const cur = qd?.currency ?? c?.currency;
  const m = (v) => formatMoney(v, cur);
  return (
    <div className="min-h-dvh bg-surface-2" style={{ fontFamily: site.data?.theme?.fontBody }}>
      <AcademyHeader site={site.data} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link to={`/courses/${slug}`} className="text-sm text-muted hover:text-fg">← Back to course</Link>
        <h1 className="mt-2 mb-6 text-2xl font-semibold">Checkout</h1>
        {!c || quote.isLoading ? <Skeleton className="h-80" /> : quote.isError ? (
          <Alert tone="error" title="This course can't be bought right now">{quote.error.message}</Alert>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <Card>
              <CardHeader title="Your details" description="Used for your receipt and invoice." />
              <CardBody>
                <form id="checkout" onSubmit={pay} className="space-y-4" noValidate>
                  <Input label="Full name" autoComplete="name" {...form.register('name')} error={form.formState.errors.name?.message} required />
                  <Input label="Email" value={auth.user?.email ?? ''} disabled hint="Receipts go to your account email." />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Phone" type="tel" autoComplete="tel" placeholder="+91…" {...form.register('phone')} error={form.formState.errors.phone?.message} hint="Optional — pre-fills Razorpay." />
                    <Input label="State" autoComplete="address-level1" {...form.register('state')} error={form.formState.errors.state?.message} />
                  </div>
                  {showGst ? (
                    <Input label="GSTIN" placeholder="22AAAAA0000A1Z5" {...form.register('gstin')} error={form.formState.errors.gstin?.message} hint="Shown on your invoice for input tax credit." />
                  ) : (
                    <Button variant="link" size="sm" onClick={() => setShowGst(true)}>Buying for a business? Add GSTIN</Button>
                  )}
                </form>
              </CardBody>
            </Card>
            <div className="space-y-4">
              <Card>
                <CardBody className="space-y-4">
                  <div>
                    <p className="text-xs font-medium tracking-wide text-muted uppercase">Course</p>
                    <p className="mt-1 font-semibold">{c.title}</p>
                  </div>
                  {applied ? (
                    <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
                      <span className="flex items-center gap-2"><Tag className="size-4" />{applied} applied</span>
                      <Button variant="ghost" size="icon-sm" aria-label="Remove coupon" onClick={() => { setApplied(null); setCoupon(''); }}><X className="size-4" /></Button>
                    </div>
                  ) : (
                    <div>
                      <div className="flex gap-2">
                        <Input aria-label="Coupon code" placeholder="Coupon code" className="uppercase" value={coupon} onChange={(e) => { setCoupon(e.target.value); setCouponError(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } }} />
                        <Button variant="secondary" onClick={applyCoupon} disabled={!coupon.trim()}>Apply</Button>
                      </div>
                      {couponError && <p role="alert" className="mt-1.5 text-xs text-red-600">{couponError}</p>}
                    </div>
                  )}
                  <dl className="space-y-2 border-t border-line pt-4 text-sm">
                    <div className="flex justify-between"><dt className="text-muted">Price</dt><dd className="tabular-nums">{m(qd.subtotal)}</dd></div>
                    {Number(qd.discount) > 0 && <div className="flex justify-between text-green-700"><dt>Discount</dt><dd className="tabular-nums">−{m(qd.discount)}</dd></div>}
                    {Number(qd.tax) > 0 && <div className="flex justify-between"><dt className="text-muted">GST {qd.taxRate}%{qd.taxInclusive ? ' (included)' : ''}</dt><dd className="tabular-nums">{m(qd.tax)}</dd></div>}
                    <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{m(qd.total)}</dd></div>
                  </dl>
                  {!qd.paymentsEnabled ? <Alert tone="info">Online checkout opens once this academy enables payments.</Alert> : (
                    <Button type="submit" form="checkout" size="lg" className="w-full" leftIcon={Lock} loading={busy} style={{ background: site.data?.theme?.primaryColor }}>
                      {Number(qd.total) === 0 ? 'Get access' : `Pay ${m(qd.total)}`}
                    </Button>
                  )}
                </CardBody>
              </Card>
              <p className="flex items-start gap-2 px-1 text-xs text-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0" />Payments are processed securely by Razorpay (UPI, cards, netbanking, wallets). We never see your card details.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
