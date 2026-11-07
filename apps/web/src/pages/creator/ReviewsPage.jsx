import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareReply, Star } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { ListToolbar, MetricCard } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Input, Modal, Select, Skeleton, Textarea, toast } from '../../components/ui/index.js';
import { Stars } from '../../components/reviews/Stars.jsx';
import { reviewsApi } from '../../services/api/reviews.js';
import { coursesApi } from '../../services/api/creator.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate } from '../../utils/format.js';

/** Creator: read reviews across courses, reply, hide abusive ones (with a reason the student sees). */
export function ReviewsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can('courses.manage');
  const [filters, setFilters] = useState({ courseId: '', status: '', page: 1 });
  const courses = useQuery({ queryKey: ['creator', 'courses', 'all'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const params = { ...(filters.courseId ? { courseId: filters.courseId } : {}), ...(filters.status ? { status: filters.status } : {}), page: filters.page };
  const q = useQuery({ queryKey: ['creator', 'reviews', params], queryFn: () => reviewsApi.list(params) });
  const [replying, setReplying] = useState(null);
  const [hiding, setHiding] = useState(null);
  const [text, setText] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['creator', 'reviews'] });
  const reply = useMutation({ mutationFn: () => reviewsApi.reply(replying.id, text), onSuccess: () => { toast.success(text.trim() ? 'Reply posted' : 'Reply removed'); setReplying(null); refresh(); }, onError: (e) => toast.error(e.message) });
  const status = useMutation({
    mutationFn: ({ id, s, reason }) => reviewsApi.setStatus(id, s, reason),
    onSuccess: (r) => { toast.success(r.status === 'HIDDEN' ? 'Review hidden' : 'Review shown again'); setHiding(null); refresh(); },
    onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });
  const set = (patch) => setFilters({ ...filters, ...patch, page: patch.page ?? 1 });
  const d = q.data;
  return (
    <>
      <PageHeader title="Ratings & reviews" count={d && !filters.courseId && !filters.status ? d.total : undefined} description="What students say about your courses." breadcrumbs={[{ label: 'Reviews' }]} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="flex flex-col gap-2 p-5"><p className="text-sm font-medium text-fg-2">Average rating</p>{!d ? <Skeleton className="h-8 w-24" /> : <p className="flex items-center gap-2 text-2xl font-semibold tabular-nums">{d.publishedCount ? d.average.toFixed(1) : '—'}{d.publishedCount > 0 && <Stars value={d.average} />}</p>}</Card>
        <MetricCard label="Published reviews" value={d?.publishedCount ?? 0} loading={!d} />
        <MetricCard label="Showing" value={d?.total ?? 0} hint={filters.status === 'UNANSWERED' ? 'Not replied yet' : filters.courseId ? 'For the chosen course' : 'All reviews'} loading={!d} />
      </div>
      <Card className="mb-4">
        <ListToolbar filtered={Boolean(filters.courseId || filters.status)} onReset={() => set({ courseId: '', status: '' })} count={d?.total} noun="review"
          filters={<>
            <FilterChip label="Course" value={filters.courseId || undefined} onChange={(v) => set({ courseId: v ?? '' })} options={(courses.data?.items ?? []).map((c) => ({ value: c.id, label: c.title }))} panelClassName="w-72" />
            <FilterChip label="Show" value={filters.status || undefined} onChange={(v) => set({ status: v ?? '' })} options={[{ value: 'UNANSWERED', label: 'Not replied yet' }, { value: 'PUBLISHED', label: 'Published' }, { value: 'HIDDEN', label: 'Hidden' }]} />
          </>} />
      </Card>
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : !d ? <Skeleton className="h-64" /> : d.items.length === 0 ? (
        <Card><EmptyState icon={Star} title={filters.courseId || filters.status ? 'No reviews match' : 'No reviews yet'} description="Students who have access to a course can rate it from the course player." /></Card>
      ) : (
        <div className="space-y-3">
          {d.items.map((r) => (
            <Card key={r.id}>
              <CardBody className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars value={r.rating} size="size-3.5" />
                  <span className="text-sm font-medium">{r.student.name}</span>
                  <span className="text-xs text-muted">{r.student.email} · {formatDate(r.createdAt)} · {r.course?.title}</span>
                  {r.status === 'HIDDEN' && <Badge tone="warning">Hidden: {r.hiddenReason}</Badge>}
                </div>
                {r.title && <p className="font-semibold">{r.title}</p>}
                {r.body ? <p className="whitespace-pre-line text-sm text-fg-2">{r.body}</p> : <p className="text-sm text-muted italic">Rating only</p>}
                {r.reply && <div className="rounded-md border-l-2 border-primary-500 bg-surface-2 p-3 text-sm"><p className="mb-0.5 text-xs font-medium text-muted">Your reply · {formatDate(r.repliedAt)}</p><p className="whitespace-pre-line">{r.reply}</p></div>}
                {manage && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="secondary" leftIcon={MessageSquareReply} onClick={() => { setReplying(r); setText(r.reply ?? ''); }}>{r.reply ? 'Edit reply' : 'Reply'}</Button>
                    {r.status === 'HIDDEN'
                      ? <Button size="sm" variant="ghost" onClick={() => status.mutate({ id: r.id, s: 'PUBLISHED' })}>Show again</Button>
                      : <Button size="sm" variant="ghost" onClick={() => { setHiding(r); setText(''); }}>Hide</Button>}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
          {d.pages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <Button size="sm" variant="secondary" disabled={d.page <= 1} onClick={() => set({ page: d.page - 1 })}>Previous</Button>
              <span className="text-muted">Page {d.page} of {d.pages}</span>
              <Button size="sm" variant="secondary" disabled={d.page >= d.pages} onClick={() => set({ page: d.page + 1 })}>Next</Button>
            </div>
          )}
        </div>
      )}
      <Modal open={Boolean(replying)} onClose={() => setReplying(null)} title="Reply to review"
        footer={<><Button variant="secondary" onClick={() => setReplying(null)}>Cancel</Button><Button loading={reply.isPending} onClick={() => reply.mutate()}>{text.trim() ? 'Post reply' : 'Remove reply'}</Button></>}>
        <Textarea label="Reply" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} hint="Shown publicly under the review." />
      </Modal>
      <Modal open={Boolean(hiding)} onClose={() => setHiding(null)} title="Hide this review?"
        footer={<><Button variant="secondary" onClick={() => setHiding(null)}>Cancel</Button><Button variant="danger" disabled={!text.trim()} loading={status.isPending} onClick={() => status.mutate({ id: hiding.id, s: 'HIDDEN', reason: text })}>Hide review</Button></>}>
        <p className="mb-3 text-sm text-fg-2">Hidden reviews stop counting towards the rating. The student sees the reason; you cannot change what they wrote.</p>
        <Input label="Reason" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Contains advertising" />
      </Modal>
    </>
  );
}
