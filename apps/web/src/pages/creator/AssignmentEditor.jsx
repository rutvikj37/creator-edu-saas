import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import { Badge, Button, Input, Modal, Select, Skeleton, Switch, Tabs, Textarea, toast } from '../../components/ui/index.js';
import { RichTextEditor } from '../../components/forms/RichTextEditor.jsx';
import { creatorLearnApi } from '../../services/api/learn.js';
import { formatDate } from '../../utils/format.js';

export function AssignmentEditor({ courseId, lessonId }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['creator', 'assignment', lessonId], queryFn: () => creatorLearnApi.assignment(courseId, lessonId) });
  const subs = useQuery({ queryKey: ['creator', 'submissions', q.data?.id], queryFn: () => creatorLearnApi.submissions(q.data.id), enabled: Boolean(q.data?.id) });
  const [tab, setTab] = useState('details');
  const [form, setForm] = useState(null);
  const [grading, setGrading] = useState(null);
  const [grade, setGrade] = useState({ points: '', feedback: '', status: 'GRADED' });
  useEffect(() => { if (q.data) setForm({ instructions: q.data.instructions, dueAt: q.data.dueAt ? q.data.dueAt.slice(0, 16) : '', maxPoints: q.data.maxPoints, allowLate: q.data.allowLate, allowFiles: q.data.allowFiles }); }, [q.data]);
  const save = useMutation({ mutationFn: () => creatorLearnApi.assignmentSettings(courseId, lessonId, { ...form, maxPoints: Number(form.maxPoints), dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null }), onSuccess: (d) => { qc.setQueryData(['creator', 'assignment', lessonId], d); qc.invalidateQueries({ queryKey: ['course', courseId, 'check'] }); toast.success('Assignment saved'); }, onError: (e) => toast.error(e.details?.[0]?.message ?? e.message) });
  const doGrade = useMutation({ mutationFn: () => creatorLearnApi.gradeSubmission(grading.id, { points: Number(grade.points), feedback: grade.feedback || undefined, status: grade.status }), onSuccess: () => { toast.success('Saved'); setGrading(null); subs.refetch(); }, onError: (e) => toast.error(e.details?.[0]?.message ?? e.message) });
  if (q.isLoading || !form) return <Skeleton className="h-40" />;
  return (
    <div className="space-y-4">
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'details', label: 'Details' }, { value: 'submissions', label: 'Submissions', count: subs.data?.filter((s) => s.status === 'SUBMITTED').length || undefined }]} />
      {tab === 'details' ? (
        <div className="space-y-4">
          <RichTextEditor label="Instructions" value={form.instructions} onChange={(v) => setForm({ ...form, instructions: v })} minHeight={120} />
          <div className="grid gap-4 sm:grid-cols-2"><Input label="Due (optional)" type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /><Input label="Max points" type="number" min={1} value={form.maxPoints} onChange={(e) => setForm({ ...form, maxPoints: e.target.value })} /></div>
          <Switch label="Accept late submissions" checked={form.allowLate} onChange={(v) => setForm({ ...form, allowLate: v })} />
          <Switch label="Allow file attachments" checked={form.allowFiles} onChange={(v) => setForm({ ...form, allowFiles: v })} />
          <Button loading={save.isPending} onClick={() => save.mutate()}>Save assignment</Button>
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {(subs.data ?? []).map((s) => (
            <li key={s.id} className="space-y-1 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{s.student?.fullName}</span><span className="flex items-center gap-2">{s.isLate && <Badge tone="warning">Late</Badge>}<Badge tone={s.status === 'GRADED' ? 'success' : s.status === 'RETURNED' ? 'danger' : 'info'}>{s.status === 'GRADED' ? `${s.points} pts` : s.status.toLowerCase()}</Badge><Button variant="ghost" size="sm" onClick={() => { setGrading(s); setGrade({ points: s.points ?? '', feedback: s.feedback ?? '', status: 'GRADED' }); }}>Review</Button></span></div>
              <p className="text-xs text-muted">{formatDate(s.submittedAt, { withTime: true })}</p>
            </li>))}
          {!subs.data?.length && <li className="px-3 py-4 text-sm text-muted">No submissions yet.</li>}
        </ul>
      )}
      <Modal open={Boolean(grading)} onClose={() => setGrading(null)} title={`Submission by ${grading?.student?.fullName ?? ''}`} size="lg"
        footer={<><Button variant="secondary" onClick={() => setGrading(null)}>Cancel</Button><Button loading={doGrade.isPending} disabled={grade.points === ''} onClick={() => doGrade.mutate()}>Save</Button></>}>
        {grading && <div className="space-y-4 text-sm">
          {grading.text && <p className="whitespace-pre-wrap rounded-md bg-surface-2 p-3">{grading.text}</p>}
          {grading.files.map((f) => <a key={f.id} href={f.url} className="flex items-center gap-2 text-primary-600 underline"><Paperclip className="size-4" />{f.fileName}</a>)}
          <div className="grid gap-4 sm:grid-cols-2"><Input label={`Points (max ${q.data.maxPoints})`} type="number" min={0} max={q.data.maxPoints} value={grade.points} onChange={(e) => setGrade({ ...grade, points: e.target.value })} /><Select label="Outcome" value={grade.status} onChange={(e) => setGrade({ ...grade, status: e.target.value })} options={[{ value: 'GRADED', label: 'Graded' }, { value: 'RETURNED', label: 'Return for changes' }]} /></div>
          <Textarea label="Feedback" rows={3} value={grade.feedback} onChange={(e) => setGrade({ ...grade, feedback: e.target.value })} />
        </div>}
      </Modal>
    </div>
  );
}
