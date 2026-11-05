import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarClock, CheckCircle2, ExternalLink, PlayCircle, Radio, Video } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Card, CardBody, CardHeader, Checkbox, EmptyState, ErrorState, Input, Modal, Skeleton, Spinner, StatusBadge, toast } from '../../components/ui/index.js';
import { LiveRoom } from '../../components/live/LiveRoom.jsx';
import { creatorLiveApi, learnLiveApi, participantApi, webinarApi } from '../../services/api/live.js';
import { academyApi } from '../../services/api/auth.js';
import { applyApiErrors } from '../../utils/forms.js';
import { formatDate } from '../../utils/format.js';
import { AcademyHeader } from '../public/AcademyLandingPage.jsx';

function Joining({ error, onBack }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-[#111] p-6 text-white">
      {error ? <div className="max-w-md text-center"><p className="text-lg font-medium">Could not join</p><p className="mt-2 text-white/70">{error}</p><Button className="mt-6" variant="secondary" onClick={onBack}>Back</Button></div> : <div className="text-center"><Spinner className="mx-auto size-8" /><p className="mt-3 text-white/70">Connecting to the classroom…</p></div>}
    </div>
  );
}

/** Host view: full-screen classroom with waiting room, polls, Q&A and End session. */
export function HostRoomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const join = useQuery({ queryKey: ['live', 'host', id], queryFn: () => creatorLiveApi.host(id), retry: false, staleTime: Infinity, gcTime: 0 });
  const [confirm, setConfirm] = useState(false);
  const end = useMutation({ mutationFn: () => creatorLiveApi.end(id), onSuccess: (c) => { toast.success('Session ended'); navigate(`/creator/live/${c.id}`); }, onError: (e) => toast.error(e.message) });
  if (!join.data) return <Joining error={join.error?.message} onBack={() => navigate(-1)} />;
  return (
    <>
      <LiveRoom join={join.data} title="Hosting" host sessionId={id} api={participantApi('host', id)} onLeave={() => navigate('/creator/live')}
        endButton={<Button size="sm" variant="danger" onClick={() => setConfirm(true)}>End session</Button>} />
      <Modal open={confirm} onClose={() => setConfirm(false)} title="End this session for everyone?"
        footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>Keep going</Button><Button variant="danger" loading={end.isPending} onClick={() => end.mutate()}>End session</Button></>}>
        <p className="text-sm text-fg-2">Everyone is disconnected and attendance is finalised{join.data ? '' : ''}.</p>
      </Modal>
    </>
  );
}

/** Student view of one session. */
export function StudentRoomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const join = useQuery({ queryKey: ['live', 'join', id], queryFn: () => learnLiveApi.join(id), retry: false, staleTime: Infinity, gcTime: 0 });
  if (join.data?.provider === 'EXTERNAL') {
    return <div className="grid min-h-dvh place-items-center p-6"><Card className="max-w-md"><CardBody className="space-y-4 text-center"><ExternalLink className="mx-auto size-8 text-muted" /><p className="font-medium">This class runs on an external meeting app.</p><a className="inline-flex h-10 items-center rounded-md bg-primary-600 px-5 text-sm font-medium text-on-primary" href={join.data.joinUrl} target="_blank" rel="noreferrer noopener">Open meeting</a></CardBody></Card></div>;
  }
  if (!join.data) return <Joining error={join.error?.message} onBack={() => navigate('/learn/live')} />;
  return <LiveRoom join={join.data} title="Live class" sessionId={id} api={participantApi('student', id)} onLeave={() => navigate('/learn/live')} />;
}

/** Student list of upcoming sessions and recordings. */
export function StudentLivePage() {
  const navigate = useNavigate();
  const upcoming = useQuery({ queryKey: ['learn', 'live', 'upcoming'], queryFn: learnLiveApi.upcoming, refetchInterval: 60_000 });
  const recordings = useQuery({ queryKey: ['learn', 'live', 'recordings'], queryFn: learnLiveApi.recordings });
  const [playing, setPlaying] = useState(null);
  const play = useMutation({ mutationFn: learnLiveApi.recording, onSuccess: (r) => setPlaying(r), onError: (e) => toast.error(e.message) });
  const join = useMutation({ mutationFn: learnLiveApi.join, onSuccess: (r, id) => (r.provider === 'EXTERNAL' ? window.open(r.joinUrl, '_blank', 'noopener') : navigate(`/learn/live/${id}`)), onError: (e) => toast.error(e.message) });
  return (
    <>
      <PageHeader title="Live classes" description="Join live sessions and watch recordings." breadcrumbs={[{ label: 'Live classes' }]} />
      <Card>
        <CardHeader title="Upcoming" />
        <CardBody className="divide-y divide-line p-0">
          {upcoming.isLoading ? <div className="p-5"><Skeleton className="h-16" /></div> : (upcoming.data ?? []).length === 0 ? <EmptyState icon={Radio} title="No upcoming live classes" className="py-10" /> : upcoming.data.map((s) => {
            const open = s.status === 'LIVE' || new Date(s.joinOpensAt).getTime() <= Date.now();
            return (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex items-center gap-3"><CalendarClock className="size-5 text-muted" /><div><p className="font-medium">{s.liveClass.title}</p><p className="text-sm text-muted">{formatDate(s.startsAt, { withTime: true })}</p></div></div>
                <div className="flex items-center gap-2">
                  {s.status === 'LIVE' && <StatusBadge status="LIVE" label="Live now" />}
                  <Button size="sm" leftIcon={Video} disabled={!open} loading={join.isPending && join.variables === s.id} onClick={() => join.mutate(s.id)}>{open ? 'Join' : `Opens ${formatDate(s.joinOpensAt, { withTime: true })}`}</Button>
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Recordings" />
        <CardBody className="divide-y divide-line p-0">
          {(recordings.data ?? []).length === 0 ? <p className="p-5 text-sm text-muted">No recordings yet.</p> : recordings.data.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <div><p className="font-medium">{s.liveClass.title}</p><p className="text-muted">{formatDate(s.startsAt)}</p></div>
              <Button size="sm" variant="secondary" leftIcon={PlayCircle} loading={play.isPending && play.variables === s.id} onClick={() => play.mutate(s.id)}>Watch</Button>
            </div>
          ))}
        </CardBody>
      </Card>
      <Modal open={Boolean(playing)} onClose={() => setPlaying(null)} title={playing?.title} size="xl">
        {playing && <video src={playing.url} controls playsInline controlsList="nodownload" className="aspect-video w-full rounded-lg bg-black" />}
      </Modal>
    </>
  );
}

const regSchema = z.object({ name: z.string().trim().min(2, 'Enter your name').max(120), email: z.string().trim().email('Enter a valid email'), consent: z.boolean() });

/** Public webinar landing + registration. */
export function WebinarPage() {
  const { slug } = useParams();
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000 });
  const q = useQuery({ queryKey: ['webinar', slug], queryFn: () => webinarApi.get(slug), retry: false });
  const [done, setDone] = useState(null);
  const form = useForm({ resolver: zodResolver(regSchema), defaultValues: { name: '', email: '', consent: false } });
  const submit = form.handleSubmit(async (v) => {
    try {
      const r = await webinarApi.register(slug, v);
      setDone(r.email);
    } catch (e) {
      applyApiErrors(e, form.setError, ['name', 'email']);
    }
  });
  if (q.isError) return <div className="grid min-h-dvh place-items-center"><ErrorState title="Webinar not found" error={q.error} /></div>;
  const w = q.data;
  const color = site.data?.theme?.primaryColor;
  return (
    <div className="min-h-dvh bg-surface-2">
      <AcademyHeader site={site.data} />
      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[1fr_380px]">
        {!w ? <Skeleton className="h-64" /> : (
          <>
            <section>
              <p className="text-sm font-medium" style={{ color }}>Free live webinar</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">{w.title}</h1>
              {w.description && <p className="mt-4 whitespace-pre-line text-fg-2">{w.description}</p>}
              <ul className="mt-6 space-y-2">{w.sessions.map((s) => <li key={s.id} className="flex items-center gap-2 text-sm"><CalendarClock className="size-4 text-muted" />{new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(s.startsAt))} · {w.durationMinutes} min</li>)}</ul>
            </section>
            <Card className="h-fit">
              <CardBody className="space-y-4">
                {done ? (
                  <div className="space-y-2 text-center"><CheckCircle2 className="mx-auto size-10 text-green-600" /><p className="font-semibold">You're registered!</p><p className="text-sm text-muted">We sent your personal join link to {done}.</p></div>
                ) : !w.open ? <Alert tone="info">{w.sessions.length ? 'This webinar is full.' : 'There are no upcoming sessions.'}</Alert> : (
                  <form onSubmit={submit} className="space-y-3" noValidate>
                    <p className="font-semibold">Save your seat</p>
                    <Input label="Name" autoComplete="name" {...form.register('name')} error={form.formState.errors.name?.message} />
                    <Input label="Email" type="email" autoComplete="email" {...form.register('email')} error={form.formState.errors.email?.message} />
                    <Checkbox label="Send me updates about this webinar" {...form.register('consent')} />
                    <Button type="submit" className="w-full" loading={form.formState.isSubmitting} style={{ background: color }}>Register for free</Button>
                    {w.seatsLeft !== null && <p className="text-center text-xs text-muted">{w.seatsLeft} seats left</p>}
                  </form>
                )}
              </CardBody>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

/** Personal ticket link from the registration email: pick the session, join without an account. */
export function TicketPage() {
  const { code } = useParams();
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000 });
  const t = useQuery({ queryKey: ['ticket', code], queryFn: () => webinarApi.ticket(code), retry: false, refetchInterval: 60_000 });
  const [session, setSession] = useState(null);
  const join = useMutation({ mutationFn: (sid) => webinarApi.join(code, sid), onSuccess: (r, sid) => (r.provider === 'EXTERNAL' ? window.open(r.joinUrl, '_blank', 'noopener') : setSession({ id: sid, join: r })), onError: (e) => toast.error(e.message) });
  if (session) return <LiveRoom join={session.join} title={t.data?.webinar.title} sessionId={session.id} api={participantApi('ticket', session.id, code)} onLeave={() => setSession(null)} />;
  if (t.isError) return <div className="grid min-h-dvh place-items-center"><ErrorState title="Ticket not found" error={t.error} /></div>;
  return (
    <div className="min-h-dvh bg-surface-2">
      <AcademyHeader site={site.data} />
      <main className="mx-auto max-w-xl px-4 py-10">
        {!t.data ? <Skeleton className="h-48" /> : (
          <Card>
            <CardBody className="space-y-4">
              <p className="text-sm text-muted">Hi {t.data.name}, your ticket for</p>
              <h1 className="text-2xl font-semibold">{t.data.webinar.title}</h1>
              {t.data.sessions.length === 0 ? <Alert tone="info">There are no upcoming sessions.</Alert> : t.data.sessions.map((s) => {
                const open = s.status === 'LIVE' || new Date(s.startsAt).getTime() - 15 * 60_000 <= Date.now();
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm">
                    <span>{formatDate(s.startsAt, { withTime: true })}</span>
                    <Button size="sm" disabled={!open} loading={join.isPending} onClick={() => join.mutate(s.id)}>{open ? 'Join now' : 'Opens 15 min before'}</Button>
                  </div>
                );
              })}
              <p className="text-xs text-muted">This link is personal — please don't share it. <Link className="underline" to="/">Visit the academy</Link></p>
            </CardBody>
          </Card>
        )}
      </main>
    </div>
  );
}
