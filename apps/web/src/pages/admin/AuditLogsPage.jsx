import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import { JsonView } from '../../components/common/JsonView.jsx';
import { Card, DataTable, Drawer, EmptyState, Input } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDate } from '../../utils/format.js';

export function AuditLogsPage() {
  const [params, update] = useListParams({ pageSize: 25 });
  const [selected, setSelected] = useState(null);
  const q = useQuery({
    queryKey: ['platform', 'audit', params],
    queryFn: () => platformApi.auditLogs({ ...params, from: params.from ? `${params.from}T00:00:00Z` : undefined, to: params.to ? `${params.to}T23:59:59Z` : undefined }),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader title="Audit logs" description="Security-relevant and administrative actions. Entries cannot be edited." breadcrumbs={[{ label: 'System' }, { label: 'Audit logs' }]} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-end">
          <SearchInput className="md:w-72" value={params.action ?? ''} onChange={(v) => update({ action: v })} placeholder="Action prefix, e.g. tenant." />
          <Input label="From" type="date" value={params.from ?? ''} onChange={(e) => update({ from: e.target.value })} className="md:w-44" />
          <Input label="To" type="date" value={params.to ?? ''} onChange={(e) => update({ to: e.target.value })} className="md:w-44" />
        </div>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta}
          onPageChange={(page) => update({ page }, { resetPage: false })} onRowClick={setSelected}
          empty={<EmptyState icon={ScrollText} title="No entries" description="Adjust the filters to see more." />}
          columns={[
            { key: 'createdAt', header: 'Time', cell: (r) => formatDate(r.createdAt, { withTime: true }) },
            { key: 'action', header: 'Action', cell: (r) => <code className="text-xs">{r.action}</code> },
            { key: 'actor', header: 'Actor', cell: (r) => r.actor ? <span>{r.actor.fullName} <span className="text-xs text-muted">{r.actor.email}</span></span> : <span className="text-muted">System</span> },
            { key: 'target', header: 'Target', cell: (r) => r.targetType ? <span className="text-xs">{r.targetType} <span className="text-muted">{r.targetId}</span></span> : '—' },
            { key: 'ip', header: 'IP', cell: (r) => r.ip ?? '—' },
          ]} />
      </Card>
      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.action ?? ''}>
        {selected && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-3 gap-2">
              <dt className="text-muted">When</dt><dd className="col-span-2">{formatDate(selected.createdAt, { withTime: true })}</dd>
              <dt className="text-muted">Actor</dt><dd className="col-span-2">{selected.actor?.email ?? 'System'}</dd>
              <dt className="text-muted">Tenant</dt><dd className="col-span-2 break-all">{selected.tenantId ?? '—'}</dd>
              <dt className="text-muted">Request</dt><dd className="col-span-2 break-all">{selected.requestId ?? '—'}</dd>
              <dt className="text-muted">User agent</dt><dd className="col-span-2 break-all">{selected.userAgent ?? '—'}</dd>
            </dl>
            <div><p className="mb-1 font-medium">Before</p><JsonView value={selected.before} /></div>
            <div><p className="mb-1 font-medium">After</p><JsonView value={selected.after} /></div>
          </div>
        )}
      </Drawer>
    </>
  );
}
