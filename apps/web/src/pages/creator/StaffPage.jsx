import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Badge, Button, Card, CardHeader, ConfirmDialog, DataTable, Dropdown, DropdownItem, DropdownSeparator, Input, Modal, Select, toast } from '../../components/ui/index.js';
import { staffApi } from '../../services/api/creator.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate } from '../../utils/format.js';

const ROLE_HELP = { ADMIN: 'Everything except billing', INSTRUCTOR: 'Courses, grading, live classes', CONTENT_MANAGER: 'Courses, website, certificates', SALES_MANAGER: 'Orders, coupons, marketing', SUPPORT_AGENT: 'Students and support' };

export function StaffPage() {
  const auth = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['staff'], queryFn: staffApi.list });
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState({ email: '', roleKey: 'INSTRUCTOR' });
  const [error, setError] = useState(null);
  const [removing, setRemoving] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['staff'] });
  const send = useMutation({ mutationFn: () => staffApi.invite(invite), onSuccess: () => { toast.success('Invitation sent'); setOpen(false); refresh(); }, onError: (e) => setError(e.details?.[0]?.message ?? e.message) });
  const revoke = useMutation({ mutationFn: staffApi.revoke, onSuccess: () => { toast.success('Invitation revoked'); refresh(); }, onError: (e) => toast.error(e.message) });
  const role = useMutation({ mutationFn: ({ id, roleKey }) => staffApi.changeRole(id, roleKey), onSuccess: () => { toast.success('Role updated'); refresh(); }, onError: (e) => toast.error(e.message) });
  const remove = useMutation({ mutationFn: (id) => staffApi.remove(id), onSuccess: () => { toast.success('Removed from academy'); setRemoving(null); refresh(); }, onError: (e) => toast.error(e.message) });
  const roles = q.data?.assignableRoles ?? [];

  return (
    <>
      <PageHeader title="Staff" description="Invite instructors and team members, and control what they can do." breadcrumbs={[{ label: 'Workspace' }, { label: 'Staff' }]}
        actions={<Button leftIcon={UserPlus} onClick={() => { setInvite({ email: '', roleKey: 'INSTRUCTOR' }); setError(null); setOpen(true); }}>Invite member</Button>} />
      <Card>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.members ?? []}
          columns={[
            { key: 'name', header: 'Member', cell: (r) => <div><p className="font-medium text-fg">{r.user.fullName} {r.user.id === auth.user?.id && <Badge>You</Badge>}</p><p className="text-xs text-muted">{r.user.email}</p></div> },
            { key: 'role', header: 'Role', cell: (r) => <Badge tone={r.role.key === 'OWNER' ? 'primary' : 'neutral'}>{r.role.name}</Badge> },
            { key: 'createdAt', header: 'Joined', cell: (r) => formatDate(r.createdAt) },
            { key: 'last', header: 'Last sign-in', cell: (r) => formatDate(r.user.lastLoginAt, { withTime: true }) },
            { key: 'a', header: '', align: 'right', cell: (r) => r.role.key !== 'OWNER' && r.user.id !== auth.user?.id && (
              <Dropdown trigger={(p) => <Button variant="ghost" size="sm" {...p}>Manage</Button>}>
                {roles.filter((x) => x.key !== r.role.key).map((x) => <DropdownItem key={x.key} onClick={() => role.mutate({ id: r.id, roleKey: x.key })}>Make {x.name}</DropdownItem>)}
                <DropdownSeparator />
                <DropdownItem danger onClick={() => setRemoving(r)}>Remove from academy</DropdownItem>
              </Dropdown>
            ) },
          ]} />
      </Card>
      {q.data?.invitations?.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Pending invitations" />
          <ul className="divide-y divide-line">
            {q.data.invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span>{i.email} <Badge className="ml-2">{i.role?.name}</Badge></span>
                <span className="flex items-center gap-3 text-muted">Expires {formatDate(i.expiresAt)}<Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)}>Revoke</Button></span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Invite a team member" description="They'll get an email link valid for 7 days."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={send.isPending} disabled={!invite.email} onClick={() => { setError(null); send.mutate(); }}>Send invitation</Button></>}>
        <div className="space-y-4">
          <Input label="Email" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} error={error} autoFocus />
          <Select label="Role" value={invite.roleKey} onChange={(e) => setInvite({ ...invite, roleKey: e.target.value })} options={roles.map((r) => ({ value: r.key, label: `${r.name} — ${ROLE_HELP[r.key] ?? ''}` }))} />
        </div>
      </Modal>
      <ConfirmDialog open={Boolean(removing)} onClose={() => setRemoving(null)} title={`Remove ${removing?.user.fullName}?`} description="They lose access to this academy immediately." confirmLabel="Remove" loading={remove.isPending} onConfirm={() => remove.mutate(removing.id)} />
    </>
  );
}
