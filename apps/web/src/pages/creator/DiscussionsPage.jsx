import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessagesSquare } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Avatar, Badge, Button, Card, CardBody, EmptyState, ErrorState, Skeleton, Tabs, Textarea, toast } from '../../components/ui/index.js';
import { ListToolbar } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { creatorLearnApi } from '../../services/api/learn.js';
import { formatDate } from '../../utils/format.js';

export function DiscussionsPage() {
  const qc = useQueryClient();
  const [unanswered, setUnanswered] = useState(true);
  const [search, setSearch] = useState('');
  const [courseF, setCourseF] = useState();
  const q = useQuery({ queryKey: ['creator', 'discussions', unanswered], queryFn: () => creatorLearnApi.discussions({ unanswered }) });
  const [drafts, setDrafts] = useState({});
  const refresh = () => qc.invalidateQueries({ queryKey: ['creator', 'discussions'] });
  const reply = useMutation({ mutationFn: ({ id, body }) => creatorLearnApi.reply(id, body), onSuccess: (_, v) => { setDrafts((d) => ({ ...d, [v.id]: '' })); toast.success('Reply posted'); refresh(); }, onError: (e) => toast.error(e.message) });
  const moderate = useMutation({ mutationFn: ({ id, action }) => creatorLearnApi.moderate(id, action), onSuccess: refresh, onError: (e) => toast.error(e.message) });
  const all = q.data ?? [];
  const courses = [...new Map(all.filter((t) => t.lesson?.course?.title).map((t) => [t.lesson.course.title, t.lesson.course.title])).keys()];
  const term = search.trim().toLowerCase();
  const rows = all.filter((t) => (!term || `${t.body} ${t.author} ${t.lesson?.title ?? ''}`.toLowerCase().includes(term)) && (!courseF || t.lesson?.course?.title === courseF));
  return (
    <>
      <PageHeader title="Discussions" count={q.data ? all.length : undefined} description="Questions students ask on lessons. Reply as the instructor, resolve or hide." breadcrumbs={[{ label: 'Discussions' }]} />
      <Tabs className="mb-5" value={unanswered ? 'open' : 'all'} onChange={(v) => setUnanswered(v === 'open')} tabs={[{ value: 'open', label: 'Unanswered' }, { value: 'all', label: 'All questions' }]} />
      <Card className="mb-4">
        <ListToolbar search={search} onSearch={setSearch} placeholder="Search questions, students or lessons" count={rows.length} noun="question"
          filtered={Boolean(term || courseF)} onReset={() => { setSearch(''); setCourseF(undefined); }}
          filters={<FilterChip label="Course" value={courseF} onChange={setCourseF} options={courses.map((c) => ({ value: c, label: c }))} panelClassName="w-72" />} />
      </Card>
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : q.isLoading ? <Skeleton className="h-40" /> : !rows.length ? (
        <Card><EmptyState icon={MessagesSquare} title={all.length ? 'No questions match' : unanswered ? 'All caught up' : 'No questions yet'} description={all.length ? 'Try a different search or clear the filters.' : 'Student questions from lessons will show up here.'} /></Card>
      ) : (
        <div className="space-y-4">
          {rows.map((t) => (
            <Card key={t.id}><CardBody className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>{t.lesson?.course?.title} › {t.lesson?.title}</span><span>{formatDate(t.createdAt, { withTime: true })}</span></div>
              <div className="flex items-start gap-3"><Avatar name={t.author} size="sm" /><div><p className="text-sm font-medium text-fg">{t.author}{t.isResolved && <Badge tone="success" className="ml-2">Resolved</Badge>}</p><p className="text-sm whitespace-pre-wrap text-fg-2">{t.body}</p></div></div>
              {t.replies.length > 0 && <ul className="space-y-2 border-l-2 border-line pl-3 text-sm">{t.replies.map((r) => <li key={r.id}><span className="font-medium">{r.author}</span> {r.isInstructor && <Badge tone="primary">Instructor</Badge>}<p className="whitespace-pre-wrap">{r.body}</p></li>)}</ul>}
              <Textarea aria-label="Reply" rows={2} placeholder="Write a reply…" value={drafts[t.id] ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!drafts[t.id]?.trim()} loading={reply.isPending && reply.variables?.id === t.id} onClick={() => reply.mutate({ id: t.id, body: drafts[t.id] })}>Reply as instructor</Button>
                <Button size="sm" variant="ghost" onClick={() => moderate.mutate({ id: t.id, action: t.isResolved ? 'reopen' : 'resolve' })}>{t.isResolved ? 'Reopen' : 'Mark resolved'}</Button>
                <Button size="sm" variant="ghost" onClick={() => moderate.mutate({ id: t.id, action: 'hide' })}>Hide</Button>
              </div>
            </CardBody></Card>
          ))}
        </div>
      )}
    </>
  );
}
