import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import { Badge, Card, DataTable, EmptyState, StatusBadge } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDate } from '../../utils/format.js';

export function CreatorsPage() {
  const navigate = useNavigate();
  const [params, update] = useListParams({ sort: '-createdAt' });
  const q = useQuery({
    queryKey: ['platform', 'creators', params],
    queryFn: () => platformApi.creators(params),
    placeholderData: (p) => p,
  });

  return (
    <>
      <PageHeader
        title="Creators"
        description="Owners and managers of academies across the platform."
        breadcrumbs={[{ label: 'Users' }, { label: 'Creators' }]}
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-end">
          <SearchInput
            className="md:w-80"
            value={params.q ?? ''}
            onChange={(v) => update({ q: v })}
            placeholder="Search name, email, phone or academy..."
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
          empty={<EmptyState icon={Users} title="No creators match" description="Try a different search term." />}
          columns={[
            {
              key: 'fullName',
              header: 'Creator',
              sortable: true,
              cell: (r) => (
                <div>
                  <p className="font-medium text-fg">{r.fullName}</p>
                  <p className="text-xs text-muted">{r.email}</p>
                </div>
              ),
            },
            {
              key: 'phone',
              header: 'Phone',
              cell: (r) => r.phone ?? <span className="text-muted">—</span>,
            },
            {
              key: 'academies',
              header: 'Academies',
              cell: (r) => (
                <div className="flex flex-wrap gap-1.5">
                  {(r.academies ?? []).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/super-admin/tenants/${a.id}`);
                      }}
                      className="cursor-pointer hover:opacity-80"
                    >
                      <Badge tone="primary">{a.name}</Badge>
                    </button>
                  ))}
                </div>
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
              header: 'Joined',
              sortable: true,
              cell: (r) => formatDate(r.createdAt),
            },
            {
              key: 'lastLoginAt',
              header: 'Last active',
              cell: (r) => (r.lastLoginAt ? formatDate(r.lastLoginAt) : <span className="text-muted">Never</span>),
            },
          ]}
        />
      </Card>
    </>
  );
}
