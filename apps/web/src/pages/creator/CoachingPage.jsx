import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock, ExternalLink, List, Lock, Pencil, Plus, Settings, Users, Video } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { MetricCard } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { FileUpload } from '../../components/forms/FileUpload.jsx';
import { Avatar, Badge, Button, Card, ConfirmDialog, DataTable, Dropdown, DropdownItem, EmptyState, ErrorState, Input, Modal, SegmentedControl, Select, Skeleton, StatusBadge, Tabs, Textarea, toast } from '../../components/ui/index.js';
import { coachingApi } from '../../services/api/coaching.js';
import { creatorCommerceApi } from '../../services/api/commerce.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { cn } from '../../utils/cn.js';
import { formatMoney, formatNumber } from '../../utils/format.js';

const time = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const day = (iso) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });

/** Academy: 1:1 coaching — bookings (list or calendar), programs and coach settings. */
export function CoachingPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'bookings';
  const settingsOpen = params.get('settings') === '1';
  const set = (patch) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); return n; }, { replace: true });
  const stats = useQuery({ queryKey: ['coaching', 'stats'], queryFn: coachingApi.stats });
  const gateway = useQuery({ queryKey: ['creator', 'gateway'], queryFn: creatorCommerceApi.gateway, enabled: auth.can?.('integrations.manage') !== false, retry: false });
  const paymentsReady = gateway.data?.configured && gateway.data?.isActive;

  useEffect(() => {
    if (params.get('connected') === 'google') { toast.success('Google Calendar connected'); set({ connected: null }); }
    else if (params.get('error') && settingsOpen) { toast.error(params.get('error')); set({ error: null }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHeader title="Coaching" description="Sell 1:1 sessions. Learners pick a time when a coach is free."
        actions={<>
          <Button variant="secondary" aria-label="Coaching settings" onClick={() => set({ settings: '1' })}><Settings className="size-4" aria-hidden /></Button>
          {auth.can?.('courses.manage') !== false && <Button leftIcon={Plus} onClick={() => navigate('/creator/coaching/new')}>Create</Button>}
        </>} />
      {gateway.data && !paymentsReady && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center dark:border-amber-500/30 dark:bg-amber-500/10">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-amber-600 text-white"><AlertTriangle className="size-5" aria-hidden /></span>
          <div className="flex-1"><p className="font-semibold text-amber-800 dark:text-amber-200">Set up payments to receive money</p><p className="text-sm text-amber-800/80 dark:text-amber-200/80">Paid programs can’t be bought until you connect Razorpay. Free programs work now.</p></div>
          <Link to="/creator/payments" className="inline-flex h-9 items-center rounded-full border border-line bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-2">Set up payments</Link>
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <MetricCard label="Total bookings" value={formatNumber(stats.data?.totalBookings ?? 0)} hint={stats.data ? `${formatNumber(stats.data.upcomingBookings)} upcoming` : undefined} loading={stats.isLoading} />
        <MetricCard label="Total revenue" value={formatMoney(stats.data?.totalRevenue ?? 0, stats.data?.currency ?? 'INR')} hint="Paid coaching orders" loading={stats.isLoading} />
      </div>
      <Tabs className="mb-4" value={tab} onChange={(v) => set({ tab: v === 'bookings' ? null : v })} tabs={[{ value: 'bookings', label: 'Bookings' }, { value: 'programs', label: 'Programs' }]} />
      {tab === 'programs' ? <ProgramsPanel /> : <BookingsPanel />}
      <CoachingSettings open={settingsOpen} onClose={() => set({ settings: null })} />
    </>
  );
}

// ── bookings ──────────────────────────────────────────────────
function BookingsPanel() {
  const qc = useQueryClient();
  const [view, setView] = useState('list');
  const [when, setWhen] = useState('upcoming');
  const [status, setStatus] = useState();
  const [programId, setProgramId] = useState();
  const [pg, setPg] = useState(1);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [cancelling, setCancelling] = useState(null);
  const programs = useQuery({ queryKey: ['coaching', 'programs'], queryFn: coachingApi.programs });
  const range = { from: new Date(month.getFullYear(), month.getMonth(), 1).toISOString(), to: new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString() };
  const query = view === 'calendar' ? { ...range, programId } : { when, status, programId, page: pg, pageSize: 20 };
  const q = useQuery({ queryKey: ['coaching', 'bookings', query], queryFn: () => coachingApi.bookings(query), placeholderData: (p) => p });
  const act = useMutation({
    mutationFn: ({ id, status: s }) => coachingApi.setBookingStatus(id, s),
    onSuccess: (_, v) => { toast.success(v.status === 'CANCELLED' ? 'Booking cancelled — the learner was emailed' : 'Marked as completed'); setCancelling(null); qc.invalidateQueries({ queryKey: ['coaching'] }); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Bookings</h2>
        <SegmentedControl size="sm" label="View" value={view} onChange={setView} options={[{ value: 'list', label: 'List', icon: List }, { value: 'calendar', label: 'Calendar', icon: CalendarDays }]} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="text-sm text-muted">Filter by:</span>
        {view === 'list' && <FilterChip label="When" value={when} onChange={(v) => { setWhen(v); setPg(1); }} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }]} />}
        {view === 'list' && <FilterChip label="Status" value={status} onChange={(v) => { setStatus(v); setPg(1); }} options={[{ value: 'BOOKED', label: 'Booked' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'CANCELLED', label: 'Cancelled' }]} />}
        <FilterChip label="Program" value={programId} onChange={(v) => { setProgramId(v); setPg(1); }} options={(programs.data ?? []).map((p) => ({ value: p.id, label: p.title }))} panelClassName="w-72" />
        {q.data && view === 'list' && <span className="ml-auto text-sm text-muted">{formatNumber(q.data.meta.total)} booking{q.data.meta.total === 1 ? '' : 's'}</span>}
      </div>
      {view === 'calendar' ? (
        <MonthCalendar month={month} onMonth={setMonth} bookings={q.data?.items ?? []} loading={q.isLoading} />
      ) : (
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta} onPageChange={setPg}
          empty={<EmptyState icon={CalendarDays} title="No sessions booked yet" description="When a learner books a session, it’ll show up here." />}
          columns={[
            { key: 'startsAt', header: 'When', cell: (r) => <div className="leading-tight"><p className="font-medium text-fg">{day(r.startsAt)}</p><p className="text-xs text-muted">{time(r.startsAt)} – {time(r.endsAt)}</p></div> },
            { key: 'student', header: 'Learner', cell: (r) => <div className="flex items-center gap-2.5"><Avatar name={r.student.name} size="sm" /><div className="min-w-0"><p className="truncate font-medium text-fg">{r.student.name}</p><p className="truncate text-xs text-muted">{r.student.email}</p></div></div> },
            { key: 'session', header: 'Session', cell: (r) => <div className="max-w-60"><p className="truncate text-fg-2">{r.session.title}</p><p className="truncate text-xs text-muted">{r.program.title}</p></div> },
            { key: 'coach', header: 'Coach', cell: (r) => r.coach.name },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} label={r.status === 'BOOKED' ? 'Booked' : r.status === 'COMPLETED' ? 'Completed' : r.cancelledBy === 'STUDENT' ? 'Cancelled by learner' : 'Cancelled'} /> },
            {
              key: 'actions', header: '', align: 'right', cell: (r) => r.status === 'BOOKED' && (
                <div className="flex justify-end gap-1">
                  {r.meetingUrl && <a href={r.meetingUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-primary-700 hover:bg-surface-2 dark:text-primary-300"><Video className="size-4" aria-hidden />Join</a>}
                  <Dropdown trigger={(p) => <Button {...p} size="sm" variant="ghost" aria-label="Booking actions"><ChevronDown className="size-4" aria-hidden /></Button>}>
                    {new Date(r.startsAt) <= new Date() && <DropdownItem onClick={() => act.mutate({ id: r.id, status: 'COMPLETED' })}>Mark completed</DropdownItem>}
                    <DropdownItem danger onClick={() => setCancelling(r)}>Cancel booking</DropdownItem>
                  </Dropdown>
                </div>
              ),
            },
          ]} />
      )}
      <ConfirmDialog open={Boolean(cancelling)} onClose={() => setCancelling(null)} tone="danger" title="Cancel this booking?" confirmLabel="Cancel booking" loading={act.isPending}
        description={cancelling ? `${cancelling.student.name} will be emailed and can book another time for “${cancelling.session.title}”.` : ''} onConfirm={() => act.mutate({ id: cancelling.id, status: 'CANCELLED' })} />
    </Card>
  );
}

function MonthCalendar({ month, onMonth, bookings, loading }) {
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);
  const today = new Date().toDateString();
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="size-4" /></Button>
        <p className="font-semibold">{month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</p>
        <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="size-4" /></Button>
      </div>
      {loading ? <Skeleton className="h-96" /> : (
        <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-line text-xs">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="border-b border-line bg-surface-2 px-2 py-1.5 font-medium text-muted">{d}</div>)}
          {days.map((d) => {
            const items = bookings.filter((b) => new Date(b.startsAt).toDateString() === d.toDateString());
            return (
              <div key={d.toISOString()} className={cn('min-h-24 border-b border-l border-line p-1.5 first:border-l-0 [&:nth-child(7n+1)]:border-l-0', d.getMonth() !== month.getMonth() && 'bg-surface-2/50 text-muted')}>
                <p className={cn('mb-1 inline-grid size-6 place-items-center rounded-full', d.toDateString() === today && 'bg-primary-600 font-semibold text-on-primary')}>{d.getDate()}</p>
                <ul className="space-y-1">
                  {items.slice(0, 3).map((b) => (
                    <li key={b.id} title={`${b.session.title} · ${b.student.name} · ${b.coach.name}`} className={cn('truncate rounded px-1.5 py-0.5', b.status === 'CANCELLED' ? 'bg-surface-2 text-muted line-through' : 'bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300')}>
                      {time(b.startsAt)} {b.student.name}
                    </li>
                  ))}
                  {items.length > 3 && <li className="px-1.5 text-muted">+{items.length - 3} more</li>}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── programs ──────────────────────────────────────────────────
function ProgramsPanel() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['coaching', 'programs'], queryFn: coachingApi.programs });
  const status = useMutation({ mutationFn: ({ id, s }) => coachingApi.setStatus(id, s), onSuccess: (p) => { toast.success(p.status === 'PUBLISHED' ? 'Program published' : p.status === 'ARCHIVED' ? 'Program archived' : 'Moved to drafts'); qc.invalidateQueries({ queryKey: ['coaching'] }); }, onError: (e) => toast.error(e.message) });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  if (!q.data) return <Skeleton className="h-48" />;
  if (!q.data.length) return <Card><EmptyState icon={Users} title="No coaching programs yet" description="Create a program with sessions, coaches and a price. Learners buy it and book times." action={<Button leftIcon={Plus} onClick={() => navigate('/creator/coaching/new')}>Create a program</Button>} /></Card>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {q.data.map((p) => (
        <Card key={p.id} className="flex flex-col overflow-hidden">
          <div className="aspect-[4/3] bg-gradient-to-br from-primary-200 to-primary-500">{p.coverUrl && <img src={p.coverUrl} alt="" className="size-full object-cover" />}</div>
          <div className="flex flex-1 flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-2"><p className="font-semibold text-fg">{p.title}</p><StatusBadge status={p.status} /></div>
            <p className="text-sm text-muted">{p.sessions.length} session{p.sessions.length === 1 ? '' : 's'} · {p.coaches.length} coach{p.coaches.length === 1 ? '' : 'es'}</p>
            <p className="font-semibold">{p.isFree ? 'Free' : formatMoney(p.priceAmount, p.currency)}{p.compareAtAmount && <span className="ml-2 text-sm font-normal text-muted line-through">{formatMoney(p.compareAtAmount, p.currency)}</span>}</p>
            <p className="text-xs text-muted">{formatNumber(p.buyers)} learner{p.buyers === 1 ? '' : 's'} · {formatNumber(p.bookings)} booking{p.bookings === 1 ? '' : 's'}</p>
            <div className="mt-auto flex flex-wrap gap-2 pt-2">
              <Button size="sm" variant="secondary" leftIcon={Pencil} onClick={() => navigate(`/creator/coaching/${p.id}/edit`)}>Edit</Button>
              {p.status === 'PUBLISHED' ? <>
                <a href={`/coaching/${p.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-sm text-fg-2 hover:bg-surface-2"><ExternalLink className="size-4" aria-hidden />View page</a>
                <Button size="sm" variant="ghost" onClick={() => status.mutate({ id: p.id, s: 'DRAFT' })}>Unpublish</Button>
              </> : <Button size="sm" onClick={() => status.mutate({ id: p.id, s: 'PUBLISHED' })}>Publish</Button>}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── settings ──────────────────────────────────────────────────
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const toHM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHM = (v) => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };
const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['Asia/Kolkata', 'UTC']; } })();

/** Coaching settings: each coach's Google Calendar, profile and weekly hours. */
function CoachingSettings({ open, onClose }) {
  const auth = useAuth();
  const [section, setSection] = useState('calendar');
  const [added, setAdded] = useState([]);
  const [adding, setAdding] = useState(false);
  const manage = auth.can?.('courses.manage') !== false;
  const team = useQuery({ queryKey: ['coaching', 'team'], queryFn: coachingApi.team, enabled: open && manage });
  const me = auth.user?.id;
  const coaches = manage ? (team.data ?? []).filter((m) => m.hasHours || m.isCoach || m.userId === me || added.includes(m.userId)) : [{ userId: me }];
  const others = (team.data ?? []).filter((m) => !coaches.some((c) => c.userId === m.userId));
  return (
    <Modal open={open} onClose={onClose} title="Coaching settings" size="xl" className="max-w-5xl">
      <div className="grid min-h-[60vh] md:grid-cols-[13rem_1fr]">
        <nav aria-label="Settings sections" className="flex gap-1 border-b border-line p-3 md:flex-col md:border-r md:border-b-0">
          {[{ v: 'calendar', l: 'Google Calendar', i: CalendarDays }, { v: 'hours', l: 'Availability', i: Clock }].map((s) => (
            <button key={s.v} type="button" onClick={() => setSection(s.v)} aria-current={section === s.v ? 'page' : undefined}
              className={cn('flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium', section === s.v ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300' : 'text-fg-2 hover:bg-surface-2')}>
              <s.i className="size-4" aria-hidden />{s.l}
            </button>
          ))}
        </nav>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4 sm:p-6">
          {manage && team.isLoading ? <Skeleton className="h-48" /> : coaches.map((c, i) => <CoachCard key={c.userId} userId={c.userId === me ? undefined : c.userId} section={section} defaultOpen={i === 0} />)}
          {manage && (adding ? (
            <Select label="Add a team member as a coach" placeholder="Choose a person" value="" onChange={(e) => { if (e.target.value) { setAdded((a) => [...a, e.target.value]); setAdding(false); } }}
              options={others.map((m) => ({ value: m.userId, label: `${m.name} · ${m.email}` }))} />
          ) : others.length > 0 && (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline dark:text-primary-300"><Plus className="size-4" aria-hidden />Add more calendars</button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function CoachCard({ userId, section, defaultOpen }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(defaultOpen);
  const q = useQuery({ queryKey: ['coaching', 'profile', userId ?? 'me'], queryFn: () => coachingApi.profile(userId) });
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (q.data) setForm({ displayName: q.data.displayName ?? q.data.name, bio: q.data.bio ?? '', photoFileId: q.data.photoFileId, photoUrl: q.data.photoUrl, timezone: q.data.timezone, meetingUrl: q.data.meetingUrl ?? '', minNoticeHours: q.data.minNoticeHours, bufferMin: q.data.bufferMin, hours: q.data.hours });
  }, [q.data]);
  const done = (p) => { qc.setQueryData(['coaching', 'profile', userId ?? 'me'], p); qc.invalidateQueries({ queryKey: ['coaching', 'team'] }); };
  const save = useMutation({
    mutationFn: () => coachingApi.saveProfile(userId, section === 'calendar'
      ? { displayName: form.displayName.trim() || null, bio: form.bio.trim() || null, photoFileId: form.photoFileId ?? null }
      : { timezone: form.timezone, meetingUrl: form.meetingUrl.trim() || null, minNoticeHours: Number(form.minNoticeHours), bufferMin: Number(form.bufferMin), hours: form.hours }),
    onSuccess: (p) => { done(p); toast.success('Saved'); },
    onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });
  const connect = useMutation({ mutationFn: () => coachingApi.connectGoogle(userId), onSuccess: (r) => window.location.assign(r.url), onError: (e) => toast.error(e.message) });
  const disconnect = useMutation({ mutationFn: () => coachingApi.disconnectGoogle(userId), onSuccess: (p) => { done(p); toast.success('Google Calendar disconnected'); }, onError: (e) => toast.error(e.message) });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  if (!q.data || !form) return <Skeleton className="h-24" />;
  const p = q.data;
  const setHour = (i, patch) => setForm((f) => ({ ...f, hours: f.hours.map((h, j) => (j === i ? { ...h, ...patch } : h)) }));
  return (
    <div className="rounded-xl border border-line">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <span className={cn('size-2 rounded-full', p.google.connected ? 'bg-green-500' : 'bg-line-strong')} aria-hidden />
        <span className="flex-1 font-semibold text-fg">{p.displayName ?? p.name}</span>
        {!p.hours.length && <Badge tone="warning">No hours set</Badge>}
        <ChevronDown className={cn('size-4 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="space-y-4 border-t border-line p-4">
          {section === 'calendar' ? <>
            <div className="flex flex-col gap-2 rounded-lg bg-surface-2/60 p-3 sm:flex-row sm:items-center">
              <CalendarDays className="size-4 text-muted" aria-hidden />
              {p.google.connected ? (
                <><span className="flex-1 text-sm">{p.google.email}</span><Button size="sm" variant="secondary" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</Button></>
              ) : (
                <><span className="flex-1 text-sm text-fg-2">Connect Google Calendar so bookings skip busy times and get a Google Meet link.</span>
                  <Button size="sm" disabled={!p.google.configured} title={p.google.configured ? undefined : 'Google sign-in is not set up on this platform yet'} loading={connect.isPending} onClick={() => connect.mutate()}>Connect Google Calendar</Button></>
              )}
            </div>
            {p.google.error && <p className="text-sm text-red-600">{p.google.error}</p>}
            {!p.google.configured && <p className="text-xs text-muted">Google sign-in isn’t configured on this platform yet, so coaches use the meeting link set under Availability.</p>}
            <div className="flex items-center gap-3">
              {form.photoUrl ? <img src={form.photoUrl} alt="" className="size-14 rounded-lg object-cover" /> : <Avatar name={form.displayName} size="lg" className="size-14 rounded-lg" />}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-fg">{form.displayName}</p>
                <FileUpload purpose="IMAGE" accept="image/png,image/jpeg" label="Change photo" hint="JPG or PNG · max 2 MB" preview="none"
                  onUploaded={(f) => setForm((x) => ({ ...x, photoFileId: f.id, photoUrl: f.url }))} />
              </div>
            </div>
            <Input label="Name" value={form.displayName} maxLength={100} onChange={(e) => setForm({ ...form, displayName: e.target.value })} hint="Shown to learners on your programs" />
            <div>
              <Input label="Email ID" value={p.email} disabled readOnly />
              <p className="mt-1 flex items-center gap-1 text-xs text-muted"><Lock className="size-3" aria-hidden />Email can’t be changed</p>
            </div>
            <div>
              <Textarea label="About the coach" rows={3} maxLength={400} placeholder="Tell learners about yourself…" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
              <p className="mt-1 text-right text-xs text-muted">{form.bio.length}/400</p>
            </div>
          </> : <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Timezone" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} options={ZONES.map((z) => ({ value: z, label: z }))} />
              <Input label="Meeting link" placeholder="https://meet.google.com/…" value={form.meetingUrl} onChange={(e) => setForm({ ...form, meetingUrl: e.target.value })} hint={p.google.connected ? 'Not needed — each booking gets its own Google Meet link.' : 'Your Zoom or Meet room, sent with every booking.'} />
              <Input label="Minimum notice (hours)" type="number" min={0} max={720} value={form.minNoticeHours} onChange={(e) => setForm({ ...form, minNoticeHours: e.target.value })} hint="Learners can’t book or cancel later than this before a session." />
              <Input label="Break between sessions (minutes)" type="number" min={0} max={240} value={form.bufferMin} onChange={(e) => setForm({ ...form, bufferMin: e.target.value })} />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-fg">Weekly hours</p>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {WEEKDAYS.map((name, wd) => {
                  const rows = form.hours.map((h, i) => ({ ...h, i })).filter((h) => h.weekday === wd);
                  return (
                    <li key={wd} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start">
                      <span className="w-28 pt-1.5 text-sm font-medium">{name}</span>
                      <div className="flex-1 space-y-2">
                        {!rows.length && <p className="pt-1.5 text-sm text-muted">Unavailable</p>}
                        {rows.map((h) => (
                          <div key={h.i} className="flex items-center gap-2">
                            <input type="time" aria-label={`${name} start`} value={toHM(h.startMinute)} onChange={(e) => setHour(h.i, { startMinute: fromHM(e.target.value) })} className="h-9 rounded-md border border-line bg-surface px-2 text-sm" />
                            <span className="text-muted">–</span>
                            <input type="time" aria-label={`${name} end`} value={toHM(Math.min(h.endMinute, 1439))} onChange={(e) => setHour(h.i, { endMinute: fromHM(e.target.value) })} className="h-9 rounded-md border border-line bg-surface px-2 text-sm" />
                            <Button size="sm" variant="ghost" aria-label={`Remove ${name} hours`} onClick={() => setForm((f) => ({ ...f, hours: f.hours.filter((_, j) => j !== h.i) }))}>×</Button>
                          </div>
                        ))}
                      </div>
                      <Button size="sm" variant="ghost" leftIcon={Plus} aria-label={`Add ${name} hours`} onClick={() => setForm((f) => ({ ...f, hours: [...f.hours, { weekday: wd, startMinute: 540, endMinute: 1020 }] }))}>Add</Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>}
          <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
        </div>
      )}
    </div>
  );
}

