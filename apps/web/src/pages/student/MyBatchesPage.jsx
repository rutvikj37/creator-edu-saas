import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Boxes } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Badge, Card, CardBody, EmptyState, ErrorState, Skeleton } from '../../components/ui/index.js';
import { learnBatchesApi } from '../../services/api/live.js';
import { formatDate } from '../../utils/format.js';

function phase(b) {
  const today = new Date().toISOString().slice(0, 10);
  if (b.startsAt && String(b.startsAt).slice(0, 10) > today) return { label: 'Upcoming', tone: 'info' };
  if (b.endsAt && String(b.endsAt).slice(0, 10) < today) return { label: 'Finished', tone: 'neutral' };
  return { label: 'Running', tone: 'success' };
}

export function MyBatchesPage() {
  const q = useQuery({ queryKey: ['learn', 'batches'], queryFn: learnBatchesApi.list });
  const rows = q.data ?? [];
  return (
    <>
      <PageHeader title="My batches" description="Cohorts you’ve been added to." breadcrumbs={[{ label: 'My batches' }]} />
      {q.isError ? (
        <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
      ) : q.isLoading ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={Boxes} title="No batches yet" description="When your academy adds you to a batch, it will show up here." />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((b) => {
            const p = phase(b);
            return (
              <Card key={b.id}>
                <CardBody className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-fg">{b.name}</p>
                      {b.description && <p className="mt-1 text-sm text-muted line-clamp-2">{b.description}</p>}
                    </div>
                    <Badge tone={p.tone}>{p.label}</Badge>
                  </div>
                  <p className="text-xs text-muted">
                    {b.startsAt ? `${formatDate(b.startsAt)}${b.endsAt ? ` – ${formatDate(b.endsAt)}` : ''}` : 'No dates set'}
                    {b.memberCount != null ? ` · ${b.memberCount} member${b.memberCount === 1 ? '' : 's'}` : ''}
                  </p>
                  {b.course ? (
                    <Link to={`/learn/courses/${b.course.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:underline">
                      <BookOpen className="size-4" aria-hidden />
                      {b.course.title}
                    </Link>
                  ) : null}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
