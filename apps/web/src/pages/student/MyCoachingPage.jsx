import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Clock, Download, Users, Video } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { RichTextView } from '../../components/forms/RichTextView.jsx';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Modal, Skeleton, toast } from '../../components/ui/index.js';
import { coachingApi } from '../../services/api/coaching.js';
import { cn } from '../../utils/cn.js';

const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
const fmtTime = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };

/** Student: coaching programs I have — book, join or cancel each session. */
export function MyCoachingPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['learn', 'coaching'], queryFn: coachingApi.mine });
  const [booking, setBooking] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const cancel = useMutation({ mutationFn: (id) => coachingApi.cancel(id), onSuccess: () => { toast.success('Booking cancelled'); setCancelling(null); qc.invalidateQueries({ queryKey: ['learn', 'coaching'] }); }, onError: (e) => { toast.error(e.message); setCancelling(null); } });
  const file = useMutation({ mutationFn: ({ bookingId, fileId }) => coachingApi.attachment(bookingId, fileId), onSuccess: (r) => window.location.assign(r.url), onError: (e) => toast.error(e.message) });
  return (
    <>
      <PageHeader title="My coaching" description="Book a time for each session. You’ll get an email with the joining link." />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : !q.data ? <Skeleton className="h-48" /> : !q.data.length ? (
        <Card><EmptyState icon={Users} title="No coaching yet" description="1:1 coaching programs you buy or join appear here." action={<Link to="/courses" className="text-sm font-medium text-primary-600 underline">Browse the academy</Link>} /></Card>
      ) : (
        <div className="space-y-6">
          {q.data.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-line p-4">
                <div className="size-12 overflow-hidden rounded-lg bg-gradient-to-br from-sky-300 to-primary-600">{p.coverUrl && <img src={p.coverUrl} alt="" className="size-full object-cover" />}</div>
                <div className="flex-1"><p className="font-semibold">{p.title}</p><p className="text-xs text-muted">{p.sessions.filter((s) => s.booking).length} of {p.sessions.length} sessions booked</p></div>
              </div>
              <ul className="divide-y divide-line">
                {p.sessions.map((s, i) => {
                  const b = s.booking;
                  const past = b && new Date(b.endsAt) < new Date();
                  return (
                    <li key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-50 text-xs font-semibold text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">{i + 1}</span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="font-medium">{s.title} <span className="ml-1 text-xs font-normal text-muted"><Clock className="inline size-3" aria-hidden /> {s.durationMin} min</span></p>
                        {b ? <p className="text-sm text-fg-2"><CalendarCheck className="mr-1 inline size-4 text-green-600" aria-hidden />{fmtDay(b.startsAt)}, {fmtTime(b.startsAt)} – {fmtTime(b.endsAt)} with {b.coachName}</p> : <RichTextView value={s.agenda} className="text-sm text-muted" />}
                        {s.notes && <p className="text-xs text-muted">Prepare: {s.notes}</p>}
                        {b && s.attachments.length > 0 && <div className="flex flex-wrap gap-2 pt-1">{s.attachments.map((a) => <Button key={a.id} size="sm" variant="ghost" leftIcon={Download} onClick={() => file.mutate({ bookingId: b.id, fileId: a.id })}>{a.fileName}</Button>)}</div>}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {!b && <Button size="sm" onClick={() => setBooking({ program: p, session: s })}>Book a time</Button>}
                        {b && b.status === 'COMPLETED' && <Badge tone="success">Completed</Badge>}
                        {b && b.status === 'BOOKED' && !past && <>
                          {b.meetingUrl && <a href={b.meetingUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md bg-primary-600 px-3 text-sm font-medium text-on-primary"><Video className="size-4" aria-hidden />Join</a>}
                          <Button size="sm" variant="ghost" onClick={() => setCancelling(b)}>Cancel</Button>
                        </>}
                        {b && b.status === 'BOOKED' && past && <Badge>Done</Badge>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {booking && <SlotPicker program={booking.program} session={booking.session} onClose={() => setBooking(null)} onBooked={() => { setBooking(null); qc.invalidateQueries({ queryKey: ['learn', 'coaching'] }); }} />}
      <ConfirmDialog open={Boolean(cancelling)} onClose={() => setCancelling(null)} title="Cancel this booking?" description="You can book another time afterwards." confirmLabel="Cancel booking" loading={cancel.isPending} onConfirm={() => cancel.mutate(cancelling.id)} />
    </>
  );
}

function SlotPicker({ program, session, onClose, onBooked }) {
  const q = useQuery({ queryKey: ['learn', 'coaching', 'slots', program.id, session.id], queryFn: () => coachingApi.slots(program.id, session.id) });
  const days = useMemo(() => {
    const m = new Map();
    for (const t of q.data?.slots ?? []) { const k = dayKey(t); m.set(k, [...(m.get(k) ?? []), t]); }
    return [...m.values()];
  }, [q.data]);
  const [dayIdx, setDayIdx] = useState(0);
  const [pick, setPick] = useState(null);
  const book = useMutation({
    mutationFn: () => coachingApi.book(program.id, { sessionId: session.id, startsAt: pick }),
    onSuccess: (b) => { toast.success(`Booked with ${b.coachName}`, { description: 'Check your email for the details.' }); onBooked(); },
    onError: (e) => { toast.error(e.message); setPick(null); q.refetch(); },
  });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <Modal open onClose={onClose} title={`Book: ${session.title}`} description={`${session.durationMin} minutes · times shown in ${tz}`} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button disabled={!pick} loading={book.isPending} onClick={() => book.mutate()}>Confirm booking</Button></>}>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-40" /> : !days.length ? (
        <EmptyState icon={CalendarCheck} title="No free times right now" description="The coaches have no open slots in the next 30 days. Check back soon or contact the academy." />
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Days">
            {days.map((d, i) => (
              <button key={d[0]} type="button" role="tab" aria-selected={i === dayIdx} onClick={() => { setDayIdx(i); setPick(null); }}
                className={cn('shrink-0 rounded-lg border px-3 py-2 text-sm', i === dayIdx ? 'border-primary-600 bg-primary-50 font-semibold text-primary-700 dark:bg-primary-500/10 dark:text-primary-300' : 'border-line hover:bg-surface-2')}>
                {fmtDay(d[0])}<span className="block text-xs font-normal text-muted">{d.length} slot{d.length === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Times">
            {(days[dayIdx] ?? []).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={pick === t} onClick={() => setPick(t)}
                className={cn('rounded-md border py-2 text-sm', pick === t ? 'border-primary-600 bg-primary-600 font-semibold text-on-primary' : 'border-line hover:border-primary-400')}>{fmtTime(t)}</button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
