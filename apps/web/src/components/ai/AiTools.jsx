import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Sparkles } from 'lucide-react';
import { Alert } from '../auth/Alert.jsx';
import { Button, Checkbox, Input, Modal, Select, Textarea, toast } from '../ui/index.js';
import { aiApi } from '../../services/api/ai.js';
import { coursesApi } from '../../services/api/creator.js';
import { creatorLearnApi } from '../../services/api/learn.js';

const credits = (n) => `${n} AI credit${n === 1 ? '' : 's'} used`;

/** "Draft with AI" for a text lesson. The draft replaces the editor content; nothing is saved until the creator saves. */
export function AiDraftButton({ courseId, lessonId, hasContent, onDraft }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const gen = useMutation({
    mutationFn: () => aiApi.lessonDraft({ courseId, lessonId, notes: notes.trim() || undefined }),
    onSuccess: (r) => { onDraft(r.content); setOpen(false); setNotes(''); toast.success('Draft added — review it, then save the lesson', { description: credits(r.credits) }); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <Button size="sm" variant="secondary" leftIcon={Sparkles} onClick={() => setOpen(true)}>Draft with AI</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Draft this lesson with AI">
        <div className="space-y-4">
          <p className="text-sm text-muted">Claude writes a first draft from the course, section and lesson titles{hasContent ? ' and your current notes' : ''}. Always review it before publishing.</p>
          {hasContent && <Alert tone="warning">The draft replaces what is in the editor now (you can cancel without saving).</Alert>}
          <Textarea label="Instructions (optional)" rows={3} placeholder="e.g. Use Indian examples, keep it under 600 words" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button leftIcon={Sparkles} loading={gen.isPending} onClick={() => gen.mutate()}>Write draft</Button></div>
        </div>
      </Modal>
    </>
  );
}

/** Generates multiple-choice questions from one of the course's text lessons, then adds the chosen ones. */
export function AiQuizGenerator({ courseId, lessonId }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('');
  const [count, setCount] = useState(5);
  const [questions, setQuestions] = useState(null);
  const [picked, setPicked] = useState([]);
  const curriculum = useQuery({ queryKey: ['course', courseId, 'curriculum'], queryFn: () => coursesApi.curriculum(courseId), enabled: open });
  const textLessons = (curriculum.data ?? []).flatMap((s) => (s.lessons ?? []).flatMap((l) => [l, ...(l.children ?? [])])).filter((l) => l.type === 'TEXT');
  const gen = useMutation({
    mutationFn: () => aiApi.quizQuestions({ courseId, sourceLessonId: source, count: Number(count) }),
    onSuccess: (r) => { setQuestions(r.questions); setPicked(r.questions.map((_, i) => i)); toast(credits(r.credits)); },
    onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });
  const add = useMutation({
    mutationFn: async () => {
      let quiz;
      for (const i of picked) quiz = await creatorLearnApi.addQuestion(courseId, lessonId, questions[i]);
      return quiz;
    },
    onSuccess: (quiz) => { if (quiz) qc.setQueryData(['creator', 'quiz', lessonId], quiz); toast.success(`${picked.length} question${picked.length === 1 ? '' : 's'} added`); close(); },
    onError: (e) => toast.error(e.message),
  });
  const close = () => { setOpen(false); setQuestions(null); setPicked([]); };
  return (
    <>
      <Button variant="secondary" size="sm" leftIcon={Sparkles} onClick={() => setOpen(true)}>Generate with AI</Button>
      <Modal open={open} onClose={close} size="lg" title="Generate quiz questions">
        {!questions ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">Claude writes multiple-choice questions using only what a lesson says.</p>
            {curriculum.isSuccess && textLessons.length === 0 ? <Alert tone="info">Add a text lesson to this course first; questions are written from its content.</Alert> : (
              <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
                <Select label="From lesson" placeholder="Choose a lesson" value={source} onChange={(e) => setSource(e.target.value)} options={textLessons.map((l) => ({ value: l.id, label: l.title }))} />
                <Input label="Questions" type="number" min={1} max={10} value={count} onChange={(e) => setCount(e.target.value)} />
              </div>
            )}
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={close}>Cancel</Button><Button leftIcon={Sparkles} disabled={!source || count < 1 || count > 10} loading={gen.isPending} onClick={() => gen.mutate()}>Generate</Button></div>
          </div>
        ) : (
          <div className="space-y-4">
            {questions.length === 0 ? <Alert tone="warning">No usable questions came back. Try again or pick a longer lesson.</Alert> : questions.map((q, i) => (
              <div key={i} className="rounded-md border border-line p-3 text-sm">
                <Checkbox label={q.prompt} checked={picked.includes(i)} onChange={() => setPicked(picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i])} />
                <ul className="mt-2 ml-7 space-y-0.5">{q.options.map((o) => <li key={o.label} className={o.isCorrect ? 'font-medium text-green-700 dark:text-green-400' : 'text-fg-2'}>{o.isCorrect ? '✓ ' : '• '}{o.label}</li>)}</ul>
                {q.explanation && <p className="mt-1 ml-7 text-xs text-muted">{q.explanation}</p>}
              </div>
            ))}
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setQuestions(null)}>Back</Button><Button disabled={!picked.length} loading={add.isPending} onClick={() => add.mutate()}>Add {picked.length} question{picked.length === 1 ? '' : 's'}</Button></div>
          </div>
        )}
      </Modal>
    </>
  );
}

/** Student study assistant beside a lesson. The conversation lives only in this panel. */
export function TutorPanel({ lessonId }) {
  const status = useQuery({ queryKey: ['learn', 'ai-tutor'], queryFn: aiApi.tutorStatus, staleTime: 60_000 });
  const qc = useQueryClient();
  const [turns, setTurns] = useState([]);
  const [question, setQuestion] = useState('');
  const end = useRef(null);
  const ask = useMutation({
    mutationFn: (q) => aiApi.ask({ lessonId, question: q, history: turns.slice(-6) }),
    onSuccess: (r, q) => {
      setTurns((t) => [...t, { role: 'user', content: q }, { role: 'assistant', content: r.answer }]);
      setQuestion('');
      qc.setQueryData(['learn', 'ai-tutor'], (s) => (s ? { ...s, remainingToday: r.remainingToday } : s));
      setTimeout(() => end.current?.scrollIntoView?.({ behavior: 'smooth' }), 0);
    },
    onError: (e) => toast.error(e.message),
  });
  if (!status.data?.enabled) return <p className="text-sm text-muted">The study assistant isn’t available in this academy.</p>;
  const submit = (e) => { e.preventDefault(); if (question.trim().length >= 2) ask.mutate(question.trim()); };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted">Ask about this lesson. Answers come from AI and can be wrong — check with your instructor when unsure.</p>
      <div className="space-y-2" aria-live="polite">
        {turns.map((t, i) => <div key={i} className={t.role === 'user' ? 'ml-6 rounded-lg bg-primary-50 p-2 text-fg dark:bg-primary-950' : 'mr-2 rounded-lg bg-surface-2 p-2 whitespace-pre-line'}>{t.content}</div>)}
        {ask.isPending && <div className="mr-2 animate-pulse rounded-lg bg-surface-2 p-2 text-muted">Thinking…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="space-y-2">
        <Textarea aria-label="Ask the study assistant" rows={2} value={question} maxLength={2000} placeholder="What does this mean…?" onChange={(e) => setQuestion(e.target.value)} disabled={status.data.remainingToday === 0} />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{status.data.remainingToday} question{status.data.remainingToday === 1 ? '' : 's'} left today</span>
          <Button type="submit" size="sm" leftIcon={Send} loading={ask.isPending} disabled={question.trim().length < 2 || status.data.remainingToday === 0}>Ask</Button>
        </div>
      </form>
    </div>
  );
}
