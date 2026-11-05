import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, Play, Trash2, Upload } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, Modal, Skeleton, toast } from '../../components/ui/index.js';
import { readVideoDuration, uploadVideo, videosApi } from '../../services/api/videos.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate } from '../../utils/format.js';

export const fmtDuration = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '—');
const fmtSize = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${Math.round(b / 1024 ** 2)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function Preview({ id, onClose }) {
  const q = useQuery({ queryKey: ['video-preview', id], queryFn: () => videosApi.preview(id), enabled: Boolean(id) });
  return (
    <Modal open={Boolean(id)} onClose={onClose} title="Preview" size="xl">
      {q.isLoading ? <Skeleton className="aspect-video w-full" /> : q.data && <video controls autoPlay src={q.data.url} className="aspect-video w-full rounded-lg bg-black" />}
    </Modal>
  );
}

/** Upload queue + video library. */
export function VideosPage() {
  const auth = useAuth();
  const qc = useQueryClient();
  const input = useRef(null);
  const q = useQuery({ queryKey: ['videos'], queryFn: videosApi.list });
  const [uploads, setUploads] = useState([]);
  const [preview, setPreview] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const canManage = auth.can('courses.manage');
  const remove = useMutation({ mutationFn: (id) => videosApi.remove(id), onSuccess: () => { toast.success('Video deleted'); setToDelete(null); qc.invalidateQueries({ queryKey: ['videos'] }); }, onError: (e) => toast.error(e.message) });

  const start = async (files) => {
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      const set = (patch) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
      setUploads((u) => [...u, { key, name: file.name, progress: 0, status: 'uploading' }]);
      try {
        const durationSeconds = await readVideoDuration(file);
        const f = await uploadVideo(file, (progress) => set({ progress }));
        set({ status: 'saving' });
        await videosApi.create({ fileId: f.id, title: file.name.replace(/\.[^.]+$/, '').slice(0, 200), durationSeconds: durationSeconds ?? undefined });
        set({ status: 'done', progress: 100 });
        qc.invalidateQueries({ queryKey: ['videos'] });
      } catch (e) {
        set({ status: 'error', error: e.details?.[0]?.message ?? e.message });
      }
    }
    if (input.current) input.current.value = '';
  };

  return (
    <>
      <PageHeader title="Videos" description="Upload once, use in any lesson. Videos stream from private storage through short-lived signed links." breadcrumbs={[{ label: 'Content' }, { label: 'Videos' }]}
        actions={canManage && <Button leftIcon={Upload} onClick={() => input.current?.click()}>Upload videos</Button>} />
      <input ref={input} type="file" accept="video/mp4,video/webm,video/quicktime,video/x-matroska" multiple className="sr-only" onChange={(e) => start([...(e.target.files ?? [])])} />
      <Alert tone="info" className="mb-6">Playback is protected by sign-in, enrolment checks and expiring links. This is not DRM — screen recording can't be prevented.</Alert>
      {uploads.length > 0 && (
        <Card className="mb-6 divide-y divide-line">
          {uploads.map((u) => (
            <div key={u.key} className="space-y-1.5 px-5 py-3 text-sm">
              <div className="flex justify-between gap-2"><span className="truncate font-medium">{u.name}</span><span className={u.status === 'error' ? 'text-red-600' : 'text-muted'}>{u.status === 'uploading' ? `${u.progress}%` : u.status === 'saving' ? 'Verifying…' : u.status === 'done' ? 'Added to library' : 'Failed'}</span></div>
              <div className="h-1.5 rounded-full bg-surface-2"><div className={`h-1.5 rounded-full ${u.status === 'error' ? 'bg-red-500' : u.status === 'done' ? 'bg-green-600' : 'bg-primary-600'}`} style={{ width: `${u.progress}%` }} /></div>
              {u.error && <p className="text-xs text-red-600">{u.error}</p>}
            </div>
          ))}
        </Card>
      )}
      <Card
        onDragOver={(e) => canManage && e.preventDefault()}
        onDrop={(e) => { if (!canManage) return; e.preventDefault(); start([...e.dataTransfer.files].filter((f) => f.type.startsWith('video/'))); }}
      >
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data ?? []}
          empty={<EmptyState icon={Film} title="No videos yet" description="Drag video files here or use Upload videos. MP4 (H.264) plays everywhere." action={canManage && <Button size="sm" leftIcon={Upload} onClick={() => input.current?.click()}>Upload videos</Button>} />}
          columns={[
            { key: 'title', header: 'Video', cell: (r) => <div><p className="font-medium text-fg">{r.title}</p><p className="text-xs text-muted">{r.file?.fileName} · {r.file ? fmtSize(r.file.sizeBytes) : ''}</p></div> },
            { key: 'durationSeconds', header: 'Length', cell: (r) => fmtDuration(r.durationSeconds) },
            { key: 'status', header: 'Status', cell: (r) => <Badge tone={r.status === 'READY' ? 'success' : r.status === 'FAILED' ? 'danger' : 'info'}>{r.status.toLowerCase()}</Badge> },
            { key: 'usedIn', header: 'Used in', cell: (r) => (r.usedIn.length ? r.usedIn.map((l) => l.course.title).filter((v, i, a) => a.indexOf(v) === i).join(', ') : <span className="text-muted">Not used</span>) },
            { key: 'createdAt', header: 'Added', cell: (r) => formatDate(r.createdAt) },
            { key: 'a', header: '', align: 'right', cell: (r) => (
              <span className="inline-flex gap-1">
                <Button variant="ghost" size="icon-sm" aria-label={`Preview ${r.title}`} onClick={() => setPreview(r.id)}><Play className="size-4" /></Button>
                {canManage && <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.title}`} onClick={() => setToDelete(r)}><Trash2 className="size-4" /></Button>}
              </span>
            ) },
          ]} />
      </Card>
      <Preview id={preview} onClose={() => setPreview(null)} />
      <ConfirmDialog open={Boolean(toDelete)} onClose={() => setToDelete(null)} title={`Delete “${toDelete?.title}”?`} description={toDelete?.usedIn?.length ? 'This video is used in lessons — detach it first.' : 'Active playback stops immediately.'} confirmLabel="Delete" loading={remove.isPending} onConfirm={() => remove.mutate(toDelete.id)} />
    </>
  );
}
