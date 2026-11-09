import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Clock, Lock, ShieldCheck } from 'lucide-react';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Card, CardBody, ErrorState, Skeleton } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { academyApi } from '../../services/api/auth.js';
import { checkoutApi } from '../../services/api/commerce.js';
import { formatDate, formatMoney } from '../../utils/format.js';
import { useAdViewContent } from '../../utils/adTracking.js';
import { AcademyHeader } from './AcademyLandingPage.jsx';

const KIND_LABELS = { course: 'Course', bundle: 'Bundle', product: 'Digital download', webinar: 'Webinar ticket', membership: 'Membership' };

/** Landing page of a shareable payment link (/pay/:code): what it sells, for how much, and a pay button. */
export function PaymentLinkPage() {
  const { code } = useParams();
  const [search] = useSearchParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000 });
  const q = useQuery({ queryKey: ['public', 'pay', code], queryFn: () => checkoutApi.paymentLink(code), retry: false });
  const l = q.data;
  useAdViewContent(l?.kind, l && { id: l.itemId, title: l.itemTitle, priceAmount: l.price, currency: l.currency });
  const color = site.data?.theme?.primaryColor;
  const coupon = search.get('coupon');
  const checkout = `/checkout/link/${encodeURIComponent(code)}${coupon ? `?coupon=${encodeURIComponent(coupon)}` : ''}`;
  const detailsPath = l && { course: `/courses/${l.slug}`, bundle: `/bundles/${l.slug}`, product: `/products/${l.slug}`, webinar: `/webinars/${l.slug}`, membership: '/memberships' }[l.kind];

  return (
    <div className="min-h-dvh bg-surface-2" style={{ fontFamily: site.data?.theme?.fontBody }}>
      <AcademyHeader site={site.data} />
      <main className="mx-auto max-w-lg px-4 py-10">
        {q.isError ? (
          <Card><ErrorState title="This payment link isn’t available" error={q.error} /></Card>
        ) : !l ? <Skeleton className="h-80" /> : (
          <Card>
            <CardBody className="space-y-5 p-8">
              <div>
                <p className="text-xs font-medium tracking-wide text-muted uppercase">{KIND_LABELS[l.kind] ?? 'Purchase'}</p>
                <h1 className="mt-1 text-2xl font-semibold" style={{ fontFamily: site.data?.theme?.fontHeading }}>{l.itemTitle}</h1>
                {l.title !== l.itemTitle && <p className="mt-1 text-sm text-muted">{l.title}</p>}
              </div>
              {l.note && <p className="whitespace-pre-line rounded-md bg-surface-2 px-3 py-2 text-sm text-fg-2">{l.note}</p>}
              <p className="text-3xl font-semibold" style={{ color }}>
                {formatMoney(l.price, l.currency)}
                {Number(l.regularPrice) > Number(l.price) && <span className="ml-2 text-base font-normal text-muted line-through">{formatMoney(l.regularPrice, l.currency)}</span>}
              </p>
              {l.couponCode && <p className="text-sm text-green-700">Promo code {l.couponCode} is applied at checkout.</p>}
              {l.expiresAt && <p className="flex items-center gap-1.5 text-xs text-muted"><Clock className="size-3.5" />Offer ends {formatDate(l.expiresAt, { withTime: true })}</p>}
              {!site.data?.paymentsEnabled ? <Alert tone="info">Online checkout opens once this academy enables payments.</Alert>
                : auth.status === 'authenticated' ? (
                  <Button className="w-full" size="lg" leftIcon={Lock} style={{ background: color }} onClick={() => navigate(checkout)}>Continue to payment</Button>
                ) : (
                  <div className="space-y-2">
                    <Button className="w-full" size="lg" style={{ background: color }} onClick={() => navigate(`/register?next=${encodeURIComponent(checkout)}`)}>Create an account to pay</Button>
                    <Button className="w-full" variant="secondary" onClick={() => navigate(`/login?next=${encodeURIComponent(checkout)}`)}>I already have an account</Button>
                  </div>
                )}
              {detailsPath && <p className="text-center text-sm"><Link to={detailsPath} className="text-primary-600 hover:underline">See full details</Link></p>}
              <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0" />Payments are processed securely by Razorpay. Your access is added to your account right after payment.</p>
            </CardBody>
          </Card>
        )}
      </main>
    </div>
  );
}
