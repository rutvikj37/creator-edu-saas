import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessagesSquare } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Skeleton, Switch, Textarea, toast } from '../../components/ui/index.js';
import { creatorLearnApi } from '../../services/api/learn.js';
import { formatDate } from '../../utils/format.js';

export function DiscussionsPage() {
  const qc = useQueryClient();
  const [unanswered, setUnanswered] = useState(true);
  const q = useQuery({ queryKey: ['creator', 'discussions', unanswered], queryFn: () => creatorLearnApi.discussions({ unanswered }) });
  const [drafts, setDrafts] = useState({});
  const refresh = () => qc.invalidateQueries({ queryKey: ['creator', 'discussions'] });
  const reply = useMutation({ mutationFn: ({ id, body }) => creatorLearnApi.reply(id, body), onSuccess: (_, v) => { setDrafts((d) => ({ ...d, [v.id]: '' })); toast.success('Reply posted'); refresh(); }, onError: (e) => toast.error(e.message) });
  const moderate = useMutation({ mutationFn: ({ id, action }) => creatorLearnApi.moderate(id, action), onSuccess: refresh, onError: (e) => toast.error(e.message) });
  return (
    <>
      <PageHeader title="Discussions" description="Questions students ask on lessons." breadcrumbs={[{ label: 'Students' }, { label: 'Discussions' }]} actions={<Switch label="Unanswered only" checked={unanswered} onChange={setUnanswered} />} />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : q.isLoading ? <Skeleton className="h-40" /> : !q.data.length ? (
        <Card><EmptyState icon={MessagesSquare} title={unanswered ? 'All caught up' : 'No questions yet'} description="Student questions from lessons will show up here." /></Card>
      ) : (
        <div className="space-y-4">
          {q.data.map((t) => (
            <Card key={t.id}><CardBody className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>{t.lesson?.course?.title} › {t.lesson?.title}</span><span>{formatDate(t.createdAt, { withTime: true })}</span></div>
              <p className="text-sm"><span className="font-medium">{t.author}:</span> {t.body}</p>
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
