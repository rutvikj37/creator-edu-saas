import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { UserPlus } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, Dropdown, DropdownItem, Input, Modal, StatusBadge, toast } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate } from '../../utils/format.js';
import { applyApiErrors } from '../../utils/forms.js';

const ROLES = [
  { key: 'SUPER_ADMIN', label: 'Super Admin', description: 'Full platform access' },
  { key: 'PLATFORM_ADMIN', label: 'Platform Admin', description: 'Tenants, content, settings' },
  { key: 'FINANCE_ADMIN', label: 'Finance Admin', description: 'Revenue, refunds, payouts' },
  { key: 'SUPPORT_ADMIN', label: 'Support Admin', description: 'Support tickets' },
];

const inviteSchema = z.object({ email: z.email('Enter a valid email'), fullName: z.string().trim().min(2, 'Enter a name'), roles: z.array(z.string()).min(1, 'Choose at least one role') });

function RolePicker({ value, onChange }) {
  return (
    <div className="space-y-2">
      {ROLES.map((r) => (
        <Checkbox key={r.key} label={r.label} description={r.description} checked={value.includes(r.key)}
          onChange={(e) => onChange(e.target.checked ? [...value, r.key] : value.filter((k) => k !== r.key))} />
      ))}
    </div>
  );
}

export function AdminsPage() {
  const auth = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'admins'], queryFn: platformApi.admins });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editRoles, setEditRoles] = useState([]);
  const [suspending, setSuspending] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform', 'admins'] });
  const form = useForm({ resolver: zodResolver(inviteSchema), defaultValues: { email: '', fullName: '', roles: [] } });

  const onInvite = form.handleSubmit(async (values) => {
    try {
      const r = await platformApi.inviteAdmin(values);
      toast.success(r.invited ? 'Invitation sent' : 'Roles granted to existing user');
      setInviteOpen(false);
      form.reset();
      refresh();
    } catch (e) {
      applyApiErrors(e, form.setError, ['email', 'fullName', 'roles']);
    }
  });
  const saveRoles = useMutation({ mutationFn: () => platformApi.setAdminRoles(editing.id, editRoles), onSuccess: () => { toast.success('Roles updated'); setEditing(null); refresh(); }, onError: (e) => toast.error(e.message) });
  const suspend = useMutation({ mutationFn: (id) => platformApi.suspendAdmin(id), onSuccess: () => { toast.success('Administrator suspended'); setSuspending(null); refresh(); }, onError: (e) => toast.error(e.message) });
  const reactivate = useMutation({ mutationFn: (id) => platformApi.reactivateAdmin(id), onSuccess: () => { toast.success('Administrator reactivated'); refresh(); }, onError: (e) => toast.error(e.message) });

  return (
    <>
      <PageHeader title="Administrators" count={Array.isArray(q.data) ? q.data.length : undefined} description="People who can operate the platform. Two-factor authentication is mandatory." breadcrumbs={[{ label: 'Users' }, { label: 'Admins & roles' }]}
        actions={<Button leftIcon={UserPlus} onClick={() => setInviteOpen(true)}>Invite admin</Button>} />
      <Card>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data ?? []}
          columns={[
            { key: 'fullName', header: 'Name', cell: (r) => <div><p className="font-medium text-fg">{r.fullName} {r.id === auth.user?.id && <Badge>You</Badge>}</p><p className="text-xs text-muted">{r.email}</p></div> },
            { key: 'roles', header: 'Roles', cell: (r) => <div className="flex flex-wrap gap-1">{r.roles.map((x) => <Badge key={x.key} tone="primary">{x.name}</Badge>)}</div> },
            { key: '2fa', header: '2FA', cell: (r) => (r.twoFactorEnabledAt ? <Badge tone="success">On</Badge> : <Badge tone="warning">Pending</Badge>) },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'lastLoginAt', header: 'Last sign-in', cell: (r) => formatDate(r.lastLoginAt, { withTime: true }) },
            { key: 'actions', header: '', align: 'right', cell: (r) => r.id !== auth.user?.id && (
              <Dropdown trigger={(p) => <Button variant="ghost" size="sm" {...p}>Manage</Button>}>
                <DropdownItem onClick={() => { setEditing(r); setEditRoles(r.roles.map((x) => x.key)); }}>Edit roles</DropdownItem>
                {r.status === 'SUSPENDED' ? <DropdownItem onClick={() => reactivate.mutate(r.id)}>Reactivate</DropdownItem> : <DropdownItem danger onClick={() => setSuspending(r)}>Suspend</DropdownItem>}
              </Dropdown>
            ) },
          ]} />
      </Card>
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite administrator" description="They'll receive an email to set a password, then must enrol two-factor authentication."
        footer={<><Button variant="secondary" onClick={() => setInviteOpen(false)}>Cancel</Button><Button loading={form.formState.isSubmitting} onClick={onInvite}>Send invite</Button></>}>
        <form onSubmit={onInvite} noValidate className="space-y-4">
          <Input label="Full name" {...form.register('fullName')} error={form.formState.errors.fullName?.message} />
          <Input label="Email" type="email" {...form.register('email')} error={form.formState.errors.email?.message} />
          <RolePicker value={form.watch('roles')} onChange={(v) => form.setValue('roles', v, { shouldValidate: true })} />
          {form.formState.errors.roles && <p className="text-xs text-red-600">{form.formState.errors.roles.message}</p>}
        </form>
      </Modal>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Roles for ${editing?.fullName}`}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={!editRoles.length} loading={saveRoles.isPending} onClick={() => saveRoles.mutate()}>Save roles</Button></>}>
        <RolePicker value={editRoles} onChange={setEditRoles} />
      </Modal>
      <ConfirmDialog open={Boolean(suspending)} onClose={() => setSuspending(null)} title={`Suspend ${suspending?.fullName}?`} description="They are signed out everywhere and can't sign in until reactivated."
        confirmLabel="Suspend" loading={suspend.isPending} onConfirm={() => suspend.mutate(suspending.id)} />
    </>
  );
}
