import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { ListToolbar } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { Card, DataTable, EmptyState, StatusBadge } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDate, formatNumber } from '../../utils/format.js';

const STATUSES = ['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'PENDING_DELETION'].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ') }));

export function TenantsPage() {
  const navigate = useNavigate();
  const [params, update] = useListParams({ sort: '-createdAt' });
  const plans = useQuery({ queryKey: ['platform', 'plans'], queryFn: platformApi.plans, staleTime: 60_000 });
  const q = useQuery({ queryKey: ['platform', 'tenants', params], queryFn: () => platformApi.tenants(params), placeholderData: (p) => p });

  return (
    <>
      <PageHeader title="Tenants" count={q.data?.meta?.total} description="Every academy on the platform." />
      <Card>
        <ListToolbar search={params.q} onSearch={(v) => update({ q: v })} placeholder="Search name, slug or owner email" count={q.data?.meta?.total} noun="tenant"
          filtered={Boolean(params.status || params.planId)} onReset={() => update({ status: undefined, planId: undefined })}
          filters={<>
            <FilterChip label="Status" value={params.status} onChange={(v) => update({ status: v })} options={STATUSES} />
            <FilterChip label="Plan" value={params.planId} onChange={(v) => update({ planId: v })} options={(plans.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
          </>} />
        <DataTable
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          rows={q.data?.items ?? []}
          meta={q.data?.meta}
          onPageChange={(page) => update({ page }, { resetPage: false })}
          sort={params.sort}
          onSortChange={(sort) => update({ sort })}
          onRowClick={(row) => navigate(`/super-admin/tenants/${row.id}`)}
          empty={<EmptyState icon={Building2} title="No tenants match" description="Try a different search or filter." />}
          columns={[
            { key: 'name', header: 'Academy', sortable: true, cell: (r) => <div><p className="font-medium text-fg">{r.name}</p><p className="text-xs text-muted">{r.slug}</p></div> },
            { key: 'owner', header: 'Owner', cell: (r) => <div><p>{r.owner.fullName}</p><p className="text-xs text-muted">{r.owner.email}</p></div> },
            { key: 'plan', header: 'Plan', cell: (r) => (r.subscription ? <span>{r.subscription.plan.name} <span className="text-xs text-muted">· {r.subscription.status.toLowerCase()}</span></span> : <span className="text-muted">None</span>) },
            { key: 'status', header: 'Status', sortable: true, cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'studentCount', header: 'Students', align: 'right', cell: (r) => formatNumber(r.studentCount) },
            { key: 'createdAt', header: 'Created', sortable: true, cell: (r) => formatDate(r.createdAt) },
          ]}
        />
      </Card>
    </>
  );
}
