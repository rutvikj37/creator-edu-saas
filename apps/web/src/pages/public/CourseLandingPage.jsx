import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cartApi } from '../../services/api/commerce.js';
import { Award, BookOpen, Check, Clock, Eye, FileText, Lock, PlayCircle, ShoppingCart, Users } from 'lucide-react';
import { academyApi } from '../../services/api/auth.js';
import { catalogApi, learnApi } from '../../services/api/learn.js';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Card, CardBody, ErrorState, Modal, Skeleton, toast } from '../../components/ui/index.js';
import { RichTextView } from '../../components/forms/RichTextView.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatMoney } from '../../utils/format.js';
import { AcademyHeader } from './AcademyLandingPage.jsx';
import { adAddToCart, useAdViewContent } from '../../utils/adTracking.js';
import { RatingSummary } from '../../components/reviews/Stars.jsx';
import { CourseReviews } from '../../components/reviews/CourseReviews.jsx';

export function CourseLandingPage() {
  const { slug } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000 });
  const q = useQuery({ queryKey: ['catalog', slug], queryFn: () => catalogApi.course(slug), retry: false });
  const mine = useQuery({ queryKey: ['learn', 'enrollments'], queryFn: learnApi.enrollments, enabled: auth.status === 'authenticated' });
  const qc = useQueryClient();
  const addToCart = useMutation({
    mutationFn: () => cartApi.add({ courseId: q.data.id }),
    onSuccess: (cart) => { qc.setQueryData(['cart'], cart); adAddToCart('course', q.data); toast.success('Added to your cart', { action: { label: 'View cart', onClick: () => navigate('/cart') } }); },
    onError: (e) => toast.error(e.message),
  });
  const [preview, setPreview] = useState(null);
  const pv = useQuery({ queryKey: ['preview', slug, preview], queryFn: () => catalogApi.preview(slug, preview), enabled: Boolean(preview) });
  useEffect(() => { if (q.data?.seoTitle) document.title = q.data.seoTitle; }, [q.data?.seoTitle]);
  const enroll = useMutation({ mutationFn: () => learnApi.enroll(q.data.id), onSuccess: () => { toast.success('You are enrolled!'); navigate(`/learn/courses/${q.data.id}`); }, onError: (e) => toast.error(e.message) });

  useAdViewContent('course', q.data);
  if (q.isError) return <div className="grid min-h-dvh place-items-center"><ErrorState title="Course not found" error={q.error} /></div>;
  const c = q.data;
  const color = site.data?.theme?.primaryColor;
  const enrolled = mine.data?.find((e) => e.course.id === c?.id && e.usable);
  const lessons = c?.sections.flatMap((s) => s.lessons) ?? [];

  const cta = () => {
    if (enrolled) return navigate(`/learn/courses/${c.id}`);
    if (auth.status !== 'authenticated') return navigate(`/register?next=${encodeURIComponent(`/courses/${slug}`)}`);
    if (c.isFree) return enroll.mutate();
    return navigate(`/checkout/${slug}`);
  };
  const canBuy = !c?.isFree && site.data?.paymentsEnabled;

  return (
    <div className="min-h-dvh" style={{ fontFamily: site.data?.theme?.fontBody }}>
      <AcademyHeader site={site.data} />
      {!c ? <div className="mx-auto max-w-6xl p-8"><Skeleton className="h-72" /></div> : (
        <>
          <section className="border-b border-line" style={{ background: color ? `${color}0f` : undefined }}>
            <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 lg:grid-cols-[1fr_360px]">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{c.title}</h1>
                {c.shortDescription && <p className="mt-3 text-lg text-fg-2">{c.shortDescription}</p>}
                <div className="mt-5 flex flex-wrap gap-4 text-sm text-muted">
                  {c.rating?.count > 0 && <a href="#reviews-h"><RatingSummary average={c.rating.average} count={c.rating.count} /></a>}
                  <span className="flex items-center gap-1.5"><BookOpen className="size-4" />{lessons.length} lessons</span>
                  {c.durationMinutes && <span className="flex items-center gap-1.5"><Clock className="size-4" />{Math.round(c.durationMinutes / 60 * 10) / 10} hours</span>}
                  <span className="flex items-center gap-1.5"><Users className="size-4" />{c.studentCount} students</span>
                  {c.certificateEnabled && <span className="flex items-center gap-1.5"><Award className="size-4" />Certificate</span>}
                </div>
                {c.instructors.length > 0 && <p className="mt-4 text-sm">Taught by <span className="font-medium">{c.instructors.join(', ')}</span></p>}
              </div>
              <Card className="h-fit overflow-hidden">
                {c.thumbnailUrl && <img src={c.thumbnailUrl} alt="" className="aspect-video w-full object-cover" />}
                <CardBody className="space-y-4">
                  <p className="text-3xl font-semibold">{c.isFree ? 'Free' : formatMoney(c.priceAmount, c.currency)}{!c.isFree && c.compareAtAmount && <span className="ml-2 text-base font-normal text-muted line-through">{formatMoney(c.compareAtAmount, c.currency)}</span>}</p>
                  {enrolled || c.isFree || canBuy ? (
                    <Button className="w-full" size="lg" loading={enroll.isPending} onClick={cta} style={{ background: color }}>{enrolled ? 'Continue learning' : c.isFree ? (auth.status === 'authenticated' ? 'Enrol for free' : 'Sign up to enrol') : auth.status === 'authenticated' ? 'Buy now' : 'Sign up to buy'}</Button>
                  ) : (
                    <Alert tone="info">Online checkout opens once this academy enables payments.</Alert>
                  )}
                  {!enrolled && !c.isFree && canBuy && auth.status === 'authenticated' && (
                    <Button className="w-full" variant="secondary" leftIcon={ShoppingCart} loading={addToCart.isPending} onClick={() => addToCart.mutate()}>Add to cart</Button>
                  )}
                  <p className="text-xs text-muted">{c.accessType === 'LIFETIME' ? 'Lifetime access' : c.accessType === 'FIXED_DAYS' ? `${c.accessDays} days of access` : 'Access until a fixed date'}</p>
                </CardBody>
              </Card>
            </div>
          </section>
          <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[1fr_360px]">
            <div className="space-y-10">
              {c.objectives.length > 0 && (
                <section><h2 className="mb-4 text-xl font-semibold">What you'll learn</h2>
                  <ul className="grid gap-2 sm:grid-cols-2">{c.objectives.map((o) => <li key={o} className="flex gap-2 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-green-600" />{o}</li>)}</ul></section>
              )}
              <section><h2 className="mb-4 text-xl font-semibold">Curriculum</h2>
                <div className="space-y-3">
                  {c.sections.map((s) => (
                    <Card key={s.id}>
                      <p className="border-b border-line px-4 py-3 text-sm font-semibold">{s.title}</p>
                      <ul className="divide-y divide-line">
                        {s.lessons.map((l) => (
                          <li key={l.id} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${l.parentLessonId ? 'pl-10' : ''}`}>
                            {l.type === 'VIDEO' ? <PlayCircle className="size-4 text-muted" /> : <FileText className="size-4 text-muted" />}
                            <span className="flex-1">{l.title}</span>
                            {l.isFreePreview ? <Button variant="link" size="sm" leftIcon={Eye} onClick={() => setPreview(l.id)}>Preview</Button> : <Lock className="size-3.5 text-muted" aria-label="Locked" />}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  ))}
                </div>
              </section>
              {c.description && <section><h2 className="mb-4 text-xl font-semibold">About this course</h2><RichTextView value={c.description} /></section>}
              {c.prerequisites.length > 0 && <section><h2 className="mb-3 text-xl font-semibold">Requirements</h2><ul className="list-disc space-y-1 pl-5 text-sm">{c.prerequisites.map((p) => <li key={p}>{p}</li>)}</ul></section>}
              <CourseReviews slug={slug} />
            </div>
          </main>
          <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={pv.data?.title ?? 'Preview'} size="lg">
            {pv.isLoading ? <Skeleton className="h-40" /> : pv.data && (
              pv.data.type === 'TEXT' ? <RichTextView value={pv.data.content} /> : pv.data.type === 'LINK' ? <a className="text-primary-600 underline" href={pv.data.externalUrl} target="_blank" rel="noreferrer noopener">Open resource</a>
                : pv.data.fileUrl ? (pv.data.type === 'PDF' ? <iframe title="Preview" src={pv.data.fileUrl} className="h-[60vh] w-full rounded border border-line" /> : <a className="text-primary-600 underline" href={pv.data.fileUrl}>Open file</a>) : <p className="text-sm text-muted">Preview unavailable.</p>
            )}
          </Modal>
          <footer className="border-t border-line py-8 text-center text-sm text-muted"><Link to="/">{site.data?.name}</Link></footer>
        </>
      )}
    </div>
  );
}
