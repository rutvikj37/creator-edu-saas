import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, CardBody, CardHeader, ErrorState, Input, Select, Skeleton, Switch, Textarea, toast } from '../../components/ui/index.js';
import { aiApi } from '../../services/api/ai.js';
import { coursesApi } from '../../services/api/creator.js';
import { formatDate, formatNumber } from '../../utils/format.js';

const FEATURE_LABELS = { COURSE_OUTLINE: 'Course outlines', LESSON_DRAFT: 'Lesson drafts', QUIZ_QUESTIONS: 'Quiz questions', TUTOR: 'Study assistant' };

function UsageCard() {
  const q = useQuery({ queryKey: ['ai', 'usage'], queryFn: aiApi.usage });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const u = q.data;
  const pct = u && u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
  return (
    <Card>
      <CardHeader title="AI credits this month" description={u ? `Renews ${formatDate(u.periodEnd)}. 1 credit ≈ 750 words read or 150 words written by the AI.` : undefined} />
      <CardBody className="space-y-4">
        {!u ? <Skeleton className="h-20" /> : (
          <>
            {!u.configured && <Alert tone="warning">AI is not set up on this platform yet, so requests can’t run. The platform team needs to add an Anthropic API key.</Alert>}
            {u.configured && !u.included && <Alert tone="info">Your plan doesn’t include AI credits. Upgrade in Billing to use AI.</Alert>}
            <div>
              <p className="text-2xl font-semibold tabular-nums">{formatNumber(u.used)}<span className="text-base font-normal text-muted"> / {u.limit === null ? 'unlimited' : formatNumber(u.limit)} credits</span></p>
              {u.limit !== null && u.limit > 0 && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Credits used">
                  <div className="h-full rounded-full bg-primary-600" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
            {u.byFeature.length > 0 && (
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {u.byFeature.map((f) => <div key={f.feature} className="flex justify-between rounded-md bg-surface-2 px-3 py-2"><dt>{FEATURE_LABELS[f.feature]}</dt><dd className="tabular-nums">{f.credits} credits · {f.requests} uses</dd></div>)}
              </dl>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function TutorSettingsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ai', 'settings'], queryFn: aiApi.settings });
  const [limit, setLimit] = useState(null);
  const save = useMutation({ mutationFn: aiApi.saveSettings, onSuccess: (d) => { qc.setQueryData(['ai', 'settings'], d); setLimit(null); toast.success('Saved'); }, onError: (e) => toast.error(e.details?.[0]?.message ?? e.message) });
  if (!q.data) return <Skeleton className="h-40" />;
  return (
    <Card>
      <CardHeader title="Study assistant for students" description="Students can ask questions about the lesson they are on. Answers are based on the lesson text and use your academy’s credits." actions={<Switch label="On" checked={q.data.enabled} onChange={(enabled) => save.mutate({ enabled })} />} />
      <CardBody className="flex flex-wrap items-end gap-3">
        <Input label="Questions per student per day" type="number" min={1} max={200} className="w-48" value={limit ?? q.data.dailyLimit} onChange={(e) => setLimit(e.target.value)} />
        {limit !== null && <Button size="sm" loading={save.isPending} disabled={!(Number(limit) >= 1 && Number(limit) <= 200)} onClick={() => save.mutate({ dailyLimit: Number(limit) })}>Save</Button>}
      </CardBody>
    </Card>
  );
}

function OutlineCard() {
  const qc = useQueryClient();
  const courses = useQuery({ queryKey: ['creator', 'courses', 'all'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const [form, setForm] = useState({ topic: '', audience: '', level: 'Beginner', sections: 5, courseId: '' });
  const [outline, setOutline] = useState(null);
  const gen = useMutation({
    mutationFn: () => aiApi.outline({ topic: form.topic.trim(), audience: form.audience.trim() || undefined, level: form.level, sections: Number(form.sections), courseId: form.courseId || undefined }),
    onSuccess: (r) => { setOutline(r.sections); toast(`${r.credits} AI credits used`); qc.invalidateQueries({ queryKey: ['ai', 'usage'] }); },
    onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });
  const apply = useMutation({
    mutationFn: () => aiApi.applyOutline(form.courseId, outline),
    onSuccess: (r) => { toast.success(`Added ${r.sections} sections and ${r.lessons} draft lessons`, { description: 'Open the course to write and publish them.' }); setOutline(null); },
    onError: (e) => toast.error(e.message),
  });
  const editSection = (i, patch) => setOutline(outline.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <Card>
      <CardHeader title="Course outline" description="Describe a course and get sections and lessons you can edit, then add them to a course as drafts." />
      <CardBody className="space-y-4">
        <Textarea label="What is the course about?" rows={3} required value={form.topic} maxLength={1000} placeholder="e.g. Mutual funds for first-time investors in India: how they work, choosing funds, SIPs and taxes" onChange={(e) => setForm({ ...form, topic: e.target.value })} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Audience (optional)" value={form.audience} maxLength={300} onChange={(e) => setForm({ ...form, audience: e.target.value })} />
          <Select label="Level" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} options={['Beginner', 'Intermediate', 'Advanced'].map((v) => ({ value: v, label: v }))} />
          <Input label="Sections" type="number" min={1} max={12} value={form.sections} onChange={(e) => setForm({ ...form, sections: e.target.value })} />
        </div>
        <Select label="Add to course" placeholder="Choose a course (needed to add the outline)" value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })} options={(courses.data?.items ?? []).map((c) => ({ value: c.id, label: c.title }))} />
        <div className="flex justify-end"><Button leftIcon={Sparkles} disabled={form.topic.trim().length < 3 || !(form.sections >= 1 && form.sections <= 12)} loading={gen.isPending} onClick={() => gen.mutate()}>{outline ? 'Generate again' : 'Generate outline'}</Button></div>
        {outline && (
          <div className="space-y-3 border-t border-line pt-4">
            {outline.length === 0 && <Alert tone="warning">No usable outline came back. Try describing the course in more detail.</Alert>}
            {outline.map((s, i) => (
              <div key={i} className="rounded-md border border-line p-3">
                <div className="flex items-center gap-2">
                  <Badge>Section {i + 1}</Badge>
                  <Input aria-label={`Section ${i + 1} title`} className="flex-1" value={s.title} maxLength={200} onChange={(e) => editSection(i, { title: e.target.value })} />
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove section ${i + 1}`} onClick={() => setOutline(outline.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                </div>
                <ul className="mt-2 space-y-1 pl-4 text-sm">
                  {s.lessons.map((l, k) => <li key={k}><span className="font-medium">{l.title}</span>{l.summary && <span className="text-muted"> — {l.summary}</span>}</li>)}
                </ul>
              </div>
            ))}
            {outline.length > 0 && (
              <div className="flex items-center justify-end gap-3">
                {!form.courseId && <span className="text-sm text-muted">Choose a course above to add this outline.</span>}
                <Button disabled={!form.courseId || outline.some((s) => !s.title.trim())} loading={apply.isPending} onClick={() => apply.mutate()}>Add to course as drafts</Button>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function AiStudioPage() {
  return (
    <>
      <PageHeader title="AI studio" description="Plan courses, draft lessons and write quiz questions with Claude. Lesson drafts and quiz questions are also available inside the course editor." breadcrumbs={[{ label: 'Growth' }, { label: 'AI studio' }]} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <OutlineCard />
        <div className="space-y-6"><UsageCard /><TutorSettingsCard /></div>
      </div>
      <p className="mt-4 text-xs text-muted">AI can make mistakes. Review generated content before publishing it to students.</p>
    </>
  );
}
