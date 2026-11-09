import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Gift, Lock, ShieldCheck, Tag, X } from 'lucide-react';
import { academyApi } from '../../services/api/auth.js';
import { catalogApi } from '../../services/api/learn.js';
import { bundlesApi, checkoutApi, productsApi } from '../../services/api/commerce.js';
import { coachingApi } from '../../services/api/coaching.js';
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
import { adEvent } from '../../utils/adTracking.js';
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
  const { slug, planId, bundleSlug, webinarSlug, productSlug, coachingSlug, linkCode, offerId } = useParams();
  const [search] = useSearchParams();
  const sourceOrderId = search.get('from');
  const isPlan = Boolean(planId);
  // What is being bought: a course, a membership plan, a bundle, a webinar ticket, a payment link, a post-purchase upsell, or the whole cart (/cart/checkout).
  const mode = isPlan ? 'plan' : bundleSlug ? 'bundle' : webinarSlug ? 'webinar' : productSlug ? 'product' : coachingSlug ? 'coaching' : linkCode ? 'link' : offerId ? 'offer' : slug ? 'course' : 'cart';
  const qc = useQueryClient();
  const auth = useAuth();
  const navigate = useNavigate();
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000 });
  // A checkout sells either a course (by slug) or a membership plan (by id).
  const course = useQuery({
    queryKey: ['checkout', 'product', mode, planId ?? bundleSlug ?? webinarSlug ?? productSlug ?? coachingSlug ?? linkCode ?? offerId ?? slug ?? 'cart'],
    queryFn: mode === 'plan'
      ? async () => {
          const p = (await membershipsApi.publicPlans()).find((x) => x.id === planId);
          if (!p) throw Object.assign(new Error('This membership is not available.'), { status: 404 });
          return { ...p, title: p.name, currency: p.currency };
        }
      : mode === 'bundle' ? () => bundlesApi.publicGet(bundleSlug)
      : mode === 'webinar' ? () => webinarApi.get(webinarSlug)
      : mode === 'product' ? () => productsApi.publicGet(productSlug)
      : mode === 'coaching' ? () => coachingApi.publicGet(coachingSlug)
      : mode === 'cart' ? async () => ({ id: 'cart', title: 'Your cart' })
      : mode === 'link' ? async () => { const l = await checkoutApi.paymentLink(linkCode); return { ...l, id: l.code }; }
      : mode === 'offer' ? async () => ({ id: offerId, title: 'Special offer' })
      : () => catalogApi.course(slug),
    retry: false,
  });
  const [coupon, setCoupon] = useState('');
  const [applied, setApplied] = useState(null);
  const [couponError, setCouponError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showGst, setShowGst] = useState(false);
  const [bumpIds, setBumpIds] = useState([]);
  // One idempotency key per distinct checkout attempt; changes when the coupon or the chosen add-ons change.
  const attempt = useRef({ key: newKey(), orderId: null, signature: null });
  const courseId = mode === 'course' ? course.data?.id : undefined;
  const base = mode === 'plan' ? { membershipPlanId: planId } : mode === 'bundle' ? { bundleId: course.data?.id } : mode === 'webinar' ? { webinarId: course.data?.id } : mode === 'product' ? { digitalProductId: course.data?.id } : mode === 'coaching' ? { coachingProgramId: course.data?.id }
    : mode === 'link' ? { paymentLinkCode: linkCode } : mode === 'offer' ? { upsellOfferId: offerId, sourceOrderId: sourceOrderId ?? undefined } : mode === 'cart' ? { fromCart: true } : { courseId };
  const product = { ...base, ...(bumpIds.length ? { bumpOfferIds: bumpIds } : {}) };
  const quote = useQuery({
    queryKey: ['checkout', 'quote', mode, course.data?.id ?? planId, applied, bumpIds],
    queryFn: () => checkoutApi.quote({ ...product, couponCode: applied || undefined }),
    enabled: Boolean(course.data),
    retry: false,
    placeholderData: (p) => p,
  });
  const couponsAllowed = mode !== 'offer' && !quote.data?.paymentLink?.couponLocked;
  const offers = useQuery({ queryKey: ['checkout', 'offers', courseId ?? mode], queryFn: () => checkoutApi.offers(courseId), enabled: Boolean(course.data) && !['plan', 'link', 'offer'].includes(mode), retry: false });
  useEffect(() => {
    if (!course.data) return;
    const kind = { plan: 'membership', bundle: 'bundle', webinar: 'webinar', product: 'product', coaching: 'coaching', course: 'course', cart: 'cart', link: course.data.kind, offer: 'offer' }[mode];
    track('checkout_started', window.location.pathname, { kind, ...(mode === 'cart' ? {} : { id: mode === 'plan' ? planId : mode === 'link' ? course.data.itemId : course.data.id }) });
  }, [course.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const startedAd = useRef(false);
  useEffect(() => {
    if (!quote.data || startedAd.current) return;
    startedAd.current = true;
    adEvent('InitiateCheckout', { value: Number(quote.data.total), currency: quote.data.currency, items: quote.data.items });
  }, [quote.data]);
  // Recovery emails and shared links can carry ?coupon=CODE: apply it once.
  const prefilled = useRef(false);
  useEffect(() => {
    const code = search.get('coupon');
    if (!quote.data || prefilled.current || !code) return;
    prefilled.current = true;
    if (couponsAllowed && !applied) applyCoupon(code);
  }, [quote.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: auth.user?.fullName ?? '', phone: auth.user?.phone ?? '', state: '', gstin: '' } });

  const applyCoupon = async (picked) => {
    const code = (typeof picked === 'string' ? picked : coupon).trim();
    if (!code) return;
    if (typeof picked === 'string') setCoupon(code);
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
      const signature = `${applied ?? ''}|${bumpIds.join(',')}`;
      if (attempt.current.signature !== signature) attempt.current = { key: newKey(), orderId: null, signature };
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
      if (e.status === 409 && /expired/i.test(e.message)) attempt.current = { key: newKey(), orderId: null, signature: null };
      if (e.details?.[0]?.field === 'bumpOfferIds') { setBumpIds([]); toast.error(e.details[0].message); return; }
      if (e.details?.[0]?.field === 'couponCode') setCouponError(e.details[0].message);
      else applyApiErrors(e, form.setError, ['name', 'phone', 'state', 'gstin']);
    } finally {
      setBusy(false);
    }
  });

  const noun = { plan: 'membership', bundle: 'bundle', cart: 'cart', course: 'course', webinar: 'webinar', product: 'product', coaching: 'coaching program', link: 'payment link', offer: 'offer' }[mode];
  if (course.isError) return <div className="grid min-h-dvh place-items-center"><ErrorState title={`${noun[0].toUpperCase()}${noun.slice(1)} not found`} error={course.error} /></div>;
  const c = course.data;
  const qd = quote.data;
  const cur = qd?.currency ?? c?.currency;
  const m = (v) => formatMoney(v, cur);
  const mainItems = (qd?.items ?? []).filter((i) => i.source !== 'BUMP');
  const bumpItems = (qd?.items ?? []).filter((i) => i.source === 'BUMP');
  const title = mode === 'link' ? c?.itemTitle : mode === 'offer' ? mainItems[0]?.title : c?.title;
  const toggleBump = (id, on) => setBumpIds((ids) => (on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)));
  const back = { plan: '/memberships', bundle: `/bundles/${bundleSlug}`, cart: '/cart', course: `/courses/${slug}`, webinar: `/webinars/${webinarSlug}`, product: `/products/${productSlug}`, coaching: `/coaching/${coachingSlug}`, link: `/pay/${linkCode}`, offer: sourceOrderId ? `/learn/orders/${sourceOrderId}` : '/learn/orders' }[mode];
  return (
    <div className="min-h-dvh bg-surface-2" style={{ fontFamily: site.data?.theme?.fontBody }}>
      <AcademyHeader site={site.data} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link to={back} className="text-sm text-muted hover:text-fg">← Back to {mode === 'plan' ? 'memberships' : mode === 'offer' ? 'your order' : noun}</Link>
        <h1 className="mt-2 mb-6 text-2xl font-semibold">Checkout</h1>
        {mode === 'link' && c?.title && <p className="-mt-4 mb-6 text-sm text-muted">{c.title}{c.note && <span className="mt-1 block text-fg-2">{c.note}</span>}</p>}
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
                  {site.data?.gstInputCredit === false ? null : showGst ? (
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
                    <p className="text-xs font-medium tracking-wide text-muted uppercase">{mode === 'cart' ? `${mainItems.length} item${mainItems.length === 1 ? '' : 's'}` : mode === 'offer' ? 'One-time offer' : mode === 'bundle' ? `Bundle · ${c.courseCount} courses` : mode === 'plan' ? 'Membership' : mode === 'webinar' ? 'Webinar ticket' : mode === 'product' ? 'Digital download' : mode === 'link' ? ({ course: 'Course', bundle: 'Bundle', product: 'Digital download', webinar: 'Webinar ticket', membership: 'Membership' }[c.kind] ?? 'Purchase') : 'Course'}</p>
                    {mode === 'cart' ? (
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {mainItems.map((i) => (
                          <li key={`${i.kind}${i.id}`} className="flex justify-between gap-3"><span className="min-w-0">{i.title}{Number(i.discount) > 0 && <span className="block text-xs text-green-700">−{m(i.discount)}</span>}</span><span className="shrink-0 tabular-nums">{m(i.unit)}</span></li>
                        ))}
                      </ul>
                    ) : <p className="mt-1 font-semibold">{title}</p>}
                    {bumpItems.length > 0 && (
                      <ul className="mt-2 space-y-1.5 border-t border-dashed border-line pt-2 text-sm">
                        {bumpItems.map((i) => <li key={i.offerId} className="flex justify-between gap-3"><span className="min-w-0">+ {i.title}</span><span className="shrink-0 tabular-nums">{m(i.unit)}</span></li>)}
                      </ul>
                    )}
                    {isPlan && <p className="mt-1 text-xs text-muted">{c.courses?.length ?? 0} courses for one {c.interval === 'YEAR' ? 'year' : 'month'}. Paying again later extends your access; nothing renews automatically.</p>}
                  </div>
                  {qd.bumps?.length > 0 && (
                    <div className="space-y-2">
                      {qd.bumps.map((b) => {
                        const on = bumpIds.includes(b.offerId);
                        return (
                          <label key={b.offerId} className={`flex cursor-pointer gap-3 rounded-lg border-2 border-dashed p-3 text-sm ${on ? 'border-primary-500 bg-primary-50/60 dark:bg-primary-500/10' : 'border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/30'}`}>
                            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary-600" checked={on} disabled={quote.isFetching} onChange={(e) => toggleBump(b.offerId, e.target.checked)} />
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5 font-semibold text-fg"><Gift className="size-4 shrink-0 text-primary-600" aria-hidden />{b.headline}</span>
                              <span className="mt-0.5 block text-xs text-fg-2">{b.title} — <span className="font-semibold">{m(b.price)}</span>{Number(b.regularPrice) > Number(b.price) && <span className="ml-1 text-muted line-through">{m(b.regularPrice)}</span>}</span>
                              {b.description && <span className="mt-1 block text-xs text-muted">{b.description}</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {!couponsAllowed ? (
                    qd.couponCode ? <p className="flex items-center gap-2 text-sm text-green-700"><Tag className="size-4" />{qd.couponCode} included with this link</p> : null
                  ) : !applied && qd.couponCode ? (
                    <p className="flex items-center gap-2 text-sm text-green-700"><Tag className="size-4" />{qd.couponCode} included with this link</p>
                  ) : applied ? (
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
                      {offers.data?.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs font-medium tracking-wide text-muted uppercase">Available offers</p>
                          {offers.data.map((o) => (
                            <div key={o.code} className="flex items-center justify-between gap-3 rounded-md border border-dashed border-primary-300 bg-primary-50/50 px-3 py-2 text-sm dark:border-primary-500/40 dark:bg-primary-500/10">
                              <span><span className="font-mono font-semibold text-fg">{o.code}</span><span className="block text-xs text-muted">{o.type === 'PERCENT' ? `${Number(o.value)}% off${o.maxDiscountAmount ? `, up to ${formatMoney(o.maxDiscountAmount, 'INR')}` : ''}` : `${formatMoney(o.value, 'INR')} off`}{o.minOrderAmount ? ` · min ${formatMoney(o.minOrderAmount, 'INR')}` : ''}</span></span>
                              <Button size="sm" variant="ghost" onClick={() => applyCoupon(o.code)}>Apply</Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <dl className="space-y-2 border-t border-line pt-4 text-sm">
                    <div className="flex justify-between"><dt className="text-muted">Price</dt><dd className="tabular-nums">{m(qd.subtotal)}</dd></div>
                    {Number(qd.discount) > 0 && <div className="flex justify-between text-green-700"><dt>Discount</dt><dd className="tabular-nums">−{m(qd.discount)}</dd></div>}
                    {Number(qd.tax) > 0 && <div className="flex justify-between"><dt className="text-muted">GST {qd.taxRate}%{qd.taxInclusive ? ' (included)' : ''}</dt><dd className="tabular-nums">{m(qd.tax)}</dd></div>}
                    {Number(qd.transactionFee) > 0 && <div className="flex justify-between"><dt className="text-muted">Transaction fee</dt><dd className="tabular-nums">{m(qd.transactionFee)}</dd></div>}
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
