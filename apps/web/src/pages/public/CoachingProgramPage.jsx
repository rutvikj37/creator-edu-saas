import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarCheck, Clock, Users } from 'lucide-react';
import { academyApi } from '../../services/api/auth.js';
import { coachingApi } from '../../services/api/coaching.js';
import { Alert } from '../../components/auth/Alert.jsx';
import { RichTextView } from '../../components/forms/RichTextView.jsx';
import { Avatar, Button, Card, CardBody, ErrorState, Skeleton, toast } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatMoney } from '../../utils/format.js';
import { AcademyHeader } from './AcademyLandingPage.jsx';

const mins = (m) => (m % 60 === 0 ? `${m / 60} hr` : m > 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`);

/** Public page of a 1:1 coaching program. */
export function CoachingProgramPage() {
  const { slug } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000 });
  const q = useQuery({ queryKey: ['public', 'coaching', slug], queryFn: () => coachingApi.publicGet(slug), retry: false });
  const mine = useQuery({ queryKey: ['learn', 'coaching'], queryFn: coachingApi.mine, enabled: auth.status === 'authenticated' });
  const claim = useMutation({ mutationFn: () => coachingApi.claim(q.data.id), onSuccess: () => { toast.success('You’re in — now book your sessions'); navigate('/learn/coaching'); }, onError: (e) => toast.error(e.message) });
  if (q.isError) return <div className="grid min-h-dvh place-items-center"><ErrorState title="Program not found" error={q.error} /></div>;
  const p = q.data;
  const color = site.data?.theme?.primaryColor;
  const owned = p && (mine.data ?? []).some((m) => m.id === p.id);
  const login = () => navigate(`/register?next=${encodeURIComponent(`/coaching/${slug}`)}`);
  return (
    <div className="min-h-dvh bg-surface-2" style={{ fontFamily: site.data?.theme?.fontBody }}>
      <AcademyHeader site={site.data} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        {!p ? <Skeleton className="h-96" /> : (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-6">
              <div className="aspect-[4/3] max-h-96 w-full overflow-hidden rounded-xl bg-gradient-to-br from-sky-300 to-primary-600">{p.coverUrl && <img src={p.coverUrl} alt="" className="size-full object-cover" />}</div>
              <div>
                <p className="text-xs font-medium tracking-wide text-muted uppercase">1:1 coaching</p>
                <h1 className="mt-1 text-3xl font-semibold" style={{ fontFamily: site.data?.theme?.fontHeading }}>{p.title}</h1>
                {p.description && <RichTextView value={p.description} className="mt-3 text-fg-2" />}
              </div>
              <section>
                <h2 className="mb-3 text-lg font-semibold">Sessions</h2>
                <ol className="space-y-3">
                  {p.sessions.map((s, i) => (
                    <li key={i} className="rounded-lg border border-line bg-surface p-4">
                      <div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-full bg-primary-50 text-xs font-semibold text-primary-700">{i + 1}</span><p className="flex-1 font-medium">{s.title}</p><span className="flex items-center gap-1 text-sm text-muted"><Clock className="size-3.5" aria-hidden />{mins(s.durationMin)}</span></div>
                      <RichTextView value={s.agenda} className="mt-2 text-sm text-fg-2" />
                    </li>
                  ))}
                </ol>
              </section>
              {p.coaches.length > 0 && (
                <section>
                  <h2 className="mb-3 text-lg font-semibold">{p.coaches.length === 1 ? 'Your coach' : 'Coaches'}</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {p.coaches.map((c, i) => (
                      <div key={i} className="flex gap-3 rounded-lg border border-line bg-surface p-4">
                        {c.photoUrl ? <img src={c.photoUrl} alt="" className="size-12 rounded-full object-cover" /> : <Avatar name={c.name} size="lg" />}
                        <div><p className="font-medium">{c.name}</p>{c.bio && <p className="mt-1 text-sm text-fg-2">{c.bio}</p>}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {p.faqs?.length > 0 && (
                <section>
                  <h2 className="mb-3 text-lg font-semibold">Frequently asked questions</h2>
                  <div className="space-y-2">{p.faqs.map((f, i) => <details key={i} className="rounded-lg border border-line bg-surface p-4"><summary className="cursor-pointer font-medium">{f.question}</summary><p className="mt-2 whitespace-pre-line text-sm text-fg-2">{f.answer}</p></details>)}</div>
                </section>
              )}
            </div>
            <Card className="h-fit lg:sticky lg:top-6">
              <CardBody className="space-y-4">
                {p.planName && <p className="font-medium text-fg-2">{p.planName}</p>}
                <p className="text-3xl font-semibold" style={{ color }}>{p.isFree ? 'Free' : formatMoney(p.priceAmount, p.currency)}{!p.isFree && p.compareAtAmount && <span className="ml-2 text-base font-normal text-muted line-through">{formatMoney(p.compareAtAmount, p.currency)}</span>}</p>
                <ul className="space-y-1.5 text-sm text-fg-2">
                  <li className="flex items-center gap-2"><CalendarCheck className="size-4 text-muted" aria-hidden />{p.sessions.length} session{p.sessions.length === 1 ? '' : 's'} — you pick the times</li>
                  <li className="flex items-center gap-2"><Users className="size-4 text-muted" aria-hidden />1:1 with {p.coaches.length === 1 ? p.coaches[0].name : 'one of our coaches'}</li>
                </ul>
                {owned ? <Button className="w-full" size="lg" onClick={() => navigate('/learn/coaching')}>Book your sessions</Button>
                  : p.isFree ? <Button className="w-full" size="lg" style={{ background: color }} loading={claim.isPending} onClick={() => (auth.status === 'authenticated' ? claim.mutate() : login())}>{auth.status === 'authenticated' ? 'Get it free' : 'Sign up to book'}</Button>
                  : !site.data?.paymentsEnabled ? <Alert tone="info">Online checkout opens once this academy enables payments.</Alert>
                  : <Button className="w-full" size="lg" style={{ background: color }} onClick={() => (auth.status === 'authenticated' ? navigate(`/checkout/coaching/${slug}`) : login())}>{auth.status === 'authenticated' ? 'Get access now' : 'Sign up to buy'}</Button>}
                <p className="text-xs text-muted">After {p.isFree ? 'signing up' : 'payment'} you choose a time for each session from the coaches’ free slots.</p>
              </CardBody>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
