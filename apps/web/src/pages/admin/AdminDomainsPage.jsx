import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Globe } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import { Badge, Card, DataTable, EmptyState, Select, StatusBadge } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDate } from '../../utils/format.js';

const TYPES = [
  { value: 'SUBDOMAIN', label: 'Subdomain' },
  { value: 'CUSTOM', label: 'Custom Domain' },
];

const STATUSES = [
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'FAILED', label: 'Failed' },
];

export function AdminDomainsPage() {
  const navigate = useNavigate();
  const [params, update] = useListParams({ sort: '-createdAt' });
  const q = useQuery({ queryKey: ['platform', 'domains', params], queryFn: () => platformApi.domains(params), placeholderData: (p) => p });

  return (
    <>
      <PageHeader
        title="Domains"
        description="All subdomains and custom domains across all academies."
        breadcrumbs={[{ label: 'Tenants', to: '/super-admin/tenants' }, { label: 'Domains' }]}
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-end">
          <SearchInput
            className="md:w-80"
            value={params.q ?? ''}
            onChange={(v) => update({ q: v })}
            placeholder="Search hostname or academy..."
          />
          <Select
            aria-label="Domain type"
            placeholder="All types"
            options={TYPES}
            value={params.type ?? ''}
            onChange={(e) => update({ type: e.target.value })}
            className="md:w-48"
          />
          <Select
            aria-label="Status"
            placeholder="All statuses"
            options={STATUSES}
            value={params.status ?? ''}
            onChange={(e) => update({ status: e.target.value })}
            className="md:w-48"
          />
        </div>
        <DataTable
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          rows={q.data?.items ?? []}
          meta={q.data?.meta}
          onPageChange={(page) => update({ page }, { resetPage: false })}
          sort={params.sort}
          onSortChange={(sort) => update({ sort })}
          onRowClick={(row) => navigate(`/super-admin/tenants/${row.tenant.id}`)}
          empty={<EmptyState icon={Globe} title="No domains match" description="Try a different search or filter." />}
          columns={[
            {
              key: 'hostname',
              header: 'Hostname',
              sortable: true,
              cell: (r) => (
                <div className="flex items-center gap-2">
                  <span className="font-medium text-fg">{r.hostname}</span>
                  {r.isPrimary && <Badge tone="primary">Primary</Badge>}
                  <a
                    href={`${typeof window !== 'undefined' ? window.location.protocol : 'http:'}//${r.hostname}${typeof window !== 'undefined' && window.location.port ? `:${window.location.port}` : ''}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-muted hover:text-fg"
                    title="Open academy"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                </div>
              ),
            },
            {
              key: 'tenant',
              header: 'Academy',
              cell: (r) => (
                <div>
                  <p className="font-medium text-fg">{r.tenant.name}</p>
                  <p className="text-xs text-muted">{r.tenant.slug}</p>
                </div>
              ),
            },
            {
              key: 'type',
              header: 'Type',
              cell: (r) => (
                <Badge tone={r.type === 'CUSTOM' ? 'accent' : 'neutral'}>
                  {r.type === 'CUSTOM' ? 'Custom Domain' : 'Subdomain'}
                </Badge>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              sortable: true,
              cell: (r) => <StatusBadge status={r.status} />,
            },
            {
              key: 'createdAt',
              header: 'Added',
              sortable: true,
              cell: (r) => formatDate(r.createdAt),
            },
          ]}
        />
      </Card>
    </>
  );
}
