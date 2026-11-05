import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Library, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Select, Skeleton, toast } from '../../components/ui/index.js';
import { questionBankApi } from '../../services/api/questionBank.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { QuestionModal, TYPES, blankQuestion } from './QuizEditor.jsx';

/** Creator: the academy's reusable question bank. */
export function QuestionBankPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can('courses.manage');
  const [filters, setFilters] = useState({ q: '', tag: '', type: '', page: 1 });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
  const list = useQuery({ queryKey: ['creator', 'question-bank', params], queryFn: () => questionBankApi.list(params) });
  const tags = useQuery({ queryKey: ['creator', 'question-bank', 'tags'], queryFn: questionBankApi.tags });
  const refresh = () => qc.invalidateQueries({ queryKey: ['creator', 'question-bank'] });
  const save = useMutation({
    mutationFn: (body) => (editing.id ? questionBankApi.update(editing.id, body) : questionBankApi.create(body)),
    onSuccess: () => { toast.success('Question saved'); setEditing(null); setError(null); refresh(); },
    onError: (e) => setError(e.details?.[0]?.message ?? e.message),
  });
  const remove = useMutation({ mutationFn: (id) => questionBankApi.remove(id), onSuccess: () => { toast.success('Question deleted'); setDeleting(null); refresh(); }, onError: (e) => toast.error(e.message) });
  const set = (patch) => setFilters({ ...filters, ...patch, page: patch.page ?? 1 });
  const d = list.data;
  return (
    <>
      <PageHeader title="Question bank" description="Write questions once and reuse them in any quiz." breadcrumbs={[{ label: 'Question bank' }]}
        actions={manage && <Button leftIcon={Plus} onClick={() => { setError(null); setEditing({ ...blankQuestion(), tagsText: '' }); }}>New question</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input aria-label="Search" placeholder="Search questions" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
        <Select aria-label="Tag" value={filters.tag} onChange={(e) => set({ tag: e.target.value })} options={[{ value: '', label: 'All tags' }, ...(tags.data ?? []).map((t) => ({ value: t.tag, label: `${t.tag} (${t.count})` }))]} />
        <Select aria-label="Type" value={filters.type} onChange={(e) => set({ type: e.target.value })} options={[{ value: '', label: 'All types' }, ...TYPES]} />
      </div>
      {list.isError ? <Card><ErrorState error={list.error} onRetry={() => list.refetch()} /></Card> : !d ? <Skeleton className="h-64" /> : d.items.length === 0 ? (
        <Card><EmptyState icon={Library} title={d.total === 0 && !params.q && !params.tag && !params.type ? 'Your question bank is empty' : 'No questions match'} description="Add questions here, or save questions from a quiz with the bookmark icon." /></Card>
      ) : (
        <div className="space-y-2">
          {d.items.map((b) => (
            <Card key={b.id} className="flex items-start gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-line">{b.prompt}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {TYPES.find((t) => t.value === b.type)?.label} · {b.points} pts · used in {b.usedInQuizzes} quiz{b.usedInQuizzes === 1 ? '' : 'zes'}
                  {b.tags.map((t) => <Badge key={t}>{t}</Badge>)}
                </p>
              </div>
              {manage && <>
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${b.prompt}`} onClick={() => { setError(null); setEditing({ ...b, answers: (b.meta?.answers ?? []).join(', '), tagsText: b.tags.join(', '), options: b.options }); }}><Pencil className="size-4" /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${b.prompt}`} onClick={() => setDeleting(b)}><Trash2 className="size-4" /></Button>
              </>}
            </Card>
          ))}
          {d.pages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <Button size="sm" variant="secondary" disabled={d.page <= 1} onClick={() => set({ page: d.page - 1 })}>Previous</Button>
              <span className="text-muted">Page {d.page} of {d.pages} · {d.total} questions</span>
              <Button size="sm" variant="secondary" disabled={d.page >= d.pages} onClick={() => set({ page: d.page + 1 })}>Next</Button>
            </div>
          )}
        </div>
      )}
      <QuestionModal initial={editing} withTags onClose={() => setEditing(null)} onSave={(body) => save.mutate(body)} saving={save.isPending} error={error} />
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting.id)} title="Delete this question?" description="Quizzes that already use it keep their own copy." confirmLabel="Delete" loading={remove.isPending} />
    </>
  );
}
