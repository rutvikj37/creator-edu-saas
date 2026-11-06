import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, DataTable, Dropdown, DropdownItem, DropdownSeparator, Input, Modal, Select, toast } from '../../components/ui/index.js';
import { rolesApi, staffApi } from '../../services/api/creator.js';
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
          <Select label="Role" value={invite.roleKey} onChange={(e) => setInvite({ ...invite, roleKey: e.target.value })} options={roles.map((r) => ({ value: r.key, label: `${r.name} — ${ROLE_HELP[r.key] ?? 'Custom role'}` }))} />
        </div>
      </Modal>
      <RolesCard onChanged={refresh} />
      <ConfirmDialog open={Boolean(removing)} onClose={() => setRemoving(null)} title={`Remove ${removing?.user.fullName}?`} description="They lose access to this academy immediately." confirmLabel="Remove" loading={remove.isPending} onConfirm={() => remove.mutate(removing.id)} />
    </>
  );
}

function RoleModal({ role, catalog, onClose, onSaved }) {
  const [name, setName] = useState(role?.name ?? '');
  const [perms, setPerms] = useState(new Set(role?.permissions ?? []));
  const [error, setError] = useState(null);
  const save = useMutation({
    mutationFn: () => (role ? rolesApi.update(role.id, { name, permissions: [...perms] }) : rolesApi.create({ name, permissions: [...perms] })),
    onSuccess: () => { toast.success(role ? 'Role updated' : 'Role created'); onSaved(); },
    onError: (e) => setError(e.details?.map((d) => d.message).join(' ') ?? e.message),
  });
  const toggle = (k) => { const n = new Set(perms); if (n.has(k)) n.delete(k); else n.add(k); setPerms(n); };
  return (
    <Modal open onClose={onClose} title={role ? `Edit ${role.name}` : 'New role'} size="lg" description="Members with this role can do exactly what you tick. Changes apply straight away."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!name.trim() || !perms.size} onClick={() => { setError(null); save.mutate(); }}>{role ? 'Save role' : 'Create role'}</Button></>}>
      <div className="space-y-4">
        <Input label="Role name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Course editor" autoFocus />
        <div className="grid gap-4 sm:grid-cols-2">
          {catalog.map((g) => (
            <fieldset key={g.group} className="space-y-1.5">
              <legend className="mb-1 text-sm font-medium">{g.group}</legend>
              {g.items.map((i) => <Checkbox key={i.key} label={i.label} checked={perms.has(i.key)} onChange={() => toggle(i.key)} />)}
            </fieldset>
          ))}
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

/** Built-in and custom roles; custom ones are created from chosen permissions. */
function RolesCard({ onChanged }) {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const catalog = useQuery({ queryKey: ['roles', 'catalog'], queryFn: rolesApi.catalog });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const done = () => { setEditing(null); qc.invalidateQueries({ queryKey: ['roles'] }); onChanged(); };
  const remove = useMutation({ mutationFn: (id) => rolesApi.remove(id), onSuccess: () => { toast.success('Role deleted'); setDeleting(null); done(); }, onError: (e) => { toast.error(e.message); setDeleting(null); } });
  const labels = new Map((catalog.data ?? []).flatMap((g) => g.items.map((i) => [i.key, i.label])));
  return (
    <Card className="mt-6">
      <CardHeader title="Roles" description="Use a built-in role or create your own with exactly the permissions you choose." actions={<Button size="sm" leftIcon={Plus} disabled={!catalog.data} onClick={() => setEditing('new')}>New role</Button>} />
      <CardBody className="divide-y divide-line p-0">
        {(roles.data ?? []).map((r) => (
          <div key={r.id} className="flex items-start gap-3 px-5 py-3 text-sm">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{r.name} {r.custom ? <Badge className="ml-1">Custom</Badge> : <Badge className="ml-1" tone="neutral">Built-in</Badge>} <span className="ml-1 text-xs font-normal text-muted">{r.members} member{r.members === 1 ? '' : 's'}</span></p>
              <p className="line-clamp-2 text-xs text-muted">{r.permissions.map((p) => labels.get(p) ?? p).join(' · ')}</p>
            </div>
            {r.custom && <>
              <Button size="icon-sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil className="size-4" /></Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => setDeleting(r)}><Trash2 className="size-4" /></Button>
            </>}
          </div>
        ))}
      </CardBody>
      {editing && catalog.data && <RoleModal role={editing === 'new' ? null : editing} catalog={catalog.data} onClose={() => setEditing(null)} onSaved={done} />}
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} title={`Delete ${deleting?.name}?`} description="Roles that are still assigned cannot be deleted." confirmLabel="Delete" loading={remove.isPending} onConfirm={() => remove.mutate(deleting.id)} />
    </Card>
  );
}
