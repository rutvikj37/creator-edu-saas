import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Checkbox, Input, Modal, Select, Skeleton, Switch, Tabs, Textarea, toast } from '../../components/ui/index.js';
import { creatorLearnApi } from '../../services/api/learn.js';
import { AiQuizGenerator } from '../../components/ai/AiTools.jsx';
import { formatDate } from '../../utils/format.js';

const TYPES = [
  { value: 'MCQ_SINGLE', label: 'Multiple choice (one answer)' }, { value: 'MCQ_MULTI', label: 'Multiple select' }, { value: 'TRUE_FALSE', label: 'True / false' },
  { value: 'FILL_BLANK', label: 'Fill in the blank' }, { value: 'MATCHING', label: 'Matching' }, { value: 'SHORT', label: 'Short answer (graded by you)' }, { value: 'LONG', label: 'Long answer (graded by you)' },
];
const blankQuestion = () => ({ type: 'MCQ_SINGLE', prompt: '', points: 1, explanation: '', options: [{ label: '', isCorrect: true }, { label: '', isCorrect: false }], answers: '' });

function QuestionModal({ initial, onClose, onSave, saving, error }) {
  const [q, setQ] = useState(initial);
  useEffect(() => setQ(initial), [initial]);
  if (!q) return null;
  const setType = (type) => setQ({ ...q, type, options: type === 'TRUE_FALSE' ? [{ label: 'True', isCorrect: true }, { label: 'False', isCorrect: false }] : type === 'MATCHING' ? [{ label: '', matchKey: '' }, { label: '', matchKey: '' }] : ['MCQ_SINGLE', 'MCQ_MULTI'].includes(type) ? (q.options?.length ? q.options : blankQuestion().options) : [] });
  const setOpt = (i, patch) => setQ({ ...q, options: q.options.map((o, j) => (j === i ? { ...o, ...patch } : q.type === 'MCQ_SINGLE' || q.type === 'TRUE_FALSE' ? (patch.isCorrect ? { ...o, isCorrect: false } : o) : o)) });
  const body = () => ({
    type: q.type, prompt: q.prompt, points: Number(q.points) || 1, explanation: q.explanation || null,
    options: q.type === 'MATCHING' ? q.options.filter((o) => o.label && o.matchKey).map((o) => ({ label: o.label, matchKey: o.matchKey })) : q.options?.filter((o) => o.label).map((o) => ({ label: o.label, isCorrect: Boolean(o.isCorrect) })),
    meta: q.type === 'FILL_BLANK' ? { answers: q.answers.split(',').map((a) => a.trim()).filter(Boolean) } : undefined,
  });
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit question' : 'Add question'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} disabled={!q.prompt.trim()} onClick={() => onSave(body())}>Save question</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]"><Select label="Type" value={q.type} onChange={(e) => setType(e.target.value)} options={TYPES} /><Input label="Points" type="number" min={0.25} step="0.25" value={q.points} onChange={(e) => setQ({ ...q, points: e.target.value })} /></div>
        <Textarea label="Question" rows={3} value={q.prompt} onChange={(e) => setQ({ ...q, prompt: e.target.value })} />
        {['MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE'].includes(q.type) && (
          <div className="space-y-2"><p className="text-sm font-medium text-fg-2">Options <span className="text-xs font-normal text-muted">(tick the correct {q.type === 'MCQ_MULTI' ? 'answers' : 'answer'})</span></p>
            {q.options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type={q.type === 'MCQ_MULTI' ? 'checkbox' : 'radio'} name="correct" aria-label={`Option ${i + 1} correct`} checked={Boolean(o.isCorrect)} onChange={(e) => setOpt(i, { isCorrect: e.target.checked })} className="size-4 accent-primary-600" />
                <Input aria-label={`Option ${i + 1}`} value={o.label} disabled={q.type === 'TRUE_FALSE'} onChange={(e) => setOpt(i, { label: e.target.value })} />
                {q.type !== 'TRUE_FALSE' && q.options.length > 2 && <Button variant="ghost" size="icon-sm" aria-label="Remove option" onClick={() => setQ({ ...q, options: q.options.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>}
              </div>))}
            {q.type !== 'TRUE_FALSE' && <Button variant="ghost" size="sm" leftIcon={Plus} onClick={() => setQ({ ...q, options: [...q.options, { label: '', isCorrect: false }] })}>Add option</Button>}
          </div>
        )}
        {q.type === 'FILL_BLANK' && <Input label="Accepted answers" hint="Comma-separated; matching ignores case and extra spaces" value={q.answers} onChange={(e) => setQ({ ...q, answers: e.target.value })} />}
        {q.type === 'MATCHING' && (
          <div className="space-y-2"><p className="text-sm font-medium text-fg-2">Pairs</p>
            {q.options.map((o, i) => <div key={i} className="grid grid-cols-2 gap-2"><Input aria-label={`Item ${i + 1}`} placeholder="Item" value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} /><Input aria-label={`Match ${i + 1}`} placeholder="Matches" value={o.matchKey ?? ''} onChange={(e) => setOpt(i, { matchKey: e.target.value })} /></div>)}
            <Button variant="ghost" size="sm" leftIcon={Plus} onClick={() => setQ({ ...q, options: [...q.options, { label: '', matchKey: '' }] })}>Add pair</Button>
          </div>
        )}
        <Textarea label="Explanation (shown after submitting)" rows={2} value={q.explanation ?? ''} onChange={(e) => setQ({ ...q, explanation: e.target.value })} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

function GradeModal({ attemptId, onClose, onGraded }) {
  const q = useQuery({ queryKey: ['creator', 'attempt', attemptId], queryFn: () => creatorLearnApi.attemptDetail(attemptId), enabled: Boolean(attemptId) });
  const [grades, setGrades] = useState({});
  const save = useMutation({ mutationFn: () => creatorLearnApi.gradeAttempt(attemptId, Object.entries(grades).map(([questionId, g]) => ({ questionId, points: Number(g.points), feedback: g.feedback || undefined }))), onSuccess: () => { toast.success('Grades saved'); onGraded(); onClose(); }, onError: (e) => toast.error(e.details?.[0]?.message ?? e.message) });
  const a = q.data;
  return (
    <Modal open={Boolean(attemptId)} onClose={onClose} title={a ? `${a.student?.fullName} · attempt ${a.attemptNo}` : 'Attempt'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button disabled={!Object.keys(grades).length} loading={save.isPending} onClick={() => save.mutate()}>Save grades</Button></>}>
      {!a ? <Skeleton className="h-40" /> : (
        <div className="space-y-4">
          <p className="text-sm text-muted">Score {a.score}/{a.maxScore}{a.percent !== null ? ` (${a.percent}%)` : ''} · {a.status.toLowerCase()}</p>
          {a.questions.map((x, i) => (
            <div key={x.id} className="rounded-md border border-line p-3 text-sm">
              <p className="font-medium">{i + 1}. {x.prompt} <span className="text-xs text-muted">({x.points} pts)</span></p>
              <p className="mt-1 whitespace-pre-wrap text-fg-2">{x.response?.text ?? (x.response?.optionId ? x.options.find((o) => o.id === x.response.optionId)?.label : x.response?.optionIds ? x.options.filter((o) => x.response.optionIds.includes(o.id)).map((o) => o.label).join(', ') : x.response?.pairs ? JSON.stringify(x.response.pairs) : '—')}</p>
              {['SHORT', 'LONG', 'FILE_UPLOAD'].includes(x.type) ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-[100px_1fr]">
                  <Input aria-label="Points" type="number" min={0} max={x.points} step="0.25" defaultValue={x.pointsAwarded ?? ''} onChange={(e) => setGrades((g) => ({ ...g, [x.id]: { ...g[x.id], points: e.target.value } }))} />
                  <Input aria-label="Feedback" placeholder="Feedback (optional)" defaultValue={x.feedback ?? ''} onChange={(e) => setGrades((g) => ({ ...g, [x.id]: { points: g[x.id]?.points ?? x.pointsAwarded ?? 0, feedback: e.target.value } }))} />
                </div>
              ) : <Badge tone={x.isCorrect ? 'success' : 'danger'} className="mt-2">{x.isCorrect ? 'Correct' : 'Incorrect'} · {x.pointsAwarded}</Badge>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Quiz settings, questions and grading for a QUIZ lesson. */
export function QuizEditor({ courseId, lessonId }) {
  const qc = useQueryClient();
  const key = ['creator', 'quiz', lessonId];
  const q = useQuery({ queryKey: key, queryFn: () => creatorLearnApi.quiz(courseId, lessonId) });
  const attempts = useQuery({ queryKey: ['creator', 'attempts', q.data?.id], queryFn: () => creatorLearnApi.attempts(q.data.id), enabled: Boolean(q.data?.id) });
  const [tab, setTab] = useState('questions');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const [settings, setSettings] = useState(null);
  const [grading, setGrading] = useState(null);
  useEffect(() => { if (q.data) setSettings({ passPercent: q.data.passPercent, timeLimitMinutes: q.data.timeLimitSeconds ? q.data.timeLimitSeconds / 60 : '', maxAttempts: q.data.maxAttempts ?? '', negativeMarkRatio: q.data.negativeMarkRatio, shuffleQuestions: q.data.shuffleQuestions, shuffleOptions: q.data.shuffleOptions, randomPickCount: q.data.randomPickCount ?? '', showResults: q.data.showResults, instructions: q.data.instructions ?? '' }); }, [q.data]);
  const onSaved = (d) => { qc.setQueryData(key, d); setEditing(null); setError(null); qc.invalidateQueries({ queryKey: ['course', courseId, 'check'] }); };
  const saveQ = useMutation({ mutationFn: (body) => (editing.id ? creatorLearnApi.updateQuestion(courseId, lessonId, editing.id, body) : creatorLearnApi.addQuestion(courseId, lessonId, body)), onSuccess: (d) => { onSaved(d); toast.success('Question saved'); }, onError: (e) => setError(e.details?.[0]?.message ?? e.message) });
  const removeQ = useMutation({ mutationFn: (id) => creatorLearnApi.removeQuestion(courseId, lessonId, id), onSuccess: onSaved });
  const saveSettings = useMutation({
    mutationFn: () => creatorLearnApi.quizSettings(courseId, lessonId, { passPercent: Number(settings.passPercent), timeLimitSeconds: settings.timeLimitMinutes ? Math.round(Number(settings.timeLimitMinutes) * 60) : null, maxAttempts: settings.maxAttempts ? Number(settings.maxAttempts) : null, negativeMarkRatio: Number(settings.negativeMarkRatio), shuffleQuestions: settings.shuffleQuestions, shuffleOptions: settings.shuffleOptions, randomPickCount: settings.randomPickCount ? Number(settings.randomPickCount) : null, showResults: settings.showResults, instructions: settings.instructions || null }),
    onSuccess: (d) => { qc.setQueryData(key, d); toast.success('Quiz settings saved'); }, onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });
  if (q.isLoading || !settings) return <Skeleton className="h-40" />;
  const pending = (attempts.data ?? []).filter((a) => a.status === 'SUBMITTED').length;
  return (
    <div className="space-y-4">
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'questions', label: 'Questions', count: q.data.questions.length }, { value: 'settings', label: 'Settings' }, { value: 'attempts', label: 'Attempts', count: pending || undefined }]} />
      {tab === 'questions' && (
        <div className="space-y-2">
          {q.data.questions.map((x, i) => (
            <div key={x.id} className="flex items-start gap-2 rounded-md border border-line p-3 text-sm">
              <span className="text-muted">{i + 1}.</span>
              <div className="flex-1"><p>{x.prompt}</p><p className="text-xs text-muted">{TYPES.find((t) => t.value === x.type)?.label} · {x.points} pts</p></div>
              <Button variant="ghost" size="icon-sm" aria-label="Edit question" onClick={() => setEditing({ ...x, answers: (x.meta?.answers ?? []).join(', '), options: x.options })}><Pencil className="size-4" /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Delete question" onClick={() => removeQ.mutate(x.id)}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" leftIcon={Plus} onClick={() => { setError(null); setEditing(blankQuestion()); }}>Add question</Button>
            <AiQuizGenerator courseId={courseId} lessonId={lessonId} />
          </div>
        </div>
      )}
      {tab === 'settings' && (
        <div className="space-y-4">
          <Textarea label="Instructions" rows={2} value={settings.instructions} onChange={(e) => setSettings({ ...settings, instructions: e.target.value })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Pass mark (%)" type="number" min={0} max={100} value={settings.passPercent} onChange={(e) => setSettings({ ...settings, passPercent: e.target.value })} />
            <Input label="Time limit (minutes)" type="number" min={1} placeholder="No limit" value={settings.timeLimitMinutes} onChange={(e) => setSettings({ ...settings, timeLimitMinutes: e.target.value })} />
            <Input label="Max attempts" type="number" min={1} placeholder="Unlimited" value={settings.maxAttempts} onChange={(e) => setSettings({ ...settings, maxAttempts: e.target.value })} />
            <Input label="Negative marking (0–1 × points)" type="number" min={0} max={1} step="0.25" value={settings.negativeMarkRatio} onChange={(e) => setSettings({ ...settings, negativeMarkRatio: e.target.value })} />
            <Input label="Random questions per attempt" type="number" min={1} placeholder="All" value={settings.randomPickCount} onChange={(e) => setSettings({ ...settings, randomPickCount: e.target.value })} />
          </div>
          <Checkbox label="Shuffle question order" checked={settings.shuffleQuestions} onChange={(e) => setSettings({ ...settings, shuffleQuestions: e.target.checked })} />
          <Checkbox label="Shuffle answer options" checked={settings.shuffleOptions} onChange={(e) => setSettings({ ...settings, shuffleOptions: e.target.checked })} />
          <Switch label="Show correct answers after submitting" checked={settings.showResults} onChange={(v) => setSettings({ ...settings, showResults: v })} />
          <Button loading={saveSettings.isPending} onClick={() => saveSettings.mutate()}>Save settings</Button>
        </div>
      )}
      {tab === 'attempts' && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {(attempts.data ?? []).map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>{a.student?.fullName} <span className="text-xs text-muted">#{a.attemptNo} · {formatDate(a.submittedAt, { withTime: true })}</span></span>
              <span className="flex items-center gap-2">{a.status === 'SUBMITTED' ? <Badge tone="warning">Needs grading</Badge> : <Badge tone={a.passed ? 'success' : 'danger'}>{a.percent}%</Badge>}<Button variant="ghost" size="sm" onClick={() => setGrading(a.id)}>{a.status === 'SUBMITTED' ? 'Grade' : 'View'}</Button></span>
            </li>))}
          {!attempts.data?.length && <li className="px-3 py-4 text-sm text-muted">No submitted attempts yet.</li>}
        </ul>
      )}
      <QuestionModal initial={editing} onClose={() => setEditing(null)} onSave={(b) => saveQ.mutate(b)} saving={saveQ.isPending} error={error} />
      <GradeModal attemptId={grading} onClose={() => setGrading(null)} onGraded={() => attempts.refetch()} />
    </div>
  );
}
