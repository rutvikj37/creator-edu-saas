import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Building2, CheckCircle2, CreditCard, Eye, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dropdown,
  DropdownItem,
  EmptyState,
  Modal,
  Select,
  StatusBadge,
  Textarea,
  toast,
} from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDate, formatNumber } from '../../utils/format.js';
import { CreateAgencyModal } from './CreateAgencyModal.jsx';
import { EditAgencyModal } from './EditAgencyModal.jsx';

const STATUSES = ['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'PENDING_DELETION'].map((s) => ({
  value: s,
  label: s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' '),
}));

export function TenantsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [suspendTarget, setSuspendTarget] = useState(null);
  const [suspendReason, setSuspendReason] = useState('');

  const [params, update] = useListParams({ sort: '-createdAt' });
  const plans = useQuery({ queryKey: ['platform', 'plans'], queryFn: platformApi.plans, staleTime: 60_000 });
  const q = useQuery({
    queryKey: ['platform', 'tenants', params],
    queryFn: () => platformApi.tenants(params),
    placeholderData: (p) => p,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['platform', 'tenants'] });
  };

  const activateMutation = useMutation({
    mutationFn: (id) => platformApi.activateTenant(id),
    onSuccess: () => {
      toast.success('Agency activated successfully');
      refresh();
    },
    onError: (err) => toast.error(err.message || 'Failed to activate agency'),
  });

  const suspendMutation = useMutation({
    mutationFn: () => platformApi.suspendTenant(suspendTarget.id, suspendReason),
    onSuccess: () => {
      toast.success('Agency suspended');
      setSuspendTarget(null);
      setSuspendReason('');
      refresh();
    },
    onError: (err) => toast.error(err.message || 'Failed to suspend agency'),
  });

  const deleteMutation = useMutation({
    mutationFn: (t) => platformApi.deleteTenant(t.id, t.slug),
    onSuccess: () => {
      toast.success('Deletion scheduled successfully');
      setDeleteTarget(null);
      refresh();
    },
    onError: (err) => toast.error(err.message || 'Failed to schedule deletion'),
  });

  return (
    <>
      <PageHeader
        title="Agencies & Tenants"
        description="Every agency and academy on the platform."
        breadcrumbs={[{ label: 'Agencies' }]}
        actions={
          <Button onClick={() => setCreateOpen(true)} leftIcon={Plus}>
            Create agency
          </Button>
        }
      />

      <CreateAgencyModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => refresh()}
      />

      {editTarget && (
        <EditAgencyModal
          open={Boolean(editTarget)}
          tenant={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={() => refresh()}
        />
      )}

      {suspendTarget && (
        <Modal
          open={Boolean(suspendTarget)}
          onClose={() => {
            setSuspendTarget(null);
            setSuspendReason('');
          }}
          title={`Suspend ${suspendTarget.name}?`}
          description="The workspace becomes read-only, the portal goes offline, and students are signed out."
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setSuspendTarget(null);
                  setSuspendReason('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={suspendReason.trim().length < 3}
                loading={suspendMutation.isPending}
                onClick={() => suspendMutation.mutate()}
              >
                Suspend
              </Button>
            </>
          }
        >
          <Textarea
            label="Reason (shown to the creator) *"
            required
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            rows={3}
            placeholder="e.g. Terms violation or pending payment review"
          />
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
          title={`Delete ${deleteTarget.name}?`}
          confirmText={deleteTarget.slug}
          confirmLabel="Schedule deletion"
          description="The academy portal goes offline now and will be permanently removed after 30 days unless restored."
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteTarget)}
        />
      )}

      <Card className="min-h-[380px]">
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-end">
          <SearchInput
            className="md:w-80"
            value={params.q ?? ''}
            onChange={(v) => update({ q: v })}
            placeholder="Search name, slug or owner email"
          />
          <Select
            aria-label="Status"
            placeholder="All statuses"
            options={STATUSES}
            value={params.status ?? ''}
            onChange={(e) => update({ status: e.target.value })}
            className="md:w-48"
          />
          <Select
            aria-label="Plan"
            placeholder="All plans"
            options={(plans.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            value={params.planId ?? ''}
            onChange={(e) => update({ planId: e.target.value })}
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
          onRowClick={(row) => navigate(`/super-admin/tenants/${row.id}`)}
          empty={<EmptyState icon={Building2} title="No tenants match" description="Try a different search or filter." />}
          columns={[
            {
              key: 'name',
              header: 'Academy',
              sortable: true,
              cell: (r) => (
                <div>
                  <p className="font-medium text-fg">{r.name}</p>
                  <p className="text-xs text-muted">{r.slug}</p>
                </div>
              ),
            },
            {
              key: 'owner',
              header: 'Owner',
              cell: (r) => (
                <div>
                  <p className="font-medium text-fg">{r.owner?.fullName || '—'}</p>
                  <p className="text-xs text-muted">{r.owner?.email}</p>
                </div>
              ),
            },
            {
              key: 'plan',
              header: 'Plan',
              cell: (r) =>
                r.subscription ? (
                  <span>
                    {r.subscription.plan.name}{' '}
                    <span className="text-xs text-muted">· {r.subscription.status.toLowerCase()}</span>
                  </span>
                ) : (
                  <span className="text-muted">None</span>
                ),
            },
            {
              key: 'status',
              header: 'Status',
              sortable: true,
              cell: (r) => <StatusBadge status={r.status} />,
            },
            {
              key: 'studentCount',
              header: 'Students',
              align: 'right',
              className: 'whitespace-nowrap',
              cell: (r) => formatNumber(r.studentCount),
            },
            {
              key: 'createdAt',
              header: 'Created',
              sortable: true,
              className: 'whitespace-nowrap',
              cell: (r) => formatDate(r.createdAt),
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              className: 'w-12 text-right pr-4',
              cell: (r) => (
                <div onClick={(e) => e.stopPropagation()} className="flex justify-end">
                  <Dropdown
                    align="right"
                    trigger={(props) => (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${r.name}`}
                        className="size-8 text-muted hover:bg-surface-2 hover:text-fg"
                        {...props}
                      >
                        <MoreVertical className="size-4" />
                      </Button>
                    )}
                  >
                    <DropdownItem icon={Eye} onClick={() => navigate(`/super-admin/tenants/${r.id}`)}>
                      View details
                    </DropdownItem>
                    <DropdownItem icon={Pencil} onClick={() => setEditTarget(r)}>
                      Edit agency
                    </DropdownItem>
                    <DropdownItem
                      icon={CreditCard}
                      onClick={() => navigate(`/super-admin/tenants/${r.id}?tab=subscription`)}
                    >
                      Change plan
                    </DropdownItem>
                    {r.status === 'ACTIVE' ? (
                      <DropdownItem icon={Ban} onClick={() => setSuspendTarget(r)}>
                        Suspend agency
                      </DropdownItem>
                    ) : r.status === 'SUSPENDED' || r.status === 'ONBOARDING' ? (
                      <DropdownItem
                        icon={CheckCircle2}
                        onClick={() => activateMutation.mutate(r.id)}
                      >
                        Activate agency
                      </DropdownItem>
                    ) : null}
                    <DropdownItem danger icon={Trash2} onClick={() => setDeleteTarget(r)}>
                      Delete agency
                    </DropdownItem>
                  </Dropdown>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
