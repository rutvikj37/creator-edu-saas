import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, BookOpen, ShoppingCart, Trash2 } from 'lucide-react';
import { academyApi } from '../../services/api/auth.js';
import { cartApi } from '../../services/api/commerce.js';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Card, CardBody, EmptyState, ErrorState, Skeleton, toast } from '../../components/ui/index.js';
import { formatMoney } from '../../utils/format.js';
import { AcademyHeader } from '../public/AcademyLandingPage.jsx';

/** The student's cart: courses and bundles bought together in one checkout. */
export function CartPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000 });
  const cart = useQuery({ queryKey: ['cart'], queryFn: cartApi.get });
  const remove = useMutation({ mutationFn: cartApi.remove, onSuccess: (c) => qc.setQueryData(['cart'], c), onError: (e) => toast.error(e.message) });
  const c = cart.data;
  return (
    <div className="min-h-dvh bg-surface-2" style={{ fontFamily: site.data?.theme?.fontBody }}>
      <AcademyHeader site={site.data} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold">Your cart</h1>
        {cart.isError ? <ErrorState error={cart.error} onRetry={() => cart.refetch()} /> : !c ? <Skeleton className="h-64" /> : c.count === 0 ? (
          <Card><EmptyState icon={ShoppingCart} title="Your cart is empty" description="Add courses or bundles and pay for them together." action={<Link to="/courses" className="text-sm font-medium text-primary-600 underline">Browse courses</Link>} /></Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
            <Card>
              <CardBody className="divide-y divide-line p-0">
                {c.items.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 px-5 py-4">
                    {i.kind === 'bundle' ? <Layers className="size-5 shrink-0 text-muted" /> : <BookOpen className="size-5 shrink-0 text-muted" />}
                    <div className="min-w-0 flex-1">
                      {i.slug && !i.problem ? <Link to={i.kind === 'bundle' ? `/bundles/${i.slug}` : i.kind === 'product' ? `/products/${i.slug}` : `/courses/${i.slug}`} className="font-medium hover:underline">{i.title}</Link> : <p className="font-medium">{i.title}</p>}
                      <p className="text-xs text-muted">{i.kind === 'bundle' ? `Bundle · ${i.courseCount} courses` : i.kind === 'product' ? 'Digital download' : 'Course'}</p>
                      {i.problem && <p className="text-xs text-red-600">{i.problem}</p>}
                    </div>
                    {i.priceAmount !== null && <p className="tabular-nums">{formatMoney(i.priceAmount, i.currency)}</p>}
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${i.title}`} loading={remove.isPending && remove.variables === i.id} onClick={() => remove.mutate(i.id)}><Trash2 className="size-4" /></Button>
                  </div>
                ))}
              </CardBody>
            </Card>
            <Card className="h-fit">
              <CardBody className="space-y-4">
                <div className="flex justify-between text-sm"><span className="text-muted">{c.count} item{c.count === 1 ? '' : 's'}</span><span className="font-semibold tabular-nums">{c.currency ? formatMoney(c.subtotal, c.currency) : '—'}</span></div>
                <p className="text-xs text-muted">Coupons and GST are shown at checkout.</p>
                {!c.ready && <Alert tone="warning">Remove the items marked above to continue.</Alert>}
                <Button className="w-full" size="lg" disabled={!c.ready || !site.data?.paymentsEnabled} onClick={() => navigate('/cart/checkout')} style={{ background: site.data?.theme?.primaryColor }}>Checkout</Button>
              </CardBody>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
