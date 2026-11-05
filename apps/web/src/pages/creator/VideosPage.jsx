import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Film, Info, Link2, Pencil, Play, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, ConfirmDialog, DataTable, Drawer, Dropdown, DropdownItem, EmptyState, Input, Modal, Select, Skeleton, StatusBadge, toast } from '../../components/ui/index.js';
import { readVideoDuration, uploadVideo, videosApi } from '../../services/api/videos.js';
import { startTusUpload } from '../../services/api/tusUpload.js';
import { coursesApi } from '../../services/api/creator.js';
import { formatDate } from '../../utils/format.js';

export const fmtDuration = (s) => (s ? `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${Math.floor((s % 3600) / 60)}:${String(s % 60).padStart(2, '0')}` : '—');
export const fmtSize = (b) => (!b ? '—' : b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${Math.round(b / 1024 ** 2)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const STATUS_LABEL = { CREATED: 'Created', UPLOAD_AUTHORIZED: 'Waiting for upload', UPLOADING: 'Uploading', UPLOADED: 'Uploaded', PROCESSING: 'Processing', READY: 'Ready', FAILED: 'Failed', DELETING: 'Deleting', DELETED: 'Deleted' };
const STATUS_TONE = { UPLOAD_AUTHORIZED: 'PENDING', UPLOADING: 'PROCESSING', UPLOADED: 'PROCESSING', PROCESSING: 'PROCESSING', DELETING: 'PENDING', CREATED: 'PENDING' };
const IN_FLIGHT = new Set(['UPLOAD_AUTHORIZED', 'UPLOADING', 'UPLOADED', 'PROCESSING', 'DELETING']);
const BACKUP_LABEL = { PENDING: 'Queued', IN_PROGRESS: 'Backing up', RETRYING: 'Retrying', COMPLETED: 'Backed up', FAILED: 'Backup failed' };

export function VideoStatus({ status, progress }) {
  return (
    <span className="inline-flex items-center gap-2">
      <StatusBadge status={STATUS_TONE[status] ?? status} label={STATUS_LABEL[status] ?? status} />
      {status === 'PROCESSING' && Number.isFinite(progress) && progress > 0 && <span className="text-xs text-muted tabular-nums">{progress}%</span>}
    </span>
  );
}

function BackupStatus({ backup }) {
  if (!backup) return <span className="text-xs text-muted">—</span>;
  const tone = backup.status === 'COMPLETED' ? 'success' : backup.status === 'FAILED' ? 'danger' : 'warning';
  return <span title={backup.errorMessage ?? undefined}><Badge tone={tone}>{BACKUP_LABEL[backup.status] ?? backup.status}</Badge></span>;
}

function Preview({ id, onClose }) {
  const q = useQuery({ queryKey: ['video-preview', id], queryFn: () => videosApi.preview(id), enabled: Boolean(id), retry: false });
  return (
    <Modal open={Boolean(id)} onClose={onClose} title="Preview" size="xl">
      {q.isLoading ? <Skeleton className="aspect-video w-full" /> : q.isError ? <Alert tone="error">{q.error.message}</Alert> : q.data && (
        q.data.kind === 'iframe'
          ? <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black"><iframe title="Video preview" src={q.data.url} className="absolute inset-0 size-full" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>
          : <video controls autoPlay src={q.data.url} className="aspect-video w-full rounded-lg bg-black" />
      )}
    </Modal>
  );
}

// ── Upload queue ─────────────────────────────────────────────

let seq = 0;
function useUploads(config, onChanged) {
  const [items, setItems] = useState([]);
  const handles = useRef(new Map());
  const patch = useCallback((key, p) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...(typeof p === 'function' ? p(i) : p) } : i))), []);

  const validate = (file) => {
    if (!config) return null;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!config.extensions.includes(ext) && !config.mimeTypes.includes(file.type)) return `Unsupported format (.${ext}). Use ${config.extensions.join(', ')}.`;
    if (file.size > config.maxUploadBytes) return `Larger than the ${fmtSize(config.maxUploadBytes)} limit`;
    if (!file.size) return 'The file is empty';
    return null;
  };

  const run = useCallback(async (item, videoId) => {
    const { key, file } = item;
    try {
      if (config?.provider !== 'BUNNY') {
        patch(key, { phase: 'uploading', progress: 0, error: null });
        const duration = await readVideoDuration(file);
        const f = await uploadVideo(file, (p) => patch(key, { progress: p }));
        await videosApi.create({ fileId: f.id, title: item.title, durationSeconds: duration ?? undefined });
        patch(key, { phase: 'ready', progress: 100 });
        onChanged();
        return;
      }
      patch(key, { phase: 'authorizing', progress: 0, error: null });
      const init = await videosApi.initiate({ title: item.title, filename: file.name, size: file.size, mimeType: file.type || 'video/mp4', courseId: item.courseId || undefined, videoId: videoId ?? undefined });
      patch(key, { videoId: init.videoId, sessionId: init.uploadSessionId, phase: 'uploading' });
      onChanged();
      const h = startTusUpload(file, init.upload, {
        onProgress: (p) => patch(key, { progress: p }),
        onStart: () => videosApi.complete({ videoId: init.videoId, uploadSessionId: init.uploadSessionId, outcome: 'started' }).catch(() => {}),
      });
      handles.current.set(key, { ...h, videoId: init.videoId, sessionId: init.uploadSessionId });
      await h.promise;
      patch(key, { phase: 'confirming', progress: 100 });
      const v = await videosApi.complete({ videoId: init.videoId, uploadSessionId: init.uploadSessionId, outcome: 'success' });
      patch(key, { phase: 'processing', status: v.status });
      onChanged();
    } catch (e) {
      const h = handles.current.get(key);
      if (h?.cancelled) return;
      patch(key, { phase: 'failed', error: e.details?.[0]?.message ?? e.message });
      if (h?.videoId) videosApi.complete({ videoId: h.videoId, uploadSessionId: h.sessionId, outcome: 'failed', error: e.message }).catch(() => {});
      onChanged();
    }
  }, [config, onChanged, patch]);

  const add = (files, courseId) => {
    for (const file of files) {
      const error = validate(file);
      const item = { key: ++seq, file, title: file.name.replace(/\.[^.]+$/, '').slice(0, 200), courseId, phase: error ? 'invalid' : 'queued', progress: 0, error };
      setItems((l) => [item, ...l]);
      if (!error) run(item);
    }
  };
  const cancel = (item) => {
    const h = handles.current.get(item.key);
    if (h) {
      h.cancelled = true;
      h.abort();
      videosApi.complete({ videoId: h.videoId, uploadSessionId: h.sessionId, outcome: 'cancelled' }).catch(() => {});
    }
    patch(item.key, { phase: 'cancelled' });
  };
  const retry = (item) => run(item, item.videoId);
  const dismiss = (item) => setItems((l) => l.filter((i) => i.key !== item.key));

  // Follow processing until the provider reports a final state.
  useEffect(() => {
    const waiting = items.filter((i) => i.phase === 'processing' && i.videoId);
    if (!waiting.length) return undefined;
    const t = setInterval(async () => {
      for (const i of waiting) {
        const s = await videosApi.status(i.videoId).catch(() => null);
        if (!s) continue;
        if (s.status === 'READY') { patch(i.key, { phase: 'ready', status: s.status }); onChanged(); }
        else if (s.status === 'FAILED') { patch(i.key, { phase: 'failed', status: s.status, error: s.errorMessage }); onChanged(); }
        else patch(i.key, { status: s.status, encodeProgress: s.encodeProgress });
      }
    }, 5000);
    return () => clearInterval(t);
  }, [items, onChanged, patch]);

  return { items, add, cancel, retry, dismiss };
}

const PHASE_TEXT = { queued: 'Queued', authorizing: 'Preparing…', uploading: 'Uploading', confirming: 'Confirming with the video host…', processing: 'Processing', ready: 'Ready', failed: 'Failed', cancelled: 'Cancelled', invalid: 'Not uploaded' };

function UploadPanel({ config, uploads, courses }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [courseId, setCourseId] = useState('');
  const onFiles = (list) => list?.length && uploads.add([...list], courseId);
  return (
    <Card className="mb-6 p-5">
      <div
        role="button" tabIndex={0} aria-label="Upload videos: drop files here or press Enter to choose"
        onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${over ? 'border-primary-500 bg-primary-50 dark:bg-primary-950' : 'border-line hover:border-line-strong'}`}
      >
        <Upload className="size-6 text-muted" aria-hidden />
        <p className="font-medium">Drag videos here or click to choose</p>
        <p className="text-xs text-muted">{config ? `${config.extensions.map((e) => e.toUpperCase()).join(', ')} · up to ${fmtSize(config.maxUploadBytes)}` : ' '}{config?.provider === 'BUNNY' ? ' · uploads go straight to the video host and resume if interrupted' : ''}</p>
        <input ref={input} type="file" multiple accept={config ? [...config.mimeTypes, ...config.extensions.map((e) => `.${e}`)].join(',') : 'video/*'} className="hidden" data-testid="video-file-input" onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
      </div>
      {config?.provider === 'BUNNY' && (
        <div className="mt-3 max-w-sm"><Select label="Course for new uploads (optional)" value={courseId} onChange={(e) => setCourseId(e.target.value)} placeholder="No course" options={(courses ?? []).map((c) => ({ value: c.id, label: c.title }))} /></div>
      )}
      {uploads.items.length > 0 && (
        <ul className="mt-4 divide-y divide-line" aria-label="Uploads">
          {uploads.items.map((i) => (
            <li key={i.key} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <Film className="size-4 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{i.file.name}</p>
                <p className="text-xs text-muted">{fmtSize(i.file.size)} · {PHASE_TEXT[i.phase]}{i.phase === 'processing' && i.encodeProgress ? ` ${i.encodeProgress}%` : ''}{i.error ? ` — ${i.error}` : ''}</p>
                {(i.phase === 'uploading' || i.phase === 'authorizing') && (
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={`Upload progress for ${i.file.name}`} aria-valuenow={i.progress} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-primary-600 transition-[width]" style={{ width: `${i.progress}%` }} />
                  </div>
                )}
              </div>
              {i.phase === 'uploading' && <span className="w-10 text-right text-xs tabular-nums text-muted">{i.progress}%</span>}
              {['uploading', 'authorizing'].includes(i.phase) && <Button size="sm" variant="ghost" onClick={() => uploads.cancel(i)}>Cancel</Button>}
              {['failed', 'cancelled'].includes(i.phase) && <Button size="sm" variant="secondary" leftIcon={RefreshCw} onClick={() => uploads.retry(i)}>Retry</Button>}
              {['ready', 'failed', 'cancelled', 'invalid'].includes(i.phase) && <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={() => uploads.dismiss(i)}><X className="size-4" /></Button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Dialogs ──────────────────────────────────────────────────

function EditTitle({ video, onClose }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(video?.title ?? '');
  useEffect(() => setTitle(video?.title ?? ''), [video]);
  const save = useMutation({ mutationFn: () => videosApi.edit(video.id, { title: title.trim() }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['videos'] }); toast.success('Saved'); onClose(); }, onError: (e) => toast.error(e.message) });
  return (
    <Modal open={Boolean(video)} onClose={onClose} title="Edit title">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Input label="Title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!title.trim()} loading={save.isPending}>Save</Button></div>
      </form>
    </Modal>
  );
}

function AssignLesson({ video, courses, onClose }) {
  const qc = useQueryClient();
  const [courseId, setCourseId] = useState('');
  const [lessonId, setLessonId] = useState('');
  useEffect(() => { setCourseId(video?.courseId ?? ''); setLessonId(''); }, [video]);
  const curriculum = useQuery({ queryKey: ['course', courseId, 'curriculum'], queryFn: () => coursesApi.curriculum(courseId), enabled: Boolean(courseId) });
  const lessons = (curriculum.data ?? []).flatMap((s) => (s.lessons ?? []).flatMap((l) => [l, ...(l.children ?? [])]).filter((l) => l.type === 'VIDEO').map((l) => ({ value: l.id, label: `${s.title} › ${l.title}${l.videoAssetId ? ' (has a video)' : ''}` })));
  const save = useMutation({ mutationFn: () => videosApi.edit(video.id, { courseId, lessonId }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['videos'] }); qc.invalidateQueries({ queryKey: ['course', courseId] }); toast.success('Added to the lesson'); onClose(); }, onError: (e) => toast.error(e.details?.[0]?.message ?? e.message) });
  return (
    <Modal open={Boolean(video)} onClose={onClose} title="Assign to a lesson">
      <div className="space-y-4">
        {video?.status !== 'READY' && <Alert tone="info">Only ready videos can be added to lessons. This one is {STATUS_LABEL[video?.status]?.toLowerCase()}.</Alert>}
        <Select label="Course" placeholder="Choose a course" value={courseId} onChange={(e) => { setCourseId(e.target.value); setLessonId(''); }} options={(courses ?? []).map((c) => ({ value: c.id, label: c.title }))} />
        <Select label="Video lesson" placeholder={courseId && !lessons.length && curriculum.isSuccess ? 'This course has no video lessons' : 'Choose a lesson'} value={lessonId} onChange={(e) => setLessonId(e.target.value)} options={lessons} disabled={!courseId} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!lessonId || video?.status !== 'READY'} loading={save.isPending} onClick={() => save.mutate()}>Assign</Button></div>
      </div>
    </Modal>
  );
}

function Row({ label, children }) {
  return <div className="grid grid-cols-[140px_1fr] gap-3 py-1.5 text-sm"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words">{children ?? '—'}</dd></div>;
}

function Details({ id, onClose, onPreview }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['video', id], queryFn: () => videosApi.details(id), enabled: Boolean(id), refetchInterval: (query) => (IN_FLIGHT.has(query.state.data?.status) ? 5000 : false) });
  const refresh = useMutation({ mutationFn: () => videosApi.status(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['video', id] }); qc.invalidateQueries({ queryKey: ['videos'] }); } });
  const retry = useMutation({ mutationFn: () => videosApi.retryProcessing(id), onSuccess: () => { toast.success('Processing restarted'); qc.invalidateQueries({ queryKey: ['video', id] }); qc.invalidateQueries({ queryKey: ['videos'] }); }, onError: (e) => toast.error(e.message) });
  const v = q.data;
  return (
    <Drawer open={Boolean(id)} onClose={onClose} title="Video details">
      <div className="space-y-5 p-5">
        {!v ? <Skeleton className="h-64" /> : (
          <>
            {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" className="aspect-video w-full rounded-lg bg-surface-2 object-cover" />}
            <div className="flex flex-wrap gap-2">
              {v.status === 'READY' && <Button size="sm" leftIcon={Play} onClick={() => onPreview(v.id)}>Preview</Button>}
              {v.provider === 'BUNNY' && IN_FLIGHT.has(v.status) && <Button size="sm" variant="secondary" leftIcon={RefreshCw} loading={refresh.isPending} onClick={() => refresh.mutate()}>Refresh status</Button>}
              {v.provider === 'BUNNY' && v.status === 'FAILED' && <Button size="sm" variant="secondary" leftIcon={RefreshCw} loading={retry.isPending} onClick={() => retry.mutate()}>Retry processing</Button>}
            </div>
            {v.errorMessage && <Alert tone="error">{v.errorMessage}</Alert>}
            <dl className="divide-y divide-line">
              <Row label="Title">{v.title}</Row>
              <Row label="Status"><VideoStatus status={v.status} progress={v.encodeProgress} /></Row>
              <Row label="Backup"><BackupStatus backup={v.backup} />{v.backup?.completedAt && <span className="ml-2 text-xs text-muted">{formatDate(v.backup.completedAt, { withTime: true })}</span>}</Row>
              <Row label="Internal ID"><code className="text-xs">{v.id}</code></Row>
              <Row label="Provider">{v.provider === 'BUNNY' ? 'Bunny Stream' : 'Private storage'}</Row>
              {v.providerVideoId && <Row label="Bunny video ID"><code className="text-xs">{v.providerVideoId}</code></Row>}
              <Row label="Course">{v.course?.title}</Row>
              <Row label="Lessons">{v.usedIn?.length ? v.usedIn.map((l) => `${l.course.title} › ${l.title}`).join(', ') : null}</Row>
              <Row label="Original file">{v.originalFilename ?? v.file?.fileName}</Row>
              <Row label="Original size">{fmtSize(v.originalSize ?? v.file?.sizeBytes)}</Row>
              <Row label="Duration">{fmtDuration(v.durationSeconds)}</Row>
              <Row label="Resolution">{v.width && v.height ? `${v.width}×${v.height}` : null}{v.availableResolutions?.length ? <span className="ml-2 text-xs text-muted">({v.availableResolutions.join(', ')})</span> : null}</Row>
              <Row label="Storage used">{v.storageSize ? fmtSize(v.storageSize) : null}</Row>
              <Row label="Uploaded">{formatDate(v.createdAt, { withTime: true })}</Row>
              {v.readyAt && <Row label="Ready">{formatDate(v.readyAt, { withTime: true })}</Row>}
            </dl>
            {v.history?.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">History</h3>
                <ol className="space-y-1 text-xs">
                  {v.history.map((h) => <li key={h.id} className="flex justify-between gap-2"><span>{STATUS_LABEL[h.toStatus] ?? h.toStatus} <span className="text-muted">· {h.source.toLowerCase()}{h.reason ? ` · ${h.reason}` : ''}</span></span><span className="shrink-0 text-muted">{formatDate(h.createdAt, { withTime: true })}</span></li>)}
                </ol>
              </div>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

// ── Page ─────────────────────────────────────────────────────

export function VideosPage() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['videos', 'config'], queryFn: videosApi.config, staleTime: 10 * 60_000 });
  const [filters, setFilters] = useState({ status: '', q: '' });
  const q = useQuery({
    queryKey: ['videos', 'library', filters],
    queryFn: () => videosApi.library({ status: filters.status || undefined, q: filters.q || undefined }),
    refetchInterval: (query) => ((query.state.data ?? []).some((v) => IN_FLIGHT.has(v.status)) ? 5000 : false),
  });
  const courses = useQuery({ queryKey: ['creator', 'courses', 'all'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const changed = useCallback(() => qc.invalidateQueries({ queryKey: ['videos'] }), [qc]);
  const uploads = useUploads(config.data, changed);
  const [preview, setPreview] = useState(null);
  const [details, setDetails] = useState(null);
  const [editing, setEditing] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const remove = useMutation({ mutationFn: (v) => videosApi.destroy(v.id), onSuccess: () => { changed(); toast.success('Video deleted'); setDeleting(null); }, onError: (e) => { toast.error(e.message); setDeleting(null); } });
  const courseList = courses.data?.items ?? [];

  return (
    <>
      <PageHeader title="Video library" description="Upload once, use in any lesson. Videos are encoded for adaptive streaming and only enrolled students can play them." breadcrumbs={[{ label: 'Content' }, { label: 'Videos' }]} />
      {config.data?.provider === 'STORAGE' && <Alert tone="info" className="mb-4">The video host (Bunny Stream) is not configured, so uploads are stored privately and played without adaptive streaming.</Alert>}
      <UploadPanel config={config.data} uploads={uploads} courses={courseList} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input aria-label="Search videos" placeholder="Search by title" className="w-64" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <Select aria-label="Filter by status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} placeholder="All statuses" options={['READY', 'PROCESSING', 'UPLOADING', 'UPLOAD_AUTHORIZED', 'FAILED'].map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
      </div>
      <Card>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data ?? []}
          empty={<EmptyState icon={Film} title="No videos yet" description="Upload a video to start building video lessons." />}
          columns={[
            { key: 'thumbnail', header: '', cell: (v) => (v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" className="h-10 w-16 rounded object-cover" loading="lazy" /> : <div className="grid h-10 w-16 place-items-center rounded bg-surface-2"><Film className="size-4 text-muted" aria-hidden /></div>) },
            { key: 'title', header: 'Video', cell: (v) => <div className="min-w-0"><p className="font-medium text-fg">{v.title}</p><p className="truncate text-xs text-muted">{v.originalFilename ?? v.file?.fileName}</p></div> },
            { key: 'durationSeconds', header: 'Duration', cell: (v) => fmtDuration(v.durationSeconds) },
            { key: 'originalSize', header: 'Size', cell: (v) => fmtSize(v.originalSize ?? v.file?.sizeBytes) },
            { key: 'status', header: 'Status', cell: (v) => <VideoStatus status={v.status} progress={v.encodeProgress} /> },
            { key: 'backup', header: 'Backup', cell: (v) => <BackupStatus backup={v.backup} /> },
            { key: 'createdAt', header: 'Uploaded', cell: (v) => formatDate(v.createdAt) },
            { key: 'course', header: 'Course', cell: (v) => v.course?.title ?? v.usedIn?.[0]?.course.title ?? <span className="text-muted">—</span> },
            {
              key: 'actions', header: '', align: 'right',
              cell: (v) => (
                <Dropdown trigger={(p) => <Button size="sm" variant="ghost" aria-label={`Actions for ${v.title}`} {...p}>Actions</Button>}>
                  {v.status === 'READY' && <DropdownItem icon={Eye} onClick={() => setPreview(v.id)}>Preview</DropdownItem>}
                  <DropdownItem icon={Pencil} onClick={() => setEditing(v)}>Edit title</DropdownItem>
                  <DropdownItem icon={Link2} onClick={() => setAssigning(v)}>Assign to lesson</DropdownItem>
                  <DropdownItem icon={Info} onClick={() => setDetails(v.id)}>View details</DropdownItem>
                  <DropdownItem icon={Trash2} danger onClick={() => setDeleting(v)}>Delete</DropdownItem>
                </Dropdown>
              ),
            },
          ]} />
      </Card>
      <Preview id={preview} onClose={() => setPreview(null)} />
      <Details id={details} onClose={() => setDetails(null)} onPreview={setPreview} />
      <EditTitle video={editing} onClose={() => setEditing(null)} />
      <AssignLesson video={assigning} courses={courseList} onClose={() => setAssigning(null)} />
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting)} loading={remove.isPending}
        title={`Delete “${deleting?.title}”?`} description="The video is removed from the video host. Videos used in lessons, or still being backed up, cannot be deleted." confirmLabel="Delete video" />
    </>
  );
}
