import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Package, ShoppingCart } from 'lucide-react';
import { academyApi } from '../../services/api/auth.js';
import { cartApi, productsApi } from '../../services/api/commerce.js';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Card, CardBody, ErrorState, Skeleton, toast } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatMoney } from '../../utils/format.js';
import { AcademyHeader } from './AcademyLandingPage.jsx';
import { adAddToCart, useAdViewContent } from '../../utils/adTracking.js';

const size = (b) => (b == null ? '' : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Public page of a digital product. */
export function ProductPage() {
  const { slug } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000 });
  const q = useQuery({ queryKey: ['public', 'product', slug], queryFn: () => productsApi.publicGet(slug), retry: false });
  const mine = useQuery({ queryKey: ['learn', 'products'], queryFn: productsApi.mine, enabled: auth.status === 'authenticated' });
  const claim = useMutation({ mutationFn: () => productsApi.claim(q.data.id), onSuccess: () => { toast.success('Added to your downloads'); navigate('/learn/downloads'); }, onError: (e) => toast.error(e.message) });
  const add = useMutation({ mutationFn: () => cartApi.add({ digitalProductId: q.data.id }), onSuccess: (c) => { qc.setQueryData(['cart'], c); adAddToCart('product', q.data); toast.success('Added to your cart', { action: { label: 'View cart', onClick: () => navigate('/cart') } }); }, onError: (e) => toast.error(e.message) });
  useAdViewContent('product', q.data);
  if (q.isError) return <div className="grid min-h-dvh place-items-center"><ErrorState title="Product not found" error={q.error} /></div>;
  const p = q.data;
  const color = site.data?.theme?.primaryColor;
  const owned = p && (mine.data ?? []).some((m) => m.id === p.id);
  const login = () => navigate(`/register?next=${encodeURIComponent(`/products/${slug}`)}`);
  return (
    <div className="min-h-dvh bg-surface-2" style={{ fontFamily: site.data?.theme?.fontBody }}>
      <AcademyHeader site={site.data} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        {!p ? <Skeleton className="h-96" /> : (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-6">
              <div className="aspect-video overflow-hidden rounded-xl bg-surface">{p.coverUrl ? <img src={p.coverUrl} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center"><Package className="size-12 text-line-strong" /></div>}</div>
              <div>
                <p className="text-xs font-medium tracking-wide text-muted uppercase">Digital download</p>
                <h1 className="mt-1 text-3xl font-semibold" style={{ fontFamily: site.data?.theme?.fontHeading }}>{p.title}</h1>
                {p.description && <p className="mt-3 whitespace-pre-line text-fg-2">{p.description}</p>}
              </div>
              <section>
                <h2 className="mb-3 text-lg font-semibold">What you get</h2>
                <ul className="space-y-2">{p.files.map((f, i) => <li key={i} className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 text-sm"><FileDown className="size-4 text-muted" /><span className="flex-1">{f.title}</span><span className="text-xs text-muted">{[f.type, size(f.sizeBytes)].filter(Boolean).join(' · ')}</span></li>)}</ul>
              </section>
            </div>
            <Card className="h-fit lg:sticky lg:top-6">
              <CardBody className="space-y-4">
                <p className="text-3xl font-semibold" style={{ color }}>{p.isFree ? 'Free' : formatMoney(p.priceAmount, p.currency)}{!p.isFree && p.compareAtAmount && <span className="ml-2 text-base font-normal text-muted line-through">{formatMoney(p.compareAtAmount, p.currency)}</span>}</p>
                {owned ? <Button className="w-full" size="lg" onClick={() => navigate('/learn/downloads')}>Go to my downloads</Button>
                  : p.isFree ? <Button className="w-full" size="lg" style={{ background: color }} loading={claim.isPending} onClick={() => (auth.status === 'authenticated' ? claim.mutate() : login())}>{auth.status === 'authenticated' ? 'Get it free' : 'Sign up to download'}</Button>
                  : !site.data?.paymentsEnabled ? <Alert tone="info">Online checkout opens once this academy enables payments.</Alert>
                  : (
                    <div className="space-y-2">
                      <Button className="w-full" size="lg" style={{ background: color }} onClick={() => (auth.status === 'authenticated' ? navigate(`/checkout/product/${slug}`) : login())}>{auth.status === 'authenticated' ? 'Buy now' : 'Sign up to buy'}</Button>
                      {auth.status === 'authenticated' && <Button className="w-full" variant="secondary" leftIcon={ShoppingCart} loading={add.isPending} onClick={() => add.mutate()}>Add to cart</Button>}
                    </div>
                  )}
                <p className="text-xs text-muted">Instant download from your account after {p.isFree ? 'signing up' : 'payment'}.{p.downloadLimit ? ` Each file can be downloaded ${p.downloadLimit} times.` : ''}</p>
              </CardBody>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
