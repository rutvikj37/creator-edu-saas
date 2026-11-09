import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Inbox, LifeBuoy, MessageCircle, Plus } from 'lucide-react';
import { ListToolbar } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, DataTable, EmptyState, ErrorState, Input, Modal, Select, Skeleton, StatCard, StatusBadge, Tabs, Textarea, toast } from '../../components/ui/index.js';
import { helpdeskApi, learnSupportApi } from '../../services/api/helpdesk.js';
import { useListParams } from '../../hooks/useListParams.js';
import { applyApiErrors } from '../../utils/forms.js';
import { formatDate } from '../../utils/format.js';
import { TicketThread } from './TicketThread.jsx';

const CATEGORIES = [
  { value: 'course', label: 'Course content' },
  { value: 'access', label: 'Access or login' },
  { value: 'payment', label: 'Payment or refund' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'technical', label: 'Technical problem' },
  { value: 'other', label: 'Something else' },
];
const categoryLabel = (c) => CATEGORIES.find((x) => x.value === c)?.label ?? c;
const STATUSES = ['OPEN', 'PENDING', 'ON_HOLD', 'RESOLVED', 'CLOSED'];
const statusLabel = (s) => s.replace('_', ' ').toLowerCase();
const PRIORITY_TONE = { URGENT: 'danger', HIGH: 'warning', MEDIUM: 'info', LOW: 'neutral' };

const schema = z.object({
  subject: z.string().trim().min(5, 'At least 5 characters').max(200),
  category: z.enum(CATEGORIES.map((c) => c.value)),
  body: z.string().trim().min(10, 'Describe the problem in at least 10 characters').max(5000),
});

// ── Student ────────────────────────────────────────────────────────────────

export function StudentSupportPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, update] = useListParams();
  const q = useQuery({ queryKey: ['learn', 'tickets', params], queryFn: () => learnSupportApi.tickets(params), placeholderData: (p) => p });
  const [open, setOpen] = useState(false);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { subject: '', category: 'course', body: '' } });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const t = await learnSupportApi.create(values);
      toast.success('Request sent', { description: 'The academy team will reply here and notify you.' });
      setOpen(false);
      form.reset();
      qc.invalidateQueries({ queryKey: ['learn', 'tickets'] });
      navigate(`/learn/support/${t.id}`);
    } catch (e) {
      applyApiErrors(e, form.setError, ['subject', 'category', 'body']);
    }
  });

  return (
    <>
      <PageHeader title="Support" count={q.data?.meta?.total} description="Ask the academy team about courses, payments, access or certificates." breadcrumbs={[{ label: 'Support' }]}
        actions={<><Button variant="secondary" leftIcon={MessageCircle} onClick={() => navigate('/learn/chat')}>Chat instead</Button><Button leftIcon={Plus} onClick={() => setOpen(true)}>New request</Button></>} />
      <Card>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta}
          onPageChange={(page) => update({ page }, { resetPage: false })} onRowClick={(r) => navigate(`/learn/support/${r.id}`)}
          empty={<EmptyState icon={LifeBuoy} title="No requests yet" description="Stuck on a lesson or a payment? Send the academy a request." action={<Button size="sm" onClick={() => setOpen(true)}>New request</Button>} />}
          columns={[
            { key: 'number', header: '#', cell: (r) => <span className="text-muted">#{r.number}</span> },
            { key: 'subject', header: 'Subject', cell: (r) => <Link to={`/learn/support/${r.id}`} className="font-medium text-primary-600 hover:underline">{r.subject}</Link> },
            { key: 'category', header: 'Topic', cell: (r) => categoryLabel(r.category) },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'lastActivityAt', header: 'Last activity', cell: (r) => formatDate(r.lastActivityAt, { withTime: true }) },
          ]} />
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="New support request" size="lg"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={form.formState.isSubmitting} onClick={onSubmit}>Send request</Button></>}>
        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Input label="Subject" {...form.register('subject')} error={form.formState.errors.subject?.message} /></div>
          <Select label="Topic" {...form.register('category')} options={CATEGORIES} />
          <div className="sm:col-span-2"><Textarea label="What do you need help with?" hint="Include the course and lesson name if it's about content." rows={6} {...form.register('body')} error={form.formState.errors.body?.message} /></div>
        </form>
      </Modal>
    </>
  );
}

export function StudentTicketPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['learn', 'ticket', id], queryFn: () => learnSupportApi.ticket(id) });
  const [body, setBody] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const setData = (d) => { qc.setQueryData(['learn', 'ticket', id], d); qc.invalidateQueries({ queryKey: ['learn', 'tickets'] }); };
  const reply = useMutation({ mutationFn: () => learnSupportApi.reply(id, body), onSuccess: (d) => { setData(d); setBody(''); toast.success('Reply sent'); }, onError: (e) => toast.error(e.message) });
  const close = useMutation({ mutationFn: () => learnSupportApi.close(id), onSuccess: (d) => { setData(d); setConfirmClose(false); toast.success('Request closed'); }, onError: (e) => toast.error(e.message) });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  if (q.isLoading) return <Skeleton className="h-96" />;
  const t = q.data;
  const closed = t.status === 'CLOSED';
  return (
    <>
      <PageHeader title={`#${t.number} ${t.subject}`} description={<span className="inline-flex items-center gap-2">{categoryLabel(t.category)} · opened {formatDate(t.createdAt, { withTime: true })} · <StatusBadge status={t.status} /></span>}
        breadcrumbs={[{ label: 'Support', to: '/learn/support' }, { label: `#${t.number}` }]}
        actions={closed ? undefined : <Button variant="secondary" onClick={() => setConfirmClose(true)}>Close request</Button>} />
      <div className="max-w-3xl space-y-6">
        <TicketThread messages={t.messages} staffLabel="Academy team" />
        {closed ? (
          <Card><CardBody className="flex items-center justify-between gap-3 text-sm text-muted">This request is closed.<Link to="/learn/support" className="font-medium text-primary-600 hover:underline">Open a new request</Link></CardBody></Card>
        ) : (
          <Card>
            <CardBody className="space-y-3">
              <Textarea label={t.status === 'RESOLVED' ? 'Reply to reopen this request' : 'Reply'} rows={4} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="flex justify-end"><Button disabled={!body.trim()} loading={reply.isPending} onClick={() => reply.mutate()}>Send reply</Button></div>
            </CardBody>
          </Card>
        )}
      </div>
      <ConfirmDialog open={confirmClose} onClose={() => setConfirmClose(false)} onConfirm={() => close.mutate()} loading={close.isPending}
        title="Close this request?" description="Close it if your problem is solved. You can open a new request any time." confirmLabel="Close request" tone="primary" />
    </>
  );
}

// ── Academy team ───────────────────────────────────────────────────────────

export function CreatorHelpdeskPage() {
  const navigate = useNavigate();
  const [params, update] = useListParams({ view: 'all' });
  const q = useQuery({ queryKey: ['creator', 'helpdesk', params], queryFn: () => helpdeskApi.tickets(params), placeholderData: (p) => p, refetchInterval: 30_000 });
  const summary = useQuery({ queryKey: ['creator', 'helpdesk', 'summary'], queryFn: helpdeskApi.summary, refetchInterval: 30_000 });
  const s = summary.data;
  return (
    <>
      <PageHeader title="Help desk" count={q.data?.meta?.total} description="Support requests from your students." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open" value={s?.byStatus?.OPEN ?? 0} loading={summary.isLoading} />
        <StatCard label="Waiting on student" value={s?.byStatus?.PENDING ?? 0} loading={summary.isLoading} />
        <StatCard label="Unassigned" value={s?.unassigned ?? 0} loading={summary.isLoading} />
        <StatCard label="Assigned to me" value={s?.mine ?? 0} loading={summary.isLoading} />
      </div>
      <Tabs className="mb-4" value={params.view} onChange={(view) => update({ view })} tabs={[{ value: 'all', label: 'All open' }, { value: 'unassigned', label: 'Unassigned' }, { value: 'mine', label: 'Assigned to me' }]} />
      <Card>
        <ListToolbar search={params.q} onSearch={(v) => update({ q: v })} placeholder="Subject or request #" count={q.data?.meta?.total} noun="request"
          filtered={Boolean(params.status || params.priority)} onReset={() => update({ status: undefined, priority: undefined })}
          filters={<>
            <FilterChip label="Status" value={params.status} onChange={(v) => update({ status: v })} options={STATUSES.map((v) => ({ value: v, label: statusLabel(v) }))} />
            <FilterChip label="Priority" value={params.priority} onChange={(v) => update({ priority: v })} options={['URGENT', 'HIGH', 'MEDIUM', 'LOW'].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }))} />
          </>} />
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta}
          onPageChange={(page) => update({ page }, { resetPage: false })} onRowClick={(r) => navigate(`/creator/helpdesk/${r.id}`)}
          empty={<EmptyState icon={Inbox} title="All caught up" description="No student requests in this view." />}
          columns={[
            { key: 'number', header: '#', cell: (r) => <span className="text-muted">#{r.number}</span> },
            { key: 'subject', header: 'Subject', cell: (r) => <div><p className="font-medium text-fg">{r.subject}</p><p className="text-xs text-muted">{r.requester?.fullName} · {categoryLabel(r.category)}</p></div> },
            { key: 'priority', header: 'Priority', cell: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{r.priority.toLowerCase()}</Badge> },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'assignee', header: 'Assignee', cell: (r) => r.assignee?.fullName ?? <span className="text-muted">—</span> },
            { key: 'lastActivityAt', header: 'Updated', cell: (r) => formatDate(r.lastActivityAt, { withTime: true }) },
          ]} />
      </Card>
    </>
  );
}

export function CreatorHelpdeskTicketPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['creator', 'helpdesk-ticket', id], queryFn: () => helpdeskApi.ticket(id) });
  const team = useQuery({ queryKey: ['creator', 'helpdesk', 'team'], queryFn: helpdeskApi.team });
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const setData = (d) => { qc.setQueryData(['creator', 'helpdesk-ticket', id], d); qc.invalidateQueries({ queryKey: ['creator', 'helpdesk'] }); };
  const reply = useMutation({ mutationFn: () => helpdeskApi.reply(id, { body, internal }), onSuccess: (d) => { setData(d); setBody(''); toast.success(internal ? 'Note added' : 'Reply sent'); }, onError: (e) => toast.error(e.message) });
  const update = useMutation({ mutationFn: (patch) => helpdeskApi.update(id, patch), onSuccess: (d) => { setData(d); toast.success('Request updated'); }, onError: (e) => toast.error(e.message) });

  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  if (q.isLoading) return <Skeleton className="h-96" />;
  const t = q.data;
  return (
    <>
      <PageHeader title={`#${t.number} ${t.subject}`} description={`${t.requester?.fullName ?? 'Student'} · opened ${formatDate(t.createdAt, { withTime: true })}`} breadcrumbs={[{ label: 'Help desk', to: '/creator/helpdesk' }, { label: `#${t.number}` }]} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <TicketThread messages={t.messages} staffView staffLabel="Team" />
          <Card>
            <CardBody className="space-y-3">
              <Textarea label={internal ? 'Internal note (the student will not see this)' : 'Reply to student'} rows={4} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="flex items-center justify-between gap-3">
                <Checkbox label="Internal note" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                <Button disabled={!body.trim()} loading={reply.isPending} onClick={() => reply.mutate()}>{internal ? 'Add note' : 'Send reply'}</Button>
              </div>
            </CardBody>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader title="Details" actions={<StatusBadge status={t.status} />} />
          <CardBody className="space-y-4">
            <Select label="Status" value={t.status} onChange={(e) => update.mutate({ status: e.target.value })} options={STATUSES.map((v) => ({ value: v, label: statusLabel(v) }))} />
            <Select label="Priority" value={t.priority} onChange={(e) => update.mutate({ priority: e.target.value })} options={['URGENT', 'HIGH', 'MEDIUM', 'LOW'].map((v) => ({ value: v, label: v.toLowerCase() }))} />
            <Select label="Assignee" placeholder="Unassigned" value={t.assigneeId ?? ''} onChange={(e) => update.mutate({ assigneeId: e.target.value || null })} options={(team.data ?? []).map((a) => ({ value: a.id, label: a.fullName }))} />
            <dl className="space-y-2 border-t border-line pt-4 text-sm">
              <div><dt className="text-muted">Student</dt><dd>{t.requester?.fullName} · {t.requester?.email}</dd></div>
              <div><dt className="text-muted">Topic</dt><dd>{categoryLabel(t.category)}</dd></div>
              <div><dt className="text-muted">First response</dt><dd>{t.firstResponseAt ? formatDate(t.firstResponseAt, { withTime: true }) : 'Awaiting'}</dd></div>
            </dl>
            {t.requester?.email && <Link to={`/creator/students?q=${encodeURIComponent(t.requester.email)}`} className="text-sm font-medium text-primary-600 hover:underline">Find in Students</Link>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
