import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Cloud, CloudOff, Database, Film, HardDrive, RefreshCw, RotateCcw, Upload } from 'lucide-react';
import { ListToolbar } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, EmptyState, Input, Skeleton, StatCard, Tabs, toast } from '../../components/ui/index.js';
import { videoAdminApi } from '../../services/api/videoAdmin.js';
import { formatDate, formatMoney, formatNumber } from '../../utils/format.js';
import { fmtSize } from '../creator/VideosPage.jsx';

const BACKUP_TONE = { COMPLETED: 'success', FAILED: 'danger', RETRYING: 'warning', IN_PROGRESS: 'info', PENDING: 'neutral' };
const BACKUP_TEXT = { COMPLETED: 'Completed', FAILED: 'Failed', RETRYING: 'Retrying', IN_PROGRESS: 'In progress', PENDING: 'Pending' };

function QuotaBar({ quota }) {
  if (!quota?.limit) return <p className="text-sm text-muted">Unlimited storage reported by Google.</p>;
  const used = Math.min(100, Math.round((quota.usage / quota.limit) * 100));
  return (
    <div>
      <div className="flex justify-between text-sm"><span>{fmtSize(quota.usage)} used of {fmtSize(quota.limit)}</span><span className="tabular-nums">{fmtSize(quota.free)} free ({quota.freePercent}%)</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Google Drive space used" aria-valuenow={used} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${quota.lowSpace ? 'bg-red-600' : 'bg-primary-600'}`} style={{ width: `${used}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">Backups in Drive: {fmtSize(quota.usageInDrive)} · Trash: {fmtSize(quota.usageInDriveTrash)}</p>
    </div>
  );
}

function DriveCard() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['backups', 'quota'], queryFn: videoAdminApi.quota });
  const [confirm, setConfirm] = useState(false);
  const connect = useMutation({ mutationFn: videoAdminApi.connect, onSuccess: ({ url }) => window.location.assign(url), onError: (e) => toast.error(e.message) });
  const disconnect = useMutation({ mutationFn: videoAdminApi.disconnect, onSuccess: () => { qc.invalidateQueries({ queryKey: ['backups'] }); setConfirm(false); toast.success('Google Drive disconnected'); } });
  useEffect(() => {
    const r = params.get('drive');
    if (!r) return;
    if (r === 'connected') toast.success('Google Drive connected');
    else toast.error(params.get('message') ?? 'Could not connect Google Drive');
    setParams((p) => { const n = new URLSearchParams(p); n.delete('drive'); n.delete('message'); return n; }, { replace: true });
  }, [params, setParams]);
  const s = q.data;
  return (
    <Card>
      <CardHeader title="Google Drive" description="Encrypted copies of original uploads and selected documents. Never used for playback."
        actions={s?.connected ? <Button size="sm" variant="ghost" leftIcon={CloudOff} onClick={() => setConfirm(true)}>Disconnect</Button> : s?.configured ? <Button size="sm" leftIcon={Cloud} loading={connect.isPending} onClick={() => connect.mutate()}>Connect Google Drive</Button> : null} />
      <CardBody className="space-y-3">
        {!s ? <Skeleton className="h-16" /> : !s.configured ? (
          <Alert tone="warning">Backups are not configured. Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REDIRECT_URI and BACKUP_ENCRYPTION_KEY on the server.</Alert>
        ) : !s.connected ? (
          <Alert tone="info">Not connected. New backups wait until you connect the Drive account (only files created by this app are accessible to it).</Alert>
        ) : (
          <>
            <p className="text-sm">Connected as <strong>{s.email ?? 'unknown account'}</strong>{s.connectedAt ? ` · since ${formatDate(s.connectedAt)}` : ''}</p>
            {s.quota?.lowSpace && <Alert tone="error" title="Drive is running out of space">Free space is below {s.quota.lowSpaceThresholdPercent}%. New backups will fail when a file no longer fits.</Alert>}
            <QuotaBar quota={s.quota} />
          </>
        )}
      </CardBody>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => disconnect.mutate()} loading={disconnect.isPending} title="Disconnect Google Drive?" description="Access is revoked at Google. Existing backup files stay in Drive; new backups wait until you reconnect." confirmLabel="Disconnect" />
    </Card>
  );
}

function CourseDocuments() {
  const qc = useQueryClient();
  const [courseId, setCourseId] = useState('');
  const run = useMutation({ mutationFn: () => videoAdminApi.backupCourseDocuments(courseId.trim()), onSuccess: (r) => { toast.success(`${r.queued} document${r.queued === 1 ? '' : 's'} queued for backup`); setCourseId(''); qc.invalidateQueries({ queryKey: ['backups', 'list'] }); }, onError: (e) => toast.error(e.message) });
  return (
    <Card>
      <CardHeader title="Back up course documents" description="Queues every lesson file (PDFs, downloads) of one course." />
      <CardBody>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
          <Input label="Course ID" value={courseId} onChange={(e) => setCourseId(e.target.value)} placeholder="e.g. cm…" className="w-72" />
          <Button type="submit" variant="secondary" leftIcon={Upload} disabled={courseId.trim().length !== 25} loading={run.isPending}>Back up</Button>
        </form>
      </CardBody>
    </Card>
  );
}

export function BackupsPage() {
  const qc = useQueryClient();
  const [kind, setKind] = useState('video');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [restoring, setRestoring] = useState(null);
  const q = useQuery({ queryKey: ['backups', 'list', kind, status, page], queryFn: () => videoAdminApi.backups({ kind, status: status || undefined, page, pageSize: 25 }), refetchInterval: (query) => ((query.state.data?.items ?? []).some((b) => ['IN_PROGRESS', 'RETRYING'].includes(b.status) || b.restoreStatus === 'IN_PROGRESS') ? 5000 : false) });
  const retry = useMutation({ mutationFn: (id) => videoAdminApi.retry(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['backups'] }); toast.success('Backup queued again'); }, onError: (e) => toast.error(e.message) });
  const restore = useMutation({ mutationFn: (id) => videoAdminApi.restore(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['backups'] }); setRestoring(null); toast.success('Restore started'); }, onError: (e) => { toast.error(e.message); setRestoring(null); } });
  return (
    <>
      <PageHeader title="Backups" description="Original video uploads and documents, encrypted before they leave our servers."  />
      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_380px]"><DriveCard /><CourseDocuments /></div>
      <Tabs className="mb-4" value={kind} onChange={(k) => { setKind(k); setPage(1); }} tabs={[{ value: 'video', label: 'Videos' }, { value: 'document', label: 'Documents' }]} />
      <Card>
        <ListToolbar count={q.data?.meta?.total} noun="backup" filtered={Boolean(status)} onReset={() => { setStatus(''); setPage(1); }}
          filters={<FilterChip label="Status" value={status || undefined} onChange={(v) => { setStatus(v ?? ''); setPage(1); }} options={Object.entries(BACKUP_TEXT).map(([value, label]) => ({ value, label }))} />} />
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta} onPageChange={setPage}
          empty={<EmptyState icon={Database} title="No backups yet" description="Backups start automatically after a video is uploaded." />}
          columns={[
            { key: 'item', header: kind === 'video' ? 'Video' : 'Document', cell: (b) => <div><p className="font-medium text-fg">{b.video?.title ?? b.fileName ?? b.backupFilename}</p><p className="text-xs text-muted">{b.tenant?.name ?? b.tenantId}</p></div> },
            { key: 'status', header: 'Status', cell: (b) => <div><Badge tone={BACKUP_TONE[b.status]}>{BACKUP_TEXT[b.status]}</Badge>{b.errorMessage && <p className="mt-1 max-w-xs text-xs text-red-600">{b.errorMessage}</p>}</div> },
            { key: 'size', header: 'Size', cell: (b) => fmtSize(b.originalSize) },
            { key: 'attempts', header: 'Attempts', align: 'right' },
            { key: 'completedAt', header: 'Verified', cell: (b) => (b.completedAt ? formatDate(b.completedAt, { withTime: true }) : '—') },
            { key: 'restore', header: 'Restore', cell: (b) => (b.restoreStatus && b.restoreStatus !== 'NONE' ? <span title={b.restoreError ?? undefined}><Badge tone={b.restoreStatus === 'COMPLETED' ? 'success' : b.restoreStatus === 'FAILED' ? 'danger' : 'info'}>{b.restoreStatus.replace('_', ' ').toLowerCase()}</Badge></span> : '—') },
            {
              key: 'actions', header: '', align: 'right',
              cell: (b) => (
                <div className="flex justify-end gap-1">
                  {['FAILED', 'PENDING', 'RETRYING'].includes(b.status) && <Button size="sm" variant="secondary" leftIcon={RefreshCw} onClick={() => retry.mutate(b.id)}>Retry</Button>}
                  {b.kind === 'video' && b.status === 'COMPLETED' && <Button size="sm" variant="ghost" leftIcon={RotateCcw} disabled={b.restoreStatus === 'IN_PROGRESS'} onClick={() => setRestoring(b)}>Restore</Button>}
                </div>
              ),
            },
          ]} />
      </Card>
      <ConfirmDialog open={Boolean(restoring)} onClose={() => setRestoring(null)} onConfirm={() => restore.mutate(restoring.id)} loading={restore.isPending} tone="primary"
        title={`Restore “${restoring?.video?.title}”?`} description="The backup is verified first, then the original is uploaded to the video host as a new entry and re-encoded. Students keep the same lesson; playback resumes when processing finishes." confirmLabel="Verify and restore" />
    </>
  );
}

// ── Usage dashboard ──────────────────────────────────────────

const currentPeriod = () => new Date().toISOString().slice(0, 7);
const cost = (c) => (c ? formatMoney(c.amount, c.currency) : '—');

export function VideoUsagePage() {
  const [period, setPeriod] = useState(currentPeriod());
  const q = useQuery({ queryKey: ['video-usage', period], queryFn: () => videoAdminApi.usage(period) });
  const quota = useQuery({ queryKey: ['backups', 'quota'], queryFn: videoAdminApi.quota });
  const u = q.data;
  const b = u?.backups.byStatus ?? {};
  const backupTotal = Object.values(b).reduce((a, n) => a + n, 0);
  return (
    <>
      <PageHeader title="Video usage" description="Storage, delivery and backups across academies. Estimates only — nothing is charged automatically." breadcrumbs={[{ label: 'System' }, { label: 'Video usage' }]}
        actions={<Input aria-label="Month" type="month" value={period} max={currentPeriod()} onChange={(e) => e.target.value && setPeriod(e.target.value)} className="w-44" />} />
      {q.isError ? <Alert tone="error">{q.error.message}</Alert> : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Videos" value={formatNumber(u?.totals.videos)} hint={u ? `${u.totals.ready} ready · ${u.totals.processing} processing · ${u.totals.failed} failed` : undefined} icon={Film} loading={!u} />
            <StatCard label="Storage" value={fmtSize(u?.totals.storageBytes)} hint={u?.provider ? `Bunny library: ${fmtSize(u.provider.storageBytes)}` : 'Provider total needs BUNNY_ACCOUNT_API_KEY'} icon={HardDrive} loading={!u} />
            <StatCard label="Delivery this month" value={fmtSize(u?.provider?.trafficBytesThisMonth ?? u?.totals.deliveryBytesThisPeriod)} hint="Bunny library traffic" icon={Cloud} loading={!u} />
            <StatCard label="Estimated cost" value={cost(u?.totals.estimatedCost)} hint={u && !u.totals.estimatedCost ? 'Set rates in Settings → Video costs' : `${u?.rates.storagePerGbMonth ?? '—'}/GB-month, ${u?.rates.deliveryPerGb ?? '—'}/GB (${u?.rates.rateCurrency})`} icon={Database} loading={!u} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Uploads this month" value={formatNumber(u?.totals.uploadsThisPeriod)} hint={u ? fmtSize(u.totals.uploadBytesThisPeriod) : undefined} loading={!u} />
            <StatCard label="Processing failures" value={formatNumber(u?.totals.processingFailuresThisPeriod)} hint="this month" loading={!u} />
            <StatCard label="Backups" value={u ? `${b.COMPLETED ?? 0} / ${backupTotal}` : '—'} hint={u ? `${b.FAILED ?? 0} failed · ${(b.PENDING ?? 0) + (b.RETRYING ?? 0) + (b.IN_PROGRESS ?? 0)} waiting · ${fmtSize(u.backups.storedBytes)} stored` : undefined} loading={!u} />
            <StatCard label="Google Drive free" value={quota.data?.quota?.free !== undefined && quota.data?.quota?.free !== null ? fmtSize(quota.data.quota.free) : quota.data?.connected === false ? 'Not connected' : '—'} hint={quota.data?.quota?.lowSpace ? 'Low space' : quota.data?.quota?.freePercent !== undefined && quota.data?.quota?.freePercent !== null ? `${quota.data.quota.freePercent}% free` : undefined} icon={quota.data?.quota?.lowSpace ? AlertTriangle : HardDrive} loading={quota.isLoading} />
          </div>
          <Card>
            <CardHeader title="Academies" description={u?.deliveryNote} />
            <DataTable loading={q.isLoading} rows={(u?.tenants ?? []).map((t) => ({ ...t, id: t.tenant.id }))}
              empty={<EmptyState icon={Film} title="No video usage yet" className="py-8" />}
              columns={[
                { key: 'tenant', header: 'Academy', cell: (t) => <div><p className="font-medium text-fg">{t.tenant.name}</p>{t.overFairUse && <Badge tone="warning">Above fair use</Badge>}</div> },
                { key: 'videos', header: 'Videos', align: 'right' },
                { key: 'storageBytes', header: 'Storage', align: 'right', cell: (t) => fmtSize(t.storageBytes) },
                { key: 'deliveryBytes', header: 'Delivery (est.)', align: 'right', cell: (t) => fmtSize(t.deliveryBytes) },
                { key: 'watchSeconds', header: 'Watch time', align: 'right', cell: (t) => `${formatNumber(Math.round(t.watchSeconds / 3600))} h` },
                { key: 'estimatedCost', header: 'Est. cost', align: 'right', cell: (t) => cost(t.estimatedCost) },
              ]} />
          </Card>
        </div>
      )}
    </>
  );
}
