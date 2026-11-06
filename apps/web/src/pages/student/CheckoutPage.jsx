import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock, ShieldCheck, Tag, X } from 'lucide-react';
import { academyApi } from '../../services/api/auth.js';
import { catalogApi } from '../../services/api/learn.js';
import { bundlesApi, checkoutApi, productsApi } from '../../services/api/commerce.js';
import { webinarApi } from '../../services/api/live.js';
import { useQueryClient } from '@tanstack/react-query';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Card, CardBody, CardHeader, ErrorState, Input, Skeleton, toast } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { applyApiErrors } from '../../utils/forms.js';
import { formatMoney } from '../../utils/format.js';
import { openRazorpay } from '../../utils/razorpay.js';
import { storedReferral } from '../../services/api/affiliates.js';
import { attribution, track } from '../../utils/tracker.js';
import { membershipsApi } from '../../services/api/community.js';
import { AcademyHeader } from '../public/AcademyLandingPage.jsx';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(120),
  phone: z.union([z.literal(''), z.string().trim().regex(/^\+?[0-9]{8,15}$/, 'Enter a valid phone number')]),
  state: z.string().trim().max(100).optional(),
  gstin: z.union([z.literal(''), z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN format')]),
});

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function CheckoutPage() {
  const { slug, planId, bundleSlug, webinarSlug, productSlug } = useParams();
  const isPlan = Boolean(planId);
  // What is being bought: a course, a membership plan, a bundle, a webinar ticket, or the whole cart (/cart/checkout).
  const mode = isPlan ? 'plan' : bundleSlug ? 'bundle' : webinarSlug ? 'webinar' : productSlug ? 'product' : slug ? 'course' : 'cart';
  const qc = useQueryClient();
  const auth = useAuth();
  const navigate = useNavigate();
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000 });
  // A checkout sells either a course (by slug) or a membership plan (by id).
  const course = useQuery({
    queryKey: ['checkout', 'product', mode, planId ?? bundleSlug ?? webinarSlug ?? productSlug ?? slug ?? 'cart'],
    queryFn: mode === 'plan'
      ? async () => {
          const p = (await membershipsApi.publicPlans()).find((x) => x.id === planId);
          if (!p) throw Object.assign(new Error('This membership is not available.'), { status: 404 });
          return { ...p, title: p.name, currency: p.currency };
        }
      : mode === 'bundle' ? () => bundlesApi.publicGet(bundleSlug)
      : mode === 'webinar' ? () => webinarApi.get(webinarSlug)
      : mode === 'product' ? () => productsApi.publicGet(productSlug)
      : mode === 'cart' ? async () => ({ id: 'cart', title: 'Your cart' })
      : () => catalogApi.course(slug),
    retry: false,
  });
  const [coupon, setCoupon] = useState('');
  const [applied, setApplied] = useState(null);
  const [couponError, setCouponError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showGst, setShowGst] = useState(false);
  // One idempotency key per distinct checkout attempt; changes when the coupon changes.
  const attempt = useRef({ key: newKey(), orderId: null, coupon: null });
  const courseId = mode === 'course' ? course.data?.id : undefined;
  const product = mode === 'plan' ? { membershipPlanId: planId } : mode === 'bundle' ? { bundleId: course.data?.id } : mode === 'webinar' ? { webinarId: course.data?.id } : mode === 'product' ? { digitalProductId: course.data?.id } : mode === 'cart' ? { fromCart: true } : { courseId };
  const quote = useQuery({
    queryKey: ['checkout', 'quote', mode, course.data?.id ?? planId, applied],
    queryFn: () => checkoutApi.quote({ ...product, couponCode: applied || undefined }),
    enabled: Boolean(course.data),
    retry: false,
  });
  useEffect(() => {
    if (!course.data) return;
    const kind = { plan: 'membership', bundle: 'bundle', webinar: 'webinar', product: 'product', course: 'course', cart: 'cart' }[mode];
    track('checkout_started', window.location.pathname, { kind, ...(mode === 'cart' ? {} : { id: mode === 'plan' ? planId : course.data.id }) });
  }, [course.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: auth.user?.fullName ?? '', phone: auth.user?.phone ?? '', state: '', gstin: '' } });

  const applyCoupon = async () => {
    const code = coupon.trim();
    if (!code) return;
    setCouponError(null);
    try {
      await checkoutApi.quote({ ...product, couponCode: code });
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
        const order = await checkoutApi.checkout({ ...product, couponCode: applied || undefined, billing: { name: v.name, phone: v.phone || undefined, state: v.state || undefined, gstin: v.gstin || undefined }, affiliateCode: storedReferral() ?? undefined, attribution: attribution() }, attempt.current.key);
        orderId = order.id;
        attempt.current.orderId = orderId;
        if (order.status === 'PAID') { qc.invalidateQueries({ queryKey: ['cart'] }); return navigate(`/learn/orders/${orderId}`, { replace: true }); }
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
      qc.invalidateQueries({ queryKey: ['cart'] });
      navigate(`/learn/orders/${orderId}`, { replace: true });
    } catch (e) {
      if (e.code === 'CONFLICT' && /already have access/.test(e.message)) {
        toast.success('You already have access');
        return navigate(mode === 'course' ? `/learn/courses/${courseId}` : '/learn');
      }
      if (e.status === 409 && /expired/i.test(e.message)) attempt.current = { key: newKey(), orderId: null, coupon: applied };
      if (e.details?.[0]?.field === 'couponCode') setCouponError(e.details[0].message);
      else applyApiErrors(e, form.setError, ['name', 'phone', 'state', 'gstin']);
    } finally {
      setBusy(false);
    }
  });

  const noun = { plan: 'membership', bundle: 'bundle', cart: 'cart', course: 'course', webinar: 'webinar', product: 'product' }[mode];
  if (course.isError) return <div className="grid min-h-dvh place-items-center"><ErrorState title={`${noun[0].toUpperCase()}${noun.slice(1)} not found`} error={course.error} /></div>;
  const c = course.data;
  const qd = quote.data;
  const cur = qd?.currency ?? c?.currency;
  const m = (v) => formatMoney(v, cur);
  return (
    <div className="min-h-dvh bg-surface-2" style={{ fontFamily: site.data?.theme?.fontBody }}>
      <AcademyHeader site={site.data} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link to={{ plan: '/memberships', bundle: `/bundles/${bundleSlug}`, cart: '/cart', course: `/courses/${slug}`, webinar: `/webinars/${webinarSlug}`, product: `/products/${productSlug}` }[mode]} className="text-sm text-muted hover:text-fg">← Back to {mode === 'plan' ? 'memberships' : noun}</Link>
        <h1 className="mt-2 mb-6 text-2xl font-semibold">Checkout</h1>
        {!c || quote.isLoading ? <Skeleton className="h-80" /> : quote.isError ? (
          <Alert tone="error" title={mode === 'cart' ? "Your cart can't be checked out right now" : `This ${noun} can't be bought right now`}>{quote.error.message}{mode === 'cart' && <> <Link to="/cart" className="underline">Review your cart</Link></>}</Alert>
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
                    <p className="text-xs font-medium tracking-wide text-muted uppercase">{mode === 'cart' ? `${qd.items?.length ?? 0} item${qd.items?.length === 1 ? '' : 's'}` : mode === 'bundle' ? `Bundle · ${c.courseCount} courses` : mode === 'plan' ? 'Membership' : mode === 'webinar' ? 'Webinar ticket' : mode === 'product' ? 'Digital download' : 'Course'}</p>
                    {mode === 'cart' ? (
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {(qd.items ?? []).map((i) => (
                          <li key={`${i.kind}${i.id}`} className="flex justify-between gap-3"><span className="min-w-0">{i.title}{Number(i.discount) > 0 && <span className="block text-xs text-green-700">−{m(i.discount)}</span>}</span><span className="shrink-0 tabular-nums">{m(i.unit)}</span></li>
                        ))}
                      </ul>
                    ) : <p className="mt-1 font-semibold">{c.title}</p>}
                    {isPlan && <p className="mt-1 text-xs text-muted">{c.courses?.length ?? 0} courses for one {c.interval === 'YEAR' ? 'year' : 'month'}. Paying again later extends your access; nothing renews automatically.</p>}
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
