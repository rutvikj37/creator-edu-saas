import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, ShoppingCart } from 'lucide-react';
import { academyApi } from '../../services/api/auth.js';
import { bundlesApi, cartApi } from '../../services/api/commerce.js';
import { learnApi } from '../../services/api/learn.js';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Card, CardBody, ErrorState, Skeleton, toast } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatMoney } from '../../utils/format.js';
import { AcademyHeader } from './AcademyLandingPage.jsx';
import { adAddToCart, useAdViewContent } from '../../utils/adTracking.js';

/** Public page of a course bundle: what is included, the saving, buy or add to cart. */
export function BundlePage() {
  const { slug } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000 });
  const q = useQuery({ queryKey: ['public', 'bundle', slug], queryFn: () => bundlesApi.publicGet(slug), retry: false });
  const mine = useQuery({ queryKey: ['learn', 'enrollments'], queryFn: learnApi.enrollments, enabled: auth.status === 'authenticated' });
  const add = useMutation({
    mutationFn: () => cartApi.add({ bundleId: q.data.id }),
    onSuccess: (cart) => { qc.setQueryData(['cart'], cart); adAddToCart('bundle', q.data); toast.success('Added to your cart', { action: { label: 'View cart', onClick: () => navigate('/cart') } }); },
    onError: (e) => toast.error(e.message),
  });
  useAdViewContent('bundle', q.data);
  if (q.isError) return <div className="grid min-h-dvh place-items-center"><ErrorState title="Bundle not found" error={q.error} /></div>;
  const b = q.data;
  const color = site.data?.theme?.primaryColor;
  const owned = new Set((mine.data ?? []).filter((e) => e.usable).map((e) => e.course.id));
  const ownsAll = b && b.courses.every((c) => owned.has(c.id));
  const saving = b ? Number(b.worthAmount) - Number(b.priceAmount) : 0;
  const login = () => navigate(`/register?next=${encodeURIComponent(`/bundles/${slug}`)}`);
  return (
    <div className="min-h-dvh bg-surface-2" style={{ fontFamily: site.data?.theme?.fontBody }}>
      <AcademyHeader site={site.data} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        {!b ? <Skeleton className="h-96" /> : (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-6">
              <div>
                <p className="text-xs font-medium tracking-wide text-muted uppercase">Bundle · {b.courseCount} courses</p>
                <h1 className="mt-1 text-3xl font-semibold" style={{ fontFamily: site.data?.theme?.fontHeading }}>{b.title}</h1>
                {b.description && <p className="mt-3 whitespace-pre-line text-fg-2">{b.description}</p>}
              </div>
              <div className="space-y-3">
                {b.courses.map((c) => (
                  <Link key={c.id} to={`/courses/${c.slug}`} className="block">
                    <Card className="flex gap-4 p-3 transition-shadow hover:shadow-md">
                      <div className="aspect-video w-36 shrink-0 overflow-hidden rounded-md bg-surface-2">{c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center"><BookOpen className="size-6 text-line-strong" /></div>}</div>
                      <div className="min-w-0">
                        <p className="font-medium">{c.title}</p>
                        {c.shortDescription && <p className="line-clamp-2 text-sm text-muted">{c.shortDescription}</p>}
                        {owned.has(c.id) && <p className="mt-1 flex items-center gap-1 text-xs text-green-700"><Check className="size-3.5" />You have this course</p>}
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
            <Card className="h-fit lg:sticky lg:top-6">
              <CardBody className="space-y-4">
                <div>
                  <p className="text-3xl font-semibold" style={{ color }}>{formatMoney(b.priceAmount, b.currency)}</p>
                  {saving > 0 && <p className="text-sm text-muted"><span className="line-through">{formatMoney(b.worthAmount, b.currency)}</span> · you save {formatMoney(saving, b.currency)}</p>}
                </div>
                {ownsAll ? <Alert tone="success">You already have every course in this bundle.</Alert>
                  : !site.data?.paymentsEnabled ? <Alert tone="info">Online checkout opens once this academy enables payments.</Alert>
                  : (
                    <div className="space-y-2">
                      <Button className="w-full" size="lg" style={{ background: color }} onClick={() => (auth.status === 'authenticated' ? navigate(`/checkout/bundle/${slug}`) : login())}>{auth.status === 'authenticated' ? 'Buy bundle' : 'Sign up to buy'}</Button>
                      {auth.status === 'authenticated' && <Button className="w-full" variant="secondary" leftIcon={ShoppingCart} loading={add.isPending} onClick={() => add.mutate()}>Add to cart</Button>}
                    </div>
                  )}
                <p className="text-xs text-muted">One payment gives you every course in the bundle, with each course's normal access period.</p>
              </CardBody>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
