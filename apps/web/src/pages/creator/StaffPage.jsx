import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, Plus, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { PERIOD_OPTIONS, inPeriod } from '../../utils/period.js';
import { toCsv } from '../../utils/csv.js';
import { saveBlob } from '../../utils/download.js';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { ListToolbar } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, DataTable, Dropdown, DropdownItem, DropdownSeparator, EmptyState, Input, Modal, Select, Tabs, toast } from '../../components/ui/index.js';
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
  const [search, setSearch] = useState('');
  const [roleF, setRoleF] = useState();
  const [joinedF, setJoinedF] = useState();
  const [lastF, setLastF] = useState();
  const [urlParams, setUrlParams] = useSearchParams();
  // Graphy splits the team into Administrators and Instructors; instructors teach courses or hold the instructor role.
  const view = urlParams.get('view') === 'instructors' ? 'instructors' : 'admins';
  const setView = (v) => setUrlParams(v === 'instructors' ? { view: v } : {}, { replace: true });
  const allMembers = q.data?.members ?? [];
  const isInstructor = (r) => r.role.key === 'INSTRUCTOR' || r.courseCount > 0;
  const members = view === 'instructors' ? allMembers.filter(isInstructor) : allMembers;
  const term = search.trim().toLowerCase();
  const rows = members.filter((r) => (!term || `${r.user.fullName} ${r.user.email}`.toLowerCase().includes(term)) && (!roleF || r.role.key === roleF)
    && inPeriod(r.createdAt, joinedF) && (lastF === 'never' ? !r.user.lastLoginAt : !lastF || (r.user.lastLoginAt && inPeriod(r.user.lastLoginAt, lastF))));
  const exportCsv = () => saveBlob(new Blob([toCsv(['Name', 'Email', 'Role', 'Courses taught', 'Joined on', 'Last sign-in'],
    rows.map((r) => [r.user.fullName, r.user.email, r.role.name, r.courseCount ?? 0, r.createdAt?.slice(0, 10), r.user.lastLoginAt?.slice(0, 19).replace('T', ' ') ?? 'Never']))], { type: 'text/csv' }), `${view === 'instructors' ? 'instructors' : 'administrators'}.csv`);
  const roleOptions = [...new Map(members.map((r) => [r.role.key, r.role.name])).entries()].map(([value, label]) => ({ value, label }));
  const twoLine = (d) => (d ? <div className="leading-tight"><p className="text-fg-2">{formatDate(d)}</p><p className="text-xs text-muted">{new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p></div> : <span className="text-muted">Never</span>);

  return (
    <>
      <PageHeader title={view === 'instructors' ? 'Instructors' : 'Administrators'} count={q.data ? members.length : undefined}
        description={view === 'instructors' ? 'Manage your instructor team.' : 'Manage your administrative team and what each member can do.'} breadcrumbs={[{ label: 'Users' }]}
        actions={<><Button variant="secondary" leftIcon={Download} disabled={!rows.length} onClick={exportCsv}>Export</Button><Button leftIcon={UserPlus} onClick={() => { setInvite({ email: '', roleKey: 'INSTRUCTOR' }); setError(null); setOpen(true); }}>{view === 'instructors' ? 'Add instructor' : 'Add'}</Button></>} />
      <Tabs className="mb-4" value={view} onChange={setView} tabs={[{ value: 'admins', label: 'Administrators', count: allMembers.length || undefined }, { value: 'instructors', label: 'Instructors', count: allMembers.filter(isInstructor).length || undefined }]} />
      <Card>
        <ListToolbar search={search} onSearch={setSearch} placeholder="Search by name or email" count={rows.length} noun={view === 'instructors' ? 'instructor' : 'admin'}
          filtered={Boolean(term || roleF || joinedF || lastF)} onReset={() => { setSearch(''); setRoleF(undefined); setJoinedF(undefined); setLastF(undefined); }}
          filters={<>
            <FilterChip label="Date joined" value={joinedF} onChange={setJoinedF} options={PERIOD_OPTIONS} />
            <FilterChip label="Last login" value={lastF} onChange={setLastF} options={[...PERIOD_OPTIONS, { value: 'never', label: 'Never signed in' }]} />
            <FilterChip label="Role" value={roleF} onChange={setRoleF} options={roleOptions} />
          </>} />
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={rows}
          empty={view === 'instructors' && !allMembers.some(isInstructor) ? <EmptyState title="Nothing here yet!" description="Invite team members with the Instructor role, or assign them to a course, to see them here." /> : <EmptyState title="No members match" description="Try a different search or clear the filters." />}
          columns={[
            { key: 'name', header: 'Member', cell: (r) => <div className="flex items-center gap-2.5"><Avatar name={r.user.fullName} size="sm" /><div className="min-w-0"><p className="truncate font-medium text-fg">{r.user.fullName} {r.user.id === auth.user?.id && <Badge>You</Badge>}</p><p className="truncate text-xs text-muted">{r.user.email}</p></div></div> },
            { key: 'role', header: 'Role', cell: (r) => <Badge tone={r.role.key === 'OWNER' ? 'primary' : 'neutral'}>{r.role.name}</Badge> },
            ...(view === 'instructors' ? [{ key: 'courses', header: 'Courses taught', align: 'right', cell: (r) => r.courseCount ?? 0 }] : []),
            { key: 'createdAt', header: 'Joined', cell: (r) => twoLine(r.createdAt) },
            { key: 'last', header: 'Last sign-in', cell: (r) => twoLine(r.user.lastLoginAt) },
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
