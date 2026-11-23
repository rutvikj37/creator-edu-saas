import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { ListToolbar } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { Badge, Card, DataTable, EmptyState, StatusBadge, Tabs } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDate } from '../../utils/format.js';

const PRIORITY_TONE = { URGENT: 'danger', HIGH: 'warning', MEDIUM: 'info', LOW: 'neutral' };

export function SupportInboxPage() {
  const navigate = useNavigate();
  const [params, update] = useListParams({ view: 'unassigned' });
  const q = useQuery({ queryKey: ['platform', 'tickets', params], queryFn: () => platformApi.tickets(params), placeholderData: (p) => p, refetchInterval: 30_000 });
  return (
    <>
      <PageHeader title="Support inbox" count={q.data?.meta?.total} description="Creator tickets across all academies." />
      <Tabs className="mb-4" value={params.view} onChange={(view) => update({ view })} tabs={[{ value: 'unassigned', label: 'Unassigned' }, { value: 'mine', label: 'Assigned to me' }, { value: 'all', label: 'All open' }]} />
      <Card>
        <ListToolbar search={params.q} onSearch={(v) => update({ q: v })} placeholder="Subject or ticket #" count={q.data?.meta?.total} noun="ticket"
          filtered={Boolean(params.status || params.priority)} onReset={() => update({ status: undefined, priority: undefined })}
          filters={<>
            <FilterChip label="Status" value={params.status} onChange={(v) => update({ status: v })} options={['OPEN', 'PENDING', 'ON_HOLD', 'RESOLVED', 'CLOSED'].map((s) => ({ value: s, label: s[0] + s.slice(1).replace('_', ' ').toLowerCase() }))} />
            <FilterChip label="Priority" value={params.priority} onChange={(v) => update({ priority: v })} options={['URGENT', 'HIGH', 'MEDIUM', 'LOW'].map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))} />
          </>} />
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta}
          onPageChange={(page) => update({ page }, { resetPage: false })} onRowClick={(r) => navigate(`/support/tickets/${r.id}`)}
          empty={<EmptyState icon={Inbox} title="Inbox zero" description="No tickets in this view." />}
          columns={[
            { key: 'number', header: '#', cell: (r) => <span className="text-muted">#{r.number}</span> },
            { key: 'subject', header: 'Subject', cell: (r) => <div><p className="font-medium text-fg">{r.subject}</p><p className="text-xs text-muted">{r.tenant?.name ?? '—'} · {r.requester?.email}</p></div> },
            { key: 'priority', header: 'Priority', cell: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{r.priority.toLowerCase()}</Badge> },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'sla', header: 'SLA due', cell: (r) => <span className={!r.firstResponseAt && new Date(r.slaDueAt) < new Date() ? 'font-medium text-red-600' : ''}>{r.firstResponseAt ? 'Responded' : formatDate(r.slaDueAt, { withTime: true })}</span> },
            { key: 'assignee', header: 'Assignee', cell: (r) => r.assignee?.fullName ?? <span className="text-muted">—</span> },
            { key: 'lastActivityAt', header: 'Updated', cell: (r) => formatDate(r.lastActivityAt, { withTime: true }) },
          ]} />
      </Card>
    </>
  );
}
