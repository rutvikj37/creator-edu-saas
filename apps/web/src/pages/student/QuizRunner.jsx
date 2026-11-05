import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, CardBody, Input, Skeleton, Textarea, toast } from '../../components/ui/index.js';
import { learnApi } from '../../services/api/learn.js';
import { cn } from '../../utils/cn.js';

function Timer({ expiresAt, onExpire }) {
  const [left, setLeft] = useState(() => new Date(expiresAt).getTime() - Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setLeft(ms);
      if (ms <= 0) { clearInterval(t); onExpire(); }
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt, onExpire]);
  const s = Math.max(0, Math.floor(left / 1000));
  return <span className={cn('inline-flex items-center gap-1.5 font-mono text-sm', s < 60 && 'text-red-600')} role="timer"><Clock className="size-4" />{String(Math.floor(s / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}</span>;
}

function QuestionInput({ q, value, onChange, disabled }) {
  const r = value ?? {};
  if (q.type === 'MCQ_SINGLE' || q.type === 'TRUE_FALSE') {
    return <div className="space-y-2" role="radiogroup">{q.options.map((o) => (
      <label key={o.id} className={cn('flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm', r.optionId === o.id ? 'border-primary-600 bg-primary-50' : 'border-line hover:bg-surface-2')}>
        <input type="radio" name={q.id} checked={r.optionId === o.id} disabled={disabled} onChange={() => onChange({ optionId: o.id })} className="accent-primary-600" />{o.label}
      </label>))}</div>;
  }
  if (q.type === 'MCQ_MULTI') {
    const set = new Set(r.optionIds ?? []);
    return <div className="space-y-2">{q.options.map((o) => (
      <label key={o.id} className={cn('flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm', set.has(o.id) ? 'border-primary-600 bg-primary-50' : 'border-line hover:bg-surface-2')}>
        <input type="checkbox" checked={set.has(o.id)} disabled={disabled} onChange={(e) => { const n = new Set(set); e.target.checked ? n.add(o.id) : n.delete(o.id); onChange({ optionIds: [...n] }); }} className="accent-primary-600" />{o.label}
      </label>))}<p className="text-xs text-muted">Select all that apply.</p></div>;
  }
  if (q.type === 'MATCHING') {
    return <div className="space-y-2">{q.options.map((o) => (
      <div key={o.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="flex-1 text-sm font-medium">{o.label}</span>
        <select aria-label={`Match for ${o.label}`} disabled={disabled} value={r.pairs?.[o.id] ?? ''} onChange={(e) => onChange({ pairs: { ...(r.pairs ?? {}), [o.id]: e.target.value } })} className="h-9 rounded-md border border-line bg-surface px-2 text-sm sm:w-64">
          <option value="">Choose…</option>{q.matchTargets.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>))}</div>;
  }
  if (q.type === 'LONG') return <Textarea aria-label="Your answer" rows={6} disabled={disabled} value={r.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />;
  if (q.type === 'FILE_UPLOAD') return <Alert tone="info">Describe your answer below; file answers can be attached in assignments.</Alert>;
  return <Input aria-label="Your answer" disabled={disabled} value={r.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />;
}

/** Quiz flow: overview → attempt (autosaved answers, optional timer) → results. */
export function QuizRunner({ lessonId, onPassed }) {
  const qc = useQueryClient();
  const ov = useQuery({ queryKey: ['quiz', lessonId], queryFn: () => learnApi.quiz(lessonId) });
  const [attemptId, setAttemptId] = useState(null);
  const at = useQuery({ queryKey: ['attempt', attemptId], queryFn: () => learnApi.attempt(attemptId), enabled: Boolean(attemptId) });
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (at.data) setAnswers(Object.fromEntries(at.data.questions.map((q) => [q.id, q.response]))); }, [at.data]);
  const inProgress = at.data?.status === 'IN_PROGRESS';
  const answered = useMemo(() => Object.values(answers).filter((v) => v && (v.optionId || v.optionIds?.length || v.text?.trim() || (v.pairs && Object.keys(v.pairs).length))).length, [answers]);

  const start = async () => {
    setBusy(true);
    try { const a = await learnApi.startQuiz(lessonId); qc.setQueryData(['attempt', a.id], a); setAttemptId(a.id); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const save = async (q, value) => {
    setAnswers((s) => ({ ...s, [q.id]: value }));
    try { await learnApi.answer(attemptId, { questionId: q.id, response: value }); } catch (e) { toast.error(e.message); }
  };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await learnApi.submitQuiz(attemptId);
      qc.setQueryData(['attempt', attemptId], r);
      qc.invalidateQueries({ queryKey: ['quiz', lessonId] });
      if (r.passed) { toast.success('Quiz passed!'); onPassed?.(); } else if (r.status === 'SUBMITTED') toast.info?.('Submitted — some answers will be graded by your instructor.');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (ov.isLoading) return <Skeleton className="h-40" />;
  if (ov.isError) return <Alert tone="error">{ov.error.message}</Alert>;
  const o = ov.data;

  if (!attemptId || !at.data) {
    const limitReached = o.maxAttempts && o.attemptsUsed >= o.maxAttempts && !o.openAttemptId;
    return (
      <Card><CardBody className="space-y-4">
        {o.instructions && <p className="whitespace-pre-line text-sm text-fg-2">{o.instructions}</p>}
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          <li>Questions: <strong>{o.questionCount}</strong></li>
          <li>Pass mark: <strong>{o.passPercent}%</strong></li>
          <li>Time limit: <strong>{o.timeLimitSeconds ? `${Math.round(o.timeLimitSeconds / 60)} min` : 'None'}</strong></li>
          <li>Attempts: <strong>{o.attemptsUsed}{o.maxAttempts ? ` / ${o.maxAttempts}` : ''}</strong></li>
          {o.negativeMarking && <li className="text-red-600 sm:col-span-2">Wrong answers lose marks.</li>}
        </ul>
        {o.passed && <Alert tone="success" title="Passed">Best score {o.bestPercent}%.</Alert>}
        {o.attempts.length > 0 && <ul className="space-y-1 text-sm">{o.attempts.map((a) => <li key={a.id} className="flex items-center gap-2"><button type="button" className="text-primary-600 underline" onClick={() => setAttemptId(a.id)}>Attempt {a.attemptNo}</button><Badge tone={a.passed ? 'success' : a.status === 'SUBMITTED' ? 'warning' : 'neutral'}>{a.status === 'SUBMITTED' ? 'Awaiting grading' : a.status === 'IN_PROGRESS' ? 'In progress' : `${a.percent}%`}</Badge></li>)}</ul>}
        <Button loading={busy} disabled={limitReached} onClick={o.openAttemptId ? () => setAttemptId(o.openAttemptId) : start}>{o.openAttemptId ? 'Resume attempt' : o.attemptsUsed ? 'Try again' : 'Start quiz'}</Button>
        {limitReached && <p className="text-sm text-muted">You have used all attempts.</p>}
      </CardBody></Card>
    );
  }

  const a = at.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Attempt {a.attemptNo}{inProgress ? ` · ${answered}/${a.questions.length} answered` : ''}</p>
        {inProgress && a.expiresAt && <Timer expiresAt={a.expiresAt} onExpire={submit} />}
        {!inProgress && <Button variant="ghost" size="sm" onClick={() => setAttemptId(null)}>Back to overview</Button>}
      </div>
      {!inProgress && (
        a.status === 'SUBMITTED' ? <Alert tone="info" title="Submitted">Your score so far is {a.score}/{a.maxScore}. Open answers are being graded.</Alert>
          : <Alert tone={a.passed ? 'success' : 'error'} title={a.passed ? 'You passed!' : 'Not passed yet'}>Score {a.score}/{a.maxScore} ({a.percent}%) · pass mark {a.passPercent}%.</Alert>
      )}
      {a.questions.map((q, i) => (
        <Card key={q.id}><CardBody className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium"><span className="text-muted">{i + 1}.</span> {q.prompt}</p>
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted">{!inProgress && q.isCorrect === true && <CheckCircle2 className="size-4 text-green-600" />}{!inProgress && q.isCorrect === false && <XCircle className="size-4 text-red-600" />}{q.pointsAwarded ?? '–'}/{q.points}</span>
          </div>
          <QuestionInput q={q} value={answers[q.id]} disabled={!inProgress} onChange={(v) => save(q, v)} />
          {!inProgress && q.options?.some((o) => o.isCorrect) && <p className="text-xs text-green-700">Correct: {q.options.filter((o) => o.isCorrect).map((o) => o.label).join(', ')}</p>}
          {!inProgress && q.acceptedAnswers?.length > 0 && <p className="text-xs text-green-700">Accepted: {q.acceptedAnswers.join(', ')}</p>}
          {!inProgress && q.feedback && <Alert tone="info" title="Instructor feedback">{q.feedback}</Alert>}
          {!inProgress && q.explanation && <p className="text-xs text-muted">{q.explanation}</p>}
        </CardBody></Card>
      ))}
      {inProgress && <div className="flex justify-end"><Button loading={busy} onClick={submit}>Submit quiz</Button></div>}
    </div>
  );
}
