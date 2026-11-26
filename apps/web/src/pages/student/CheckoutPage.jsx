import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Gift, Lock, Mail, Tag, X } from 'lucide-react';
import { academyApi, authApi } from '../../services/api/auth.js';
import { catalogApi, learnApi } from '../../services/api/learn.js';
import { bundlesApi, checkoutApi, productsApi } from '../../services/api/commerce.js';
import { coachingApi } from '../../services/api/coaching.js';
import { webinarApi } from '../../services/api/live.js';
import { useQueryClient } from '@tanstack/react-query';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, ErrorState, Input, Skeleton, toast } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { applyApiErrors } from '../../utils/forms.js';
import { formatMoney } from '../../utils/format.js';
import { openRazorpay } from '../../utils/razorpay.js';
import { storedReferral } from '../../services/api/affiliates.js';
import { attribution, track } from '../../utils/tracker.js';
import { adEvent } from '../../utils/adTracking.js';
import { membershipsApi } from '../../services/api/community.js';

/** Place of supply for GST invoices. */
const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
const DIAL_CODES = [['+91', '🇮🇳'], ['+1', '🇺🇸'], ['+44', '🇬🇧'], ['+971', '🇦🇪'], ['+61', '🇦🇺'], ['+65', '🇸🇬'], ['+977', '🇳🇵']];

/** Guests also give an email and phone: their account is created from these details. */
const makeSchema = (guest) => z.object({
  name: z.string().trim().min(2, 'Enter your name').max(120),
  email: guest ? z.string().trim().toLowerCase().email('Enter a valid email address').max(191) : z.string().optional(),
  dial: z.string(),
  phone: guest
    ? z.string().trim().regex(/^[0-9]{6,14}$/, 'Enter a valid phone number')
    : z.union([z.literal(''), z.string().trim().regex(/^\+?[0-9]{8,15}$/, 'Enter a valid phone number')]),
  password: z.string().optional(),
  state: z.string().trim().max(100).optional(),
  gstin: z.union([z.literal(''), z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN format')]),
});

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
/** Splits a saved "+919812345678" into the country-code picker and the local number. */
const splitPhone = (phone) => {
  const hit = phone && DIAL_CODES.map(([c]) => c).sort((x, y) => y.length - x.length).find((c) => phone.startsWith(c));
  return hit ? { dial: hit, phone: phone.slice(hit.length) } : { dial: '+91', phone: phone ?? '' };
};
const fullPhone = (dial, phone) => (!phone ? '' : phone.startsWith('+') ? phone : `${dial}${phone.replace(/^0+/, '')}`);

function Card({ title, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-5 shadow-sm ${className}`}>
      {title && <h2 className="mb-4 text-sm font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function CheckoutPage() {
  const { slug, planId, bundleSlug, webinarSlug, productSlug, coachingSlug, linkCode, offerId } = useParams();
  const [search] = useSearchParams();
  const location = useLocation();
  const sourceOrderId = search.get('from');
  const isPlan = Boolean(planId);
  // What is being bought: a course, a membership plan, a bundle, a webinar ticket, a payment link, a post-purchase upsell, or the whole cart (/cart/checkout).
  const mode = isPlan ? 'plan' : bundleSlug ? 'bundle' : webinarSlug ? 'webinar' : productSlug ? 'product' : coachingSlug ? 'coaching' : linkCode ? 'link' : offerId ? 'offer' : slug ? 'course' : 'cart';
  const qc = useQueryClient();
  const auth = useAuth();
  const navigate = useNavigate();
  // Not signed in: the buyer checks out as a guest and their account is created from the form.
  const guest = auth.status === 'anonymous';
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000 });
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
  const [showMore, setShowMore] = useState(false);
  const [bumpIds, setBumpIds] = useState([]);
  // The email at a guest checkout already has an account: ask for its password instead of creating one.
  const [needLogin, setNeedLogin] = useState(false);
  // One idempotency key per distinct checkout attempt; changes when the coupon or the chosen add-ons change.
  const attempt = useRef({ key: newKey(), orderId: null, signature: null });
  const freeCourse = mode === 'course' && Boolean(course.data?.isFree);
  const courseId = mode === 'course' ? course.data?.id : undefined;
  const base = mode === 'plan' ? { membershipPlanId: planId } : mode === 'bundle' ? { bundleId: course.data?.id } : mode === 'webinar' ? { webinarId: course.data?.id } : mode === 'product' ? { digitalProductId: course.data?.id } : mode === 'coaching' ? { coachingProgramId: course.data?.id }
    : mode === 'link' ? { paymentLinkCode: linkCode } : mode === 'offer' ? { upsellOfferId: offerId, sourceOrderId: sourceOrderId ?? undefined } : mode === 'cart' ? { fromCart: true } : { courseId };
  const product = { ...base, ...(bumpIds.length ? { bumpOfferIds: bumpIds } : {}) };
  const quoteFn = guest ? checkoutApi.guestQuote : checkoutApi.quote;
  const quote = useQuery({
    queryKey: ['checkout', 'quote', guest, mode, course.data?.id ?? planId, applied, bumpIds],
    queryFn: () => quoteFn({ ...product, couponCode: applied || undefined }),
    enabled: Boolean(course.data) && !freeCourse && auth.status !== 'loading',
    retry: false,
    placeholderData: (p) => p,
  });
  const couponsAllowed = mode !== 'offer' && !quote.data?.paymentLink?.couponLocked;
  const offers = useQuery({
    queryKey: ['checkout', 'offers', guest, courseId ?? mode],
    queryFn: () => (guest ? checkoutApi.guestOffers : checkoutApi.offers)(courseId),
    enabled: Boolean(course.data) && !freeCourse && auth.status !== 'loading' && !['plan', 'link', 'offer'].includes(mode),
    retry: false,
  });
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
  const schema = useMemo(() => makeSchema(guest), [guest]);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: auth.user?.fullName ?? '', email: '', ...splitPhone(auth.user?.phone), password: '', state: '', gstin: '' } });
  useEffect(() => {
    if (auth.user && !form.getValues('name')) form.setValue('name', auth.user.fullName ?? '');
    if (auth.user?.phone && !form.getValues('phone')) { const p = splitPhone(auth.user.phone); form.setValue('dial', p.dial); form.setValue('phone', p.phone); }
  }, [auth.user]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyCoupon = async (picked) => {
    const code = (typeof picked === 'string' ? picked : coupon).trim();
    if (!code) return;
    if (typeof picked === 'string') setCoupon(code);
    setCouponError(null);
    try {
      await quoteFn({ ...product, couponCode: code });
      setApplied(code.toUpperCase());
    } catch (e) {
      setCouponError(e.details?.[0]?.message ?? e.message);
    }
  };

  /**
   * Guest checkout: signs the buyer in before the order is created. A new email gets an account
   * (the password is emailed once they have access); a known email must enter its password.
   * Returns false when the buyer still has to do something (enter the password).
   */
  const signIn = async (v) => {
    if (!guest) return { ok: true, created: false };
    if (needLogin) {
      if (!v.password) { form.setError('password', { message: 'Enter your password' }); return { ok: false }; }
      const r = await authApi.login({ email: v.email, password: v.password });
      if (r.mfaRequired) { navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`); return { ok: false }; }
      await auth.establish(r);
      return { ok: true, created: false };
    }
    const r = await authApi.checkoutAccount({ fullName: v.name, email: v.email, phone: fullPhone(v.dial, v.phone) || undefined });
    if (r.accountExists) {
      setNeedLogin(true);
      return { ok: false };
    }
    await auth.establish(r);
    return { ok: true, created: true };
  };

  const pay = form.handleSubmit(async (v) => {
    setBusy(true);
    try {
      const who = await signIn(v);
      if (!who.ok) return;
      const emailNote = who.created ? { description: `We’ve emailed your login details to ${v.email}.` } : undefined;
      if (freeCourse) {
        await learnApi.enroll(courseId);
        toast.success('You’re enrolled!', emailNote);
        return navigate(`/learn/courses/${courseId}`, { replace: true });
      }
      const phone = fullPhone(v.dial, v.phone);
      const signature = `${applied ?? ''}|${bumpIds.join(',')}`;
      if (attempt.current.signature !== signature) attempt.current = { key: newKey(), orderId: null, signature };
      let orderId = attempt.current.orderId;
      if (!orderId) {
        const order = await checkoutApi.checkout({ ...product, couponCode: applied || undefined, billing: { name: v.name, phone: phone || undefined, state: v.state || undefined, gstin: v.gstin || undefined }, affiliateCode: storedReferral() ?? undefined, attribution: attribution() }, attempt.current.key);
        orderId = order.id;
        attempt.current.orderId = orderId;
        if (order.status === 'PAID') {
          qc.invalidateQueries({ queryKey: ['cart'] });
          if (emailNote) toast.success('Your account is ready', emailNote);
          return navigate(`/learn/orders/${orderId}`, { replace: true });
        }
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
      if (who.created) toast.success('Your account is ready', { description: `Your login details are on their way to ${v.email}.` });
      navigate(`/learn/orders/${orderId}`, { replace: true });
    } catch (e) {
      if (e.code === 'CONFLICT' && /already have access/.test(e.message)) {
        toast.success('You already have access');
        return navigate(mode === 'course' ? `/learn/courses/${courseId}` : '/learn');
      }
      if (e.status === 401 && needLogin) { form.setError('password', { message: 'Incorrect password. Try again or reset it.' }); return; }
      if (e.status === 409 && /expired/i.test(e.message)) attempt.current = { key: newKey(), orderId: null, signature: null };
      if (e.details?.[0]?.field === 'bumpOfferIds') { setBumpIds([]); toast.error(e.details[0].message); return; }
      if (e.details?.[0]?.field === 'couponCode') setCouponError(e.details[0].message);
      else if (e.details?.length) applyApiErrors(e, form.setError, ['name', 'email', 'phone', 'state', 'gstin']);
      else toast.error(e.message);
    } finally {
      setBusy(false);
    }
  });

  const noun = { plan: 'membership', bundle: 'bundle', cart: 'cart', course: 'course', webinar: 'webinar', product: 'product', coaching: 'coaching program', link: 'payment link', offer: 'offer' }[mode];
  // A cart and a post-purchase offer belong to an account: sign in first.
  if (guest && (mode === 'cart' || mode === 'offer')) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
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
  const color = site.data?.theme?.primaryColor;
  const loading = !c || auth.status === 'loading' || (!freeCourse && quote.isLoading);
  const cover = c?.thumbnailUrl ?? c?.bannerUrl ?? c?.coverUrl ?? c?.imageUrl ?? null;
  const blurb = c?.shortDescription ?? c?.summary ?? (typeof c?.description === 'string' ? c.description : null) ?? c?.note ?? null;
  const typeLabel = mode === 'cart' ? `${mainItems.length} item${mainItems.length === 1 ? '' : 's'}` : mode === 'link' ? ({ course: 'Course', bundle: 'Bundle', product: 'Digital product', webinar: 'Webinar', membership: 'Membership' }[c?.kind] ?? 'Purchase') : mode === 'product' ? 'Digital product' : mode === 'plan' ? 'Membership' : noun;
  const validity = mode === 'plan' ? (c?.interval === 'YEAR' ? '1 year' : '1 month') : mode === 'course' ? (c?.accessDays ? `${c.accessDays} days access` : 'Lifetime') : mode === 'bundle' ? (c?.courseCount ? `${c.courseCount} courses` : null) : null;
  const canSubmit = freeCourse || (qd && qd.paymentsEnabled);
  const cta = freeCourse ? 'Access now' : !qd ? 'Continue' : Number(qd.total) === 0 ? 'Get access' : `Pay ${m(qd.total)}`;

  return (
    <div className="min-h-dvh bg-surface-2 pb-28" style={{ fontFamily: site.data?.theme?.fontBody }}>
      <header className="mx-auto flex h-16 max-w-5xl items-center px-4">
        <Link to="/" className="flex items-center gap-2.5 text-sm font-semibold" style={{ fontFamily: site.data?.theme?.fontHeading }}>
          {site.data?.logoUrl ? <img src={site.data.logoUrl} alt="" className="size-7 rounded object-contain" /> : <span className="grid size-7 place-items-center rounded-md text-[11px] font-bold text-white" style={{ background: color ?? '#111827' }}>{site.data?.name?.slice(0, 2).toUpperCase()}</span>}
          {site.data?.name}
        </Link>
      </header>
      <main className="mx-auto max-w-5xl px-4">
        {loading ? <div className="grid gap-6 lg:grid-cols-[1fr_400px]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div> : !freeCourse && quote.isError ? (
          <Alert tone="error" title={mode === 'cart' ? "Your cart can't be checked out right now" : `This ${noun} can't be bought right now`}>{quote.error.message}{mode === 'cart' && <> <Link to="/cart" className="underline">Review your cart</Link></>}</Alert>
        ) : (
          <form id="checkout" onSubmit={pay} noValidate className="grid items-start gap-6 lg:grid-cols-[1fr_400px]">
            {/* What is being bought */}
            <div className="space-y-5">
              {mode !== 'cart' && (
                cover
                  ? <img src={cover} alt="" className="aspect-video w-full rounded-2xl border border-line object-cover" />
                  : <div className="grid aspect-video w-full place-items-center rounded-2xl text-5xl font-bold text-white/90" style={{ background: color ?? '#1e3a8a' }}>{title?.slice(0, 1)}</div>
              )}
              <div>
                <h1 className="text-xl font-semibold">{mode === 'cart' ? 'Your cart' : title}</h1>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                  <span className="rounded-md bg-pink-50 px-2.5 py-1 tracking-wide text-pink-700 uppercase dark:bg-pink-500/10 dark:text-pink-300">{typeLabel}</span>
                  {validity && <span className="rounded-md border border-line bg-surface px-2.5 py-1 text-fg-2">{validity}</span>}
                </div>
              </div>
              {mode === 'cart' && (
                <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
                  {mainItems.map((i) => <li key={`${i.kind}${i.id}`} className="flex justify-between gap-3 px-4 py-3"><span>{i.title}</span><span className="tabular-nums">{m(i.unit)}</span></li>)}
                </ul>
              )}
              {blurb && (
                <div className="text-sm">
                  <p className="mb-1 font-semibold">Description:</p>
                  <p className={`whitespace-pre-line text-fg-2 ${showMore ? '' : 'line-clamp-4'}`}>{blurb}</p>
                  {blurb.length > 240 && <button type="button" onClick={() => setShowMore((s) => !s)} className="mt-1 text-xs font-medium text-primary-600 hover:underline">{showMore ? 'View less' : 'View more'}</button>}
                </div>
              )}
              {isPlan && <p className="text-sm text-fg-2">{c.courses?.length ?? 0} courses for one {c.interval === 'YEAR' ? 'year' : 'month'}. Paying again later extends your access; nothing renews automatically.</p>}
              {site.data?.supportEmail && (
                <div className="text-sm">
                  <p className="mb-1 font-semibold">Contact us at:</p>
                  <a href={`mailto:${site.data.supportEmail}`} className="inline-flex items-center gap-2 text-fg-2 hover:text-fg"><Mail className="size-4" aria-hidden />{site.data.supportEmail}</a>
                </div>
              )}
              <Link to={back} className="inline-block text-sm text-muted hover:text-fg">← Back to {mode === 'plan' ? 'memberships' : mode === 'offer' ? 'your order' : noun}</Link>
            </div>

            {/* Summary + details */}
            <div className="space-y-4">
              {freeCourse ? (
                <Card>
                  <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-green-800 uppercase dark:bg-green-500/15 dark:text-green-300">Free</span>What you’ll get</p>
                  <ul className="space-y-2 text-sm text-fg-2">
                    {[<>Free access to <strong className="text-fg">{title}</strong></>, 'Instant access — no payment needed', 'Yours to keep — no card required'].map((t, i) => (
                      <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" aria-hidden /><span>{t}</span></li>
                    ))}
                  </ul>
                </Card>
              ) : (
                <Card title="Order summary">
                  <div className="space-y-4">
                    {mode !== 'cart' && <div className="flex justify-between gap-3 text-sm"><span className="min-w-0 font-medium">{title}</span><span className="shrink-0 tabular-nums">{m(qd.subtotal)}</span></div>}
                    {bumpItems.length > 0 && (
                      <ul className="space-y-1.5 border-t border-dashed border-line pt-2 text-sm">
                        {bumpItems.map((i) => <li key={i.offerId} className="flex justify-between gap-3"><span className="min-w-0">+ {i.title}</span><span className="shrink-0 tabular-nums">{m(i.unit)}</span></li>)}
                      </ul>
                    )}
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
                    {!qd.paymentsEnabled && <Alert tone="info">Online checkout opens once this academy enables payments.</Alert>}
                  </div>
                </Card>
              )}

              <Card title="Personal details">
                <div className="space-y-4">
                  <Input label="Name" autoComplete="name" {...form.register('name')} error={form.formState.errors.name?.message} required />
                  {guest ? (
                    <Input label="Email" type="email" autoComplete="email" {...form.register('email', { onChange: () => needLogin && setNeedLogin(false) })} error={form.formState.errors.email?.message} required hint={needLogin ? undefined : 'Your login details are sent here.'} />
                  ) : (
                    <div>
                      <Input label="Email" value={auth.user?.email ?? ''} disabled hint="Receipts go to your account email." />
                      <button type="button" onClick={() => auth.logout()} className="mt-1 text-xs text-muted hover:text-fg hover:underline">Not you? Log out</button>
                    </div>
                  )}
                  {guest && needLogin && (
                    <div className="space-y-3 rounded-lg border border-primary-200 bg-primary-50/60 p-3 dark:border-primary-500/30 dark:bg-primary-500/10">
                      <p className="text-sm">You already have an account with this email. Enter your password to continue.</p>
                      <Input label="Password" type="password" autoComplete="current-password" autoFocus {...form.register('password')} error={form.formState.errors.password?.message} />
                      <Link to="/forgot-password" className="text-xs font-medium text-primary-600 hover:underline">Forgot password?</Link>
                    </div>
                  )}
                  <div>
                    <label htmlFor="checkout-phone" className="mb-1.5 block text-sm font-medium">Phone number{guest && <span className="text-red-600"> *</span>}</label>
                    <div className="flex gap-2">
                      <select aria-label="Country code" {...form.register('dial')} className="h-10 rounded-md border border-line bg-surface px-2 text-sm">
                        {DIAL_CODES.map(([code, flag]) => <option key={code} value={code}>{flag} {code}</option>)}
                      </select>
                      <input id="checkout-phone" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" {...form.register('phone')}
                        className="h-10 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20" aria-invalid={Boolean(form.formState.errors.phone)} />
                    </div>
                    {form.formState.errors.phone && <p role="alert" className="mt-1 text-xs text-red-600">{form.formState.errors.phone.message}</p>}
                  </div>
                  <div>
                    <label htmlFor="checkout-state" className="mb-1.5 block text-sm font-medium">State</label>
                    <select id="checkout-state" autoComplete="address-level1" {...form.register('state')} className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm">
                      <option value="">Select your state</option>
                      {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                      <option value="Outside India">Outside India</option>
                    </select>
                  </div>
                  {freeCourse || site.data?.gstInputCredit === false ? null : showGst ? (
                    <Input label="GSTIN" placeholder="22AAAAA0000A1Z5" {...form.register('gstin')} error={form.formState.errors.gstin?.message} hint="Shown on your invoice for input tax credit." />
                  ) : (
                    <Button variant="link" size="sm" onClick={() => setShowGst(true)}>Buying for a business? Add GSTIN</Button>
                  )}
                </div>
              </Card>
            </div>
          </form>
        )}
      </main>

      {/* Sticky action bar */}
      {!loading && canSubmit && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs text-muted"><Lock className="size-3.5" aria-hidden />All transactions are secure and encrypted.</p>
            <Button type="submit" form="checkout" size="lg" className="min-w-40 rounded-full" loading={busy} style={{ background: color }}>
              {needLogin && guest ? `Log in & ${freeCourse ? 'continue' : cta.toLowerCase()}` : cta}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
