import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, CalendarClock, Copy, Download, ExternalLink, Plug, Plus, Radio, Users, Video } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, Field, Input, Modal, SegmentedControl, Select, Skeleton, StatusBadge, Tabs, Textarea, toast } from '../../components/ui/index.js';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import { batchesApi, creatorLiveApi } from '../../services/api/live.js';
import { coursesApi } from '../../services/api/creator.js';
import { workspaceApi } from '../../services/api/auth.js';
import { PLATFORM_ROOT } from '../../utils/host.js';
import { applyApiErrors } from '../../utils/forms.js';
import { saveBlob } from '../../utils/download.js';
import { formatDate, formatMoney } from '../../utils/format.js';
import { openClassroom, opensByUrl, providerLabel } from '../live/openClassroom.js';
import { FileUpload } from '../../components/forms/FileUpload.jsx';

const DAYS = [['MO', 'Mon'], ['TU', 'Tue'], ['WE', 'Wed'], ['TH', 'Thu'], ['FR', 'Fri'], ['SA', 'Sat'], ['SU', 'Sun']];
const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

const schema = z
  .object({
    kind: z.enum(['CLASS', 'WEBINAR']),
    title: z.string().trim().min(1, 'Give it a title').max(200),
    description: z.string().max(2000).optional(),
    provider: z.enum(['PLUGNMEET', 'LIVEKIT', 'ZOOM', 'GOOGLE_MEET', 'EXTERNAL']),
    externalUrl: z.string().trim().optional(),
    audience: z.enum(['COURSE', 'BATCH', 'ALL_STUDENTS', 'REGISTRANTS']),
    courseId: z.string().optional(),
    batchId: z.string().optional(),
    startsAt: z.string().min(1, 'Choose a start time'),
    durationMinutes: z.coerce.number().int().min(5).max(600),
    repeat: z.boolean(),
    byDay: z.array(z.string()),
    endMode: z.enum(['count', 'until']),
    count: z.coerce.number().int().min(1).max(200),
    until: z.string().optional(),
    capacity: z.union([z.literal(''), z.coerce.number().int().min(1).max(1000)]),
    waitingRoom: z.boolean(),
    recordSessions: z.boolean(),
    notifyLearners: z.boolean(),
    priceAmount: z.union([z.literal(''), z.coerce.number().min(0).max(10_000_000)]),
  })
  .refine((v) => v.provider !== 'EXTERNAL' || /^https:\/\//i.test(v.externalUrl ?? ''), { path: ['externalUrl'], message: 'Paste your Zoom, Google Meet or Teams link (https://…)' })
  .refine((v) => v.audience !== 'COURSE' || v.courseId, { path: ['courseId'], message: 'Choose a course' })
  .refine((v) => v.audience !== 'BATCH' || v.batchId, { path: ['batchId'], message: 'Choose a batch' })
  .refine((v) => !v.repeat || v.byDay.length > 0, { path: ['byDay'], message: 'Pick at least one day' })
  .refine((v) => !v.repeat || v.endMode === 'count' || v.until, { path: ['until'], message: 'Choose an end date' });

function ScheduleForm({ kind, providers, onDone }) {
  const [cover, setCover] = useState(null);
  const courses = useQuery({ queryKey: ['creator', 'courses', 'all'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const batches = useQuery({ queryKey: ['creator', 'batches'], queryFn: batchesApi.list });
  const navigate = useNavigate();
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      kind, title: '', description: '', provider: providers.plugnmeet ? 'PLUGNMEET' : providers.livekit ? 'LIVEKIT' : 'EXTERNAL', externalUrl: '', audience: kind === 'WEBINAR' ? 'REGISTRANTS' : 'ALL_STUDENTS', courseId: '', batchId: '',
      startsAt: toLocalInput(new Date(Date.now() + 24 * 3600_000)), durationMinutes: 60, repeat: false, byDay: [], endMode: 'count', count: 8, until: '', capacity: '', waitingRoom: false, recordSessions: false, notifyLearners: false, priceAmount: '',
    },
  });
  const { register, watch, setValue, formState: { errors, isSubmitting } } = form;
  const v = watch();
  const choices = [
    ...(providers.plugnmeet ? [{ value: 'PLUGNMEET', label: 'plugNmeet classroom', hint: kind === 'WEBINAR' ? 'Video, screen share, chat, polls, Q&A; attendees watch' : 'Video, whiteboard, screen share, chat, polls, breakout rooms' }] : []),
    ...(providers.livekit || !providers.plugnmeet ? [{ value: 'LIVEKIT', label: 'Built-in classroom', hint: providers.livekit ? 'Video, screen share, chat, polls, attendance' : 'Not set up on this platform yet', disabled: !providers.livekit }] : []),
    ...(providers.zoom || providers.zoomAvailable ? [{ value: 'ZOOM', label: 'Zoom', hint: providers.zoom ? 'Meetings created in your Zoom account; attendance and cloud recordings come back here' : 'Connect your Zoom account in Live → Integrations', disabled: !providers.zoom }] : []),
    ...(providers.googleMeet || providers.googleMeetAvailable ? [{ value: 'GOOGLE_MEET', label: 'Google Meet', hint: providers.googleMeet ? 'A Meet link is created in your Google Calendar for each session' : 'Connect your Google account in Live → Integrations', disabled: !providers.googleMeet }] : []),
    { value: 'EXTERNAL', label: 'Meeting link', hint: 'Paste any Zoom, Meet or Teams link' },
  ];
  const canRecord = v.provider === 'ZOOM' ? true : v.provider === 'PLUGNMEET' ? providers.plugnmeetRecording : providers.livekitRecording ?? providers.recording;
  const submit = form.handleSubmit(async (x) => {
    try {
      const body = {
        kind: x.kind, title: x.title, description: x.description || null, provider: x.provider, externalUrl: x.provider === 'EXTERNAL' ? x.externalUrl : undefined,
        audience: x.audience, courseId: x.audience === 'COURSE' ? x.courseId : undefined, batchId: x.audience === 'BATCH' ? x.batchId : undefined,
        startsAt: new Date(x.startsAt).toISOString(), durationMinutes: x.durationMinutes, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        recurrence: x.repeat ? { freq: 'WEEKLY', byDay: x.byDay, ...(x.endMode === 'count' ? { count: x.count } : { until: x.until }) } : null,
        capacity: x.capacity === '' ? null : x.capacity, ...(x.kind === 'WEBINAR' && x.priceAmount !== '' && Number(x.priceAmount) > 0 ? { priceAmount: Number(x.priceAmount) } : {}), waitingRoom: !['EXTERNAL', 'GOOGLE_MEET'].includes(x.provider) && x.waitingRoom, recordSessions: !['EXTERNAL', 'GOOGLE_MEET'].includes(x.provider) && x.recordSessions,
        coverFileId: cover?.id, notifyLearners: x.notifyLearners,
      };
      const created = await creatorLiveApi.create(body);
      toast.success(kind === 'WEBINAR' ? 'Webinar published' : 'Live class scheduled');
      navigate(`/creator/live/${created.id}`);
    } catch (e) {
      applyApiErrors(e, form.setError, ['coverFileId', 'priceAmount', 'title', 'provider', 'externalUrl', 'courseId', 'batchId', 'startsAt', 'recurrence', 'recordSessions', 'waitingRoom', 'audience', 'timezone']);
    }
  });
  const isWebinar = kind === 'WEBINAR';
  return (
    <form onSubmit={submit} noValidate className="-mx-4 -my-6 sm:-mx-6 lg:-mx-8">
      <div className="sticky top-14 z-20 flex items-center justify-between gap-4 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" aria-label="Back to live classes" onClick={onDone}><ArrowLeft className="size-4" /></Button>
          <h1 className="text-lg font-semibold tracking-tight">{isWebinar ? 'Create a webinar' : 'Schedule a live class'}</h1>
        </div>
        <Button type="submit" loading={isSubmitting}>Publish</Button>
      </div>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card className="space-y-5 p-6">
            <Input label={isWebinar ? 'Webinar title' : 'Title'} {...register('title')} error={errors.title?.message} required autoFocus />
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
              <Input label={isWebinar ? 'Webinar date' : 'Starts'} type="datetime-local" {...register('startsAt')} error={errors.startsAt?.message} hint="Students can join 10 minutes before the start time." required />
              <Field label="Duration" required error={errors.durationMinutes?.message}>
                {(p) => (
                  <div className="flex rounded-md border border-line bg-surface focus-within:ring-2 focus-within:ring-primary-500">
                    <input {...p} type="number" min={5} max={600} {...register('durationMinutes')} className="h-10 min-w-0 flex-1 rounded-l-md bg-transparent px-3 text-sm focus:outline-none" />
                    <span className="grid place-items-center rounded-r-md border-l border-line bg-surface-2/60 px-3 text-sm text-muted">Minutes</span>
                  </div>
                )}
              </Field>
            </div>
            <Textarea label={isWebinar ? 'Webinar description' : 'Description'} rows={5} {...register('description')} placeholder="What will you cover? Who should attend?" />
          </Card>

          <Card className="space-y-4 p-6">
            <div><h2 className="font-semibold">Where it happens</h2><p className="text-sm text-muted">Pick the classroom students join from.</p></div>
            <Field label="Classroom">
              {() => (
                <div className={`grid gap-2 ${choices.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                  {choices.map((o) => (
                    <label key={o.value} className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ${v.provider === o.value ? 'border-primary-500 ring-1 ring-primary-500' : 'border-line'} ${o.disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
                      <input type="radio" value={o.value} disabled={o.disabled} {...register('provider')} className="mt-1" />
                      <span><span className="font-medium">{o.label}</span><span className="block text-xs text-muted">{o.hint}</span></span>
                    </label>
                  ))}
                </div>
              )}
            </Field>
            {v.provider === 'EXTERNAL' && <Input label="Meeting link" placeholder="https://zoom.us/j/…" {...register('externalUrl')} error={errors.externalUrl?.message} />}
            {v.provider === 'GOOGLE_MEET' && <p className="text-xs text-muted">Google Meet handles admission and recording itself (recordings are saved to your Google Drive). Students join with the link; joins are recorded as clicks.</p>}
          </Card>

          <Card className="space-y-4 p-6">
            <h2 className="font-semibold">{isWebinar ? 'Registration' : 'Audience & schedule'}</h2>
            {!isWebinar && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Who can attend" {...register('audience')} options={[{ value: 'ALL_STUDENTS', label: 'All my students' }, { value: 'COURSE', label: 'Students of a course' }, { value: 'BATCH', label: 'A batch' }]} />
                {v.audience === 'COURSE' && <Select label="Course" placeholder="Choose" {...register('courseId')} error={errors.courseId?.message} options={(courses.data?.items ?? []).map((c) => ({ value: c.id, label: c.title }))} />}
                {v.audience === 'BATCH' && <Select label="Batch" placeholder="Choose" {...register('batchId')} error={errors.batchId?.message} options={(batches.data ?? []).map((b) => ({ value: b.id, label: b.name }))} />}
              </div>
            )}
            <Checkbox label="Repeats weekly" {...register('repeat')} />
            {v.repeat && (
              <div className="space-y-3 rounded-lg border border-line p-3">
                <div className="flex flex-wrap gap-1.5">{DAYS.map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={v.byDay.includes(k)} onClick={() => setValue('byDay', v.byDay.includes(k) ? v.byDay.filter((x) => x !== k) : [...v.byDay, k], { shouldValidate: true })}
                    className={`h-8 rounded-md border px-3 text-sm ${v.byDay.includes(k) ? 'border-primary-600 bg-primary-600 text-on-primary' : 'border-line'}`}>{label}</button>
                ))}</div>
                {errors.byDay && <p className="text-xs text-red-600">{errors.byDay.message}</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select label="Ends" {...register('endMode')} options={[{ value: 'count', label: 'After a number of sessions' }, { value: 'until', label: 'On a date' }]} />
                  {v.endMode === 'count' ? <Input label="Sessions" type="number" min={1} max={200} {...register('count')} /> : <Input label="Last date" type="date" {...register('until')} error={errors.until?.message} />}
                </div>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label={isWebinar ? 'Seats' : 'Capacity'} type="number" min={1} placeholder="No limit" {...register('capacity')} />
              {isWebinar && <Input label="Ticket price" type="number" min={0} step="0.01" placeholder="Free" hint="Leave empty for a free webinar. Paid tickets are sold through your Razorpay account." {...register('priceAmount')} error={errors.priceAmount?.message} />}
            </div>
          </Card>

          <Card className="space-y-3 p-6">
            <h2 className="font-semibold">Settings</h2>
            <Checkbox label="Notify learners via email" description={isWebinar ? 'Tell all your students about this webinar once it’s published.' : 'Tell the students who can attend that this class was scheduled.'} {...register('notifyLearners')} />
            {!['EXTERNAL', 'GOOGLE_MEET'].includes(v.provider) && (
              <>
                <Checkbox label="Waiting room" description={v.provider === 'PLUGNMEET' ? 'You let each participant in from inside the classroom.' : 'You admit each participant before they can see and hear the class.'} {...register('waitingRoom')} />
                <Checkbox label="Record sessions" description={!canRecord ? 'Needs S3 storage on this platform.' : v.provider === 'ZOOM' ? 'Zoom cloud recording (paid Zoom plans); the recording is added to your video library after the meeting.' : v.provider === 'PLUGNMEET' ? 'Recorded automatically; the recording is added to your video library after the session.' : 'Recordings are added to your video library.'} disabled={!canRecord} {...register('recordSessions')} />
                {errors.recordSessions && <p className="text-xs text-red-600">{errors.recordSessions.message}</p>}
              </>
            )}
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-32 lg:self-start">
          <Card className="space-y-3 p-5">
            <div><h2 className="font-semibold">Cover image</h2><p className="text-xs text-muted">At least 752 × 408 px. Shown on the {isWebinar ? 'registration page and ' : ''}live list.</p></div>
            {cover?.url ? (
              <div className="space-y-2">
                <img src={cover.url} alt="Cover preview" className="aspect-video w-full rounded-lg border border-line object-cover" />
                <Button variant="secondary" size="sm" onClick={() => setCover(null)}>Remove</Button>
              </div>
            ) : (
              <FileUpload purpose="IMAGE" accept="image/png,image/jpeg,image/webp" hint="PNG, JPG or WebP, up to 10 MB" onUploaded={setCover} />
            )}
            {errors.coverFileId && <p className="text-xs text-red-600">{errors.coverFileId.message}</p>}
          </Card>
        </aside>
      </div>
    </form>
  );
}

/** Full-page create (Graphy "Create a webinar" layout): /creator/live/new?kind=WEBINAR|CLASS */
export function LiveClassCreatePage() {
  const [params] = useSearchParams();
  const kind = params.get('kind') === 'WEBINAR' ? 'WEBINAR' : 'CLASS';
  const navigate = useNavigate();
  const providers = useQuery({ queryKey: ['creator', 'live', 'providers'], queryFn: creatorLiveApi.providers });
  useEffect(() => { document.title = `${kind === 'WEBINAR' ? 'Create a webinar' : 'Schedule a live class'} · Creator Education`; }, [kind]);
  if (providers.isError) return <Card><ErrorState error={providers.error} onRetry={() => providers.refetch()} /></Card>;
  if (!providers.data) return <Skeleton className="h-96" />;
  return (
    <>
      {!providers.data.livekit && !providers.data.plugnmeet && <Alert tone="info" className="mb-4">The built-in classroom isn't set up on this platform yet — you can still schedule classes with a Zoom, Meet or Teams link.</Alert>}
      <ScheduleForm kind={kind} providers={providers.data} onDone={() => navigate('/creator/live')} />
    </>
  );
}

const AUDIENCE = { ALL_STUDENTS: 'All students', COURSE: 'Course students', BATCH: 'Batch', REGISTRANTS: 'Registrants' };
const dayLabel = (d) => { const x = new Date(d); return `${x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} (${x.toLocaleDateString('en-IN', { weekday: 'short' })})`; };
const timeLabel = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

/** Which list a class belongs in: live right now, still has sessions ahead, or finished. */
export function liveBucket(c) {
  if (c.nextSession?.status === 'LIVE') return 'live';
  if (c.status === 'ACTIVE' && c.nextSession) return 'upcoming';
  return 'past';
}

function SessionWhen({ c }) {
  const s = c.nextSession ?? c.lastSession;
  if (!s) return <span className="text-muted">No sessions</span>;
  return <div className="leading-tight"><p className="text-fg-2">{dayLabel(s.startsAt)}</p><p className="text-xs text-muted">{timeLabel(s.startsAt)}</p></div>;
}

function LiveStatus({ c }) {
  const b = liveBucket(c);
  if (b === 'live') return <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-400"><span className="size-1.5 animate-pulse rounded-full bg-red-500" aria-hidden />Live now</span>;
  if (c.status !== 'ACTIVE') return <StatusBadge status={c.status} />;
  return b === 'upcoming' ? <Badge tone="info">Upcoming</Badge> : <Badge>Completed</Badge>;
}

/** Webinar tile: cover with duration and price chips, title and date. */
function WebinarCard({ c, onOpen }) {
  const s = c.nextSession ?? c.lastSession;
  return (
    <button type="button" onClick={onOpen} className="group text-left">
      <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-md">
        <div className="relative grid aspect-video place-items-center bg-gradient-to-br from-primary-600 via-primary-500 to-primary-400 text-white/90">
          <Radio className="size-10" aria-hidden />
          <span className="absolute top-3 left-3 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">{c.durationMinutes} min</span>
          <span className="absolute top-3 right-3 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-fg">{c.priceAmount ? formatMoney(c.priceAmount, c.currency) : 'Free'}</span>
          {liveBucket(c) === 'live' && <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white"><span className="size-1.5 animate-pulse rounded-full bg-white" aria-hidden />Live now</span>}
        </div>
        <div className="space-y-1 p-4">
          <p className="line-clamp-2 font-semibold text-fg group-hover:text-primary-700">{c.title}</p>
          <p className="text-sm text-muted">{s ? `${dayLabel(s.startsAt)} · ${timeLabel(s.startsAt)}` : 'No sessions'}{c.recurrence ? ' · weekly' : ''}</p>
          <p className="text-xs text-muted">{providerLabel(c.provider)}</p>
        </div>
      </Card>
    </button>
  );
}

const WHEN = [{ value: 'upcoming', label: 'Upcoming' }, { value: 'live', label: 'Live now' }, { value: 'past', label: 'Past' }];
const EMPTY = {
  upcoming: (w) => ({ title: w ? 'No upcoming webinars' : 'No upcoming classes', body: w ? 'Run a free or paid webinar with a public registration page.' : 'Schedule a one-off or weekly class for your students.' }),
  live: () => ({ title: 'Nothing is live right now', body: 'Sessions show here while they are running.' }),
  past: (w) => ({ title: w ? 'No past webinars yet' : 'No past classes yet', body: 'Finished sessions, attendance and recordings appear here.' }),
};

export function LiveClassesPage() {
  const [kind, setKind] = useState('CLASS');
  const [when, setWhen] = useState('upcoming');
  const [search, setSearch] = useState('');
  const providers = useQuery({ queryKey: ['creator', 'live', 'providers'], queryFn: creatorLiveApi.providers });
  const q = useQuery({ queryKey: ['creator', 'live', 'classes'], queryFn: () => creatorLiveApi.classes() });
  const navigate = useNavigate();
  const all = q.data ?? [];
  const ofKind = all.filter((c) => c.kind === kind);
  const term = search.trim().toLowerCase();
  const rows = ofKind.filter((c) => liveBucket(c) === when && (!term || c.title.toLowerCase().includes(term)));
  const isWebinar = kind === 'WEBINAR';
  const empty = EMPTY[when](isWebinar);
  const createButton = () => <Button leftIcon={Plus} onClick={() => navigate(`/creator/live/new?kind=${kind}`)}>{isWebinar ? 'New webinar' : 'Schedule class'}</Button>;
  return (
    <>
      <PageHeader title={isWebinar ? 'Webinars' : 'Live classes'} count={q.data ? ofKind.length : undefined} description="Teach live in the built-in classroom or with your own Zoom or Google Meet account." breadcrumbs={[{ label: 'Live' }]}
        actions={<><Button variant="secondary" leftIcon={Plug} onClick={() => navigate('/creator/integrations')}>Integrations</Button>{createButton()}</>} />
      {providers.data && !providers.data.livekit && !providers.data.plugnmeet && <Alert tone="info" className="mb-4">The built-in classroom isn't set up on this platform yet — you can still schedule classes with a Zoom, Meet or Teams link.</Alert>}
      <Tabs className="mb-5" value={kind} onChange={(k) => { setKind(k); setWhen('upcoming'); }} tabs={[{ value: 'CLASS', label: 'Classes', count: q.data ? all.filter((c) => c.kind === 'CLASS').length : undefined }, { value: 'WEBINAR', label: 'Webinars', count: q.data ? all.filter((c) => c.kind === 'WEBINAR').length : undefined }]} />
      <Card className="mb-5 flex flex-col gap-3 p-3 md:flex-row md:items-center">
        <SearchInput className="md:flex-1" value={search} onChange={setSearch} placeholder="Search by title" />
        <SegmentedControl label="Show" value={when} onChange={setWhen} options={WHEN.map((w) => ({ ...w, label: `${w.label}${q.data ? ` · ${ofKind.filter((c) => liveBucket(c) === w.value).length}` : ''}` }))} />
      </Card>
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
        : q.isLoading ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />)}</div>
        : rows.length === 0 ? <Card><EmptyState icon={isWebinar ? Radio : CalendarClock} title={term ? 'No matches' : empty.title} description={term ? 'Try a different title.' : empty.body} /></Card>
        : isWebinar ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{rows.map((c) => <WebinarCard key={c.id} c={c} onOpen={() => navigate(`/creator/live/${c.id}`)} />)}</div>
        ) : (
          <Card>
            <DataTable rows={rows} onRowClick={(r) => navigate(`/creator/live/${r.id}`)}
              columns={[
                { key: 'title', header: 'Class', cell: (r) => <div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300"><Video className="size-4" aria-hidden /></span><div className="min-w-0"><p className="truncate font-medium text-fg">{r.title}</p><p className="text-xs text-muted">{providerLabel(r.provider)}{r.recurrence ? ' · weekly' : ''}</p></div></div> },
                { key: 'audience', header: 'Audience', cell: (r) => AUDIENCE[r.audience] ?? r.audience },
                { key: 'when', header: when === 'past' ? 'Last session' : 'Next session', cell: (r) => <SessionWhen c={r} /> },
                { key: 'durationMinutes', header: 'Duration', cell: (r) => `${r.durationMinutes} min` },
                { key: 'status', header: 'Status', cell: (r) => <LiveStatus c={r} /> },
              ]} />
          </Card>
        )}
    </>
  );
}

function AttendanceDrawer({ sessionId, onClose }) {
  const q = useQuery({ queryKey: ['creator', 'live', 'attendance', sessionId], queryFn: () => creatorLiveApi.attendance(sessionId), enabled: Boolean(sessionId) });
  const csv = useMutation({ mutationFn: () => creatorLiveApi.attendanceCsv(sessionId).then((b) => saveBlob(b, `attendance-${sessionId}.csv`)), onError: (e) => toast.error(e.message) });
  return (
    <Drawer open={Boolean(sessionId)} onClose={onClose} title="Attendance">
      {!q.data ? <Skeleton className="h-40" /> : (
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between"><p className="text-muted">{q.data.people.length} participant{q.data.people.length === 1 ? '' : 's'}</p><Button size="sm" variant="secondary" leftIcon={Download} loading={csv.isPending} onClick={() => csv.mutate()}>CSV</Button></div>
          {q.data.people.length === 0 ? <p className="text-muted">Nobody joined.</p> : (
            <ul className="divide-y divide-line">{q.data.people.map((p) => (
              <li key={p.identity} className="flex items-center justify-between gap-3 py-2">
                <div><p className="font-medium">{p.name} {p.role === 'host' && <Badge>Host</Badge>}</p><p className="text-xs text-muted">Joined {formatDate(p.firstJoinedAt, { withTime: true })}</p></div>
                <span className="tabular-nums text-muted">{p.seconds === null ? 'Opened link' : `${Math.round(p.seconds / 60)} min · ${p.percent}%`}</span>
              </li>
            ))}</ul>
          )}
        </div>
      )}
    </Drawer>
  );
}

export function LiveClassDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const ws = useQuery({ queryKey: ['creator', 'workspace'], queryFn: workspaceApi.workspace });
  const navigate = useNavigate();
  const [attendance, setAttendance] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const q = useQuery({ queryKey: ['creator', 'live', 'class', id], queryFn: () => creatorLiveApi.get(id) });
  const set = (d) => qc.setQueryData(['creator', 'live', 'class', id], d);
  const cancelSession = useMutation({ mutationFn: creatorLiveApi.cancelSession, onSuccess: (d) => { set(d); toast.success('Session cancelled'); }, onError: (e) => toast.error(e.message) });
  const cancel = useMutation({ mutationFn: () => creatorLiveApi.cancel(id), onSuccess: (d) => { set(d); setConfirmCancel(false); toast.success('Cancelled'); }, onError: (e) => toast.error(e.message) });
  const hostSession = useMutation({
    mutationFn: creatorLiveApi.host,
    onSuccess: (r, sessionId) => (opensByUrl(r) ? openClassroom(r) : navigate(`/creator/live/sessions/${sessionId}/room`)),
    onError: (e) => toast.error(e.message),
  });
  const recording = useMutation({ mutationFn: creatorLiveApi.recording, onSuccess: (r) => window.open(r.url, '_blank', 'noopener'), onError: (e) => toast.error(e.message) });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const c = q.data;
  if (!c) return <Skeleton className="h-96" />;
  const host = ws.data?.primaryHostname;
  const publicUrl = c.slug && host ? `${host.endsWith(PLATFORM_ROOT) ? window.location.protocol : 'https:'}//${host}${host.endsWith(PLATFORM_ROOT) && window.location.port ? `:${window.location.port}` : ''}/webinars/${c.slug}` : null;
  return (
    <>
      <PageHeader title={c.title} description={c.description ?? undefined} breadcrumbs={[{ label: 'Live', to: '/creator/live' }, { label: c.title }]}
        actions={c.status === 'ACTIVE' && <Button variant="ghost" className="text-red-600" onClick={() => setConfirmCancel(true)}>Cancel {c.kind === 'WEBINAR' ? 'webinar' : 'class'}</Button>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="Sessions" description={c.recurrence ? 'Weekly — upcoming sessions are added automatically.' : undefined} />
          <CardBody className="divide-y divide-line p-0">
            {c.sessions.map((s) => {
              const startsIn = new Date(s.startsAt).getTime() - Date.now();
              const canHost = c.status === 'ACTIVE' && (s.status === 'LIVE' || (s.status === 'SCHEDULED' && startsIn < 30 * 60_000 && new Date(s.endsAt).getTime() > Date.now() - 3 * 3600_000));
              return (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="flex items-center gap-3"><CalendarClock className="size-4 text-muted" /><div><p className="font-medium">{formatDate(s.startsAt, { withTime: true })}</p><p className="text-xs text-muted">{c.durationMinutes} min{s.recordingStatus !== 'NONE' ? ` · recording ${s.recordingStatus.toLowerCase()}` : ''}</p></div></div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={s.status} />
                    {canHost && <Button size="sm" leftIcon={s.status === 'LIVE' ? Radio : Video} loading={hostSession.isPending && hostSession.variables === s.id} onClick={() => hostSession.mutate(s.id)}>{s.status === 'LIVE' ? 'Rejoin' : 'Start'}</Button>}
                    {s.status === 'SCHEDULED' && !canHost && <Button size="sm" variant="ghost" onClick={() => cancelSession.mutate(s.id)}>Cancel</Button>}
                    {s.status !== 'SCHEDULED' && s.status !== 'CANCELLED' && <Button size="sm" variant="secondary" leftIcon={Users} onClick={() => setAttendance(s.id)}>Attendance</Button>}
                    {s.recordingStatus === 'READY' && <Button size="sm" variant="ghost" leftIcon={ExternalLink} onClick={() => recording.mutate(s.id)}>Recording</Button>}
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="space-y-2 text-sm">
              <p><span className="text-muted">Classroom:</span> {providerLabel(c.provider)}</p>
              {c.externalUrl && <p className="break-all"><span className="text-muted">Link:</span> <a className="text-primary-600 underline" href={c.externalUrl} target="_blank" rel="noreferrer noopener">{c.externalUrl}</a></p>}
              <p><span className="text-muted">Time zone:</span> {c.timezone}</p>
              {c.capacity && <p><span className="text-muted">Capacity:</span> {c.capacity}</p>}
              {c.priceAmount && <p><span className="text-muted">Ticket price:</span> {formatMoney(c.priceAmount, c.currency)}</p>}
              {c.waitingRoom && <p>Waiting room on</p>}
            </CardBody>
          </Card>
          {c.kind === 'WEBINAR' && (
            <Card>
              <CardHeader title="Registration" description={`${c.registrations} registered`} />
              <CardBody className="space-y-2 text-sm">
                <p className="text-muted">Share this page. Registrants get a personal join link by email.</p>
                {publicUrl && <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 p-2"><code className="flex-1 break-all text-xs">{publicUrl}</code><Button size="icon-sm" variant="ghost" aria-label="Copy link" onClick={() => navigator.clipboard?.writeText(publicUrl).then(() => toast.success('Copied'))}><Copy className="size-3.5" /></Button></div>}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
      <AttendanceDrawer sessionId={attendance} onClose={() => setAttendance(null)} />
      <ConfirmDialog open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Cancel all upcoming sessions?" description="Students will no longer see them. Past sessions and attendance are kept." confirmLabel="Cancel sessions" loading={cancel.isPending} onConfirm={() => cancel.mutate()} />
    </>
  );
}
