import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, CheckCircle2, PlayCircle } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { EmailVerificationBanner } from '../../components/account/EmailVerificationBanner.jsx';
import { Badge, Card, EmptyState, ErrorState, Skeleton, Tabs } from '../../components/ui/index.js';
import { learnApi } from '../../services/api/learn.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate } from '../../utils/format.js';
import { useState } from 'react';

export function StudentHomePage() {
  const auth = useAuth();
  const q = useQuery({ queryKey: ['learn', 'enrollments'], queryFn: learnApi.enrollments });
  const [tab, setTab] = useState('progress');
  const all = q.data ?? [];
  const rows = all.filter((e) => (tab === 'progress' ? !e.completedAt : tab === 'completed' ? e.completedAt : true));
  const resume = all.find((e) => e.usable && !e.completedAt && e.lastAccessedAt);
  return (
    <>
      <PageHeader title={`Hi, ${auth.user?.fullName?.split(' ')[0] ?? 'there'}`} description="Pick up where you left off." breadcrumbs={[{ label: 'My learning' }]} />
      <EmailVerificationBanner />
      {resume && (
        <Card className="mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <PlayCircle className="size-8 text-primary-600" aria-hidden />
          <div className="flex-1"><p className="text-sm text-muted">Continue learning</p><p className="font-semibold">{resume.course.title}</p><div className="mt-2 h-1.5 max-w-sm rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-green-600" style={{ width: `${resume.progressPercent}%` }} /></div></div>
          <Link to={`/learn/courses/${resume.course.id}`} className="inline-flex h-9 items-center rounded-md bg-primary-600 px-4 text-sm font-medium text-on-primary">Resume</Link>
        </Card>
      )}
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: 'progress', label: 'In progress', count: all.filter((e) => !e.completedAt).length }, { value: 'completed', label: 'Completed', count: all.filter((e) => e.completedAt).length }, { value: 'all', label: 'All' }]} />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : q.isLoading ? <Skeleton className="h-48" /> : rows.length === 0 ? (
        <Card><EmptyState icon={BookOpen} title={tab === 'completed' ? 'Nothing completed yet' : 'No courses yet'} description="Browse the catalogue to start learning." action={<Link to="/courses" className="text-sm font-semibold text-primary-600">Browse courses</Link>} /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((e) => (
            <Link key={e.id} to={e.usable ? `/learn/courses/${e.course.id}` : `/courses/${e.course.slug}`} className="group">
              <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-md">
                <div className="aspect-video bg-surface-2">{e.course.thumbnailUrl ? <img src={e.course.thumbnailUrl} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center"><BookOpen className="size-8 text-line-strong" /></div>}</div>
                <div className="space-y-2 p-4">
                  <p className="font-semibold">{e.course.title}</p>
                  <div className="h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-green-600" style={{ width: `${e.progressPercent}%` }} /></div>
                  <p className="flex items-center justify-between text-xs text-muted">{e.progressPercent}% complete
                    {e.completedAt ? <span className="flex items-center gap-1 text-green-700"><CheckCircle2 className="size-3.5" />Completed</span> : !e.usable ? <Badge tone="danger">Access ended</Badge> : e.expiresAt ? <span>Access until {formatDate(e.expiresAt)}</span> : null}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
