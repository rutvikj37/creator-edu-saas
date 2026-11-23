import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { ListToolbar } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { PERIOD_OPTIONS } from '../../utils/period.js';
import { presetRange } from '../../components/common/DateRangeFilter.jsx';
import { JsonView } from '../../components/common/JsonView.jsx';
import { Card, DataTable, Drawer, EmptyState } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDate } from '../../utils/format.js';

export function AuditLogsPage() {
  const [params, update] = useListParams({ pageSize: 25 });
  const [selected, setSelected] = useState(null);
  const q = useQuery({
    queryKey: ['platform', 'audit', params],
    queryFn: () => { const r = params.period ? presetRange(params.period) : { from: params.from, to: params.to }; const { period: _p, ...rest } = params; return platformApi.auditLogs({ ...rest, from: r.from ? `${r.from}T00:00:00Z` : undefined, to: r.to ? `${r.to}T23:59:59Z` : undefined }); },
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader title="Audit logs" count={q.data?.meta?.total} description="Security-relevant and administrative actions. Entries cannot be edited." breadcrumbs={[{ label: 'System' }, { label: 'Audit logs' }]} />
      <Card>
        <ListToolbar search={params.action} onSearch={(v) => update({ action: v })} placeholder="Action prefix, e.g. tenant." count={q.data?.meta?.total} noun="entry" plural="entries"
          filtered={Boolean(params.period || params.from || params.to)} onReset={() => update({ period: undefined, from: undefined, to: undefined })}
          filters={<FilterChip label="Time period" value={params.period} onChange={(v) => update({ period: v, from: undefined, to: undefined })} options={PERIOD_OPTIONS} />} />
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
