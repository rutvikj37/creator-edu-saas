import { useState } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button, Card, CardBody, CardHeader, Checkbox, ErrorState, Select, Skeleton, StatusBadge, Textarea, toast } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { formatDate } from '../../utils/format.js';
import { TicketThread } from './TicketThread.jsx';

export function StaffTicketPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'ticket', id], queryFn: () => platformApi.ticket(id) });
  const agents = useQuery({ queryKey: ['platform', 'agents'], queryFn: platformApi.supportAgents });
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const setData = (data) => { qc.setQueryData(['platform', 'ticket', id], data); qc.invalidateQueries({ queryKey: ['platform', 'tickets'] }); };
  const reply = useMutation({ mutationFn: () => platformApi.replyTicket(id, { body, internal }), onSuccess: (d) => { setData(d); setBody(''); toast.success(internal ? 'Note added' : 'Reply sent'); }, onError: (e) => toast.error(e.message) });
  const update = useMutation({ mutationFn: (patch) => platformApi.updateTicket(id, patch), onSuccess: (d) => { setData(d); toast.success('Ticket updated'); }, onError: (e) => toast.error(e.message) });

  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  if (q.isLoading) return <Skeleton className="h-96" />;
  const t = q.data;
  return (
    <>
      <PageHeader title={`#${t.number} ${t.subject}`} description={`${t.tenant?.name ?? 'No academy'} · opened ${formatDate(t.createdAt, { withTime: true })}`} breadcrumbs={[{ label: 'Support', to: '/support' }, { label: `#${t.number}` }]} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <TicketThread messages={t.messages} staffView />
          <Card>
            <CardBody className="space-y-3">
              <Textarea label={internal ? 'Internal note (not visible to the creator)' : 'Reply to creator'} rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
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
            <Select label="Status" value={t.status} onChange={(e) => update.mutate({ status: e.target.value })} options={['OPEN', 'PENDING', 'ON_HOLD', 'RESOLVED', 'CLOSED'].map((s) => ({ value: s, label: s.replace('_', ' ').toLowerCase() }))} />
            <Select label="Priority" value={t.priority} onChange={(e) => update.mutate({ priority: e.target.value })} options={['URGENT', 'HIGH', 'MEDIUM', 'LOW'].map((s) => ({ value: s, label: s.toLowerCase() }))} />
            <Select label="Assignee" placeholder="Unassigned" value={t.assigneeId ?? ''} onChange={(e) => update.mutate({ assigneeId: e.target.value || null })} options={(agents.data ?? []).map((a) => ({ value: a.id, label: a.fullName }))} />
            <dl className="space-y-2 border-t border-line pt-4 text-sm">
              <div><dt className="text-muted">Requester</dt><dd>{t.requester?.fullName} · {t.requester?.email}</dd></div>
              <div><dt className="text-muted">Category</dt><dd className="capitalize">{t.category}</dd></div>
              <div><dt className="text-muted">First response</dt><dd>{t.firstResponseAt ? formatDate(t.firstResponseAt, { withTime: true }) : 'Awaiting'}</dd></div>
            </dl>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
