import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { Button, Card, ConfirmDialog, DataTable, EmptyState, Input, Modal, StatusBadge, toast } from '../../components/ui/index.js';
import { creatorLearnApi } from '../../services/api/learn.js';
import { formatDate } from '../../utils/format.js';

export function CourseStudentsTab({ courseId, canManage }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['creator', 'course-enrollments', courseId], queryFn: () => creatorLearnApi.courseEnrollments(courseId) });
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['creator', 'course-enrollments', courseId] });
  const enroll = useMutation({ mutationFn: () => creatorLearnApi.enroll(courseId, email), onSuccess: (r) => { toast.success(r.invited ? 'Account created and invitation sent' : 'Student enrolled'); setOpen(false); setEmail(''); refresh(); }, onError: (e) => setError(e.details?.[0]?.message ?? e.message) });
  const revoke = useMutation({ mutationFn: (id) => creatorLearnApi.revoke(id), onSuccess: () => { toast.success('Access revoked'); setRevoking(null); refresh(); }, onError: (e) => toast.error(e.message) });
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line p-4"><p className="font-semibold">Enrolled students</p>{canManage && <Button size="sm" leftIcon={UserPlus} onClick={() => { setOpen(true); setError(null); }}>Enrol student</Button>}</div>
      <DataTable loading={q.isLoading} error={q.error} rows={q.data ?? []} empty={<EmptyState title="No students yet" description="Students appear here once they enrol or you add them." />}
        columns={[
          { key: 'student', header: 'Student', cell: (r) => <div><p className="font-medium text-fg">{r.student?.fullName}</p><p className="text-xs text-muted">{r.student?.email}</p></div> },
          { key: 'progressPercent', header: 'Progress', cell: (r) => `${r.progressPercent}%` },
          { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          { key: 'source', header: 'Source', cell: (r) => r.source.toLowerCase() },
          { key: 'startedAt', header: 'Enrolled', cell: (r) => formatDate(r.startedAt) },
          { key: 'a', header: '', align: 'right', cell: (r) => canManage && r.status !== 'REVOKED' && <Button variant="ghost" size="sm" onClick={() => setRevoking(r)}>Revoke</Button> },
        ]} />
      <Modal open={open} onClose={() => setOpen(false)} title="Enrol a student" description="Existing students get access immediately. New emails get an account and a set-password link."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!email} loading={enroll.isPending} onClick={() => enroll.mutate()}>Enrol</Button></>}>
        <Input label="Student email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} autoFocus />
      </Modal>
      <ConfirmDialog open={Boolean(revoking)} onClose={() => setRevoking(null)} title={`Revoke access for ${revoking?.student?.fullName}?`} confirmLabel="Revoke" loading={revoke.isPending} onConfirm={() => revoke.mutate(revoking.id)} />
    </Card>
  );
}
