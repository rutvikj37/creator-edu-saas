import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, IndianRupee, LayoutGrid, List, ListTree, Pencil, Plus, Users } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import { Button, Card, DataTable, EmptyState, ErrorState, Pagination, SegmentedControl, Select, Skeleton, StatusBadge } from '../../components/ui/index.js';
import { usePersistentState } from '../../hooks/usePersistentState.js';
import { coursesApi } from '../../services/api/creator.js';
import { useListParams } from '../../hooks/useListParams.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatMoney } from '../../utils/format.js';

const price = (c) => (c.isFree ? 'Free' : c.priceAmount ? formatMoney(c.priceAmount, c.currency) : 'No price');

function timeAgo(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(iso);
}

/** Course tile: cover, status ribbon when not live, key numbers and one-click shortcuts into the editor. */
function CourseCard({ c }) {
  const to = (tab) => `/creator/courses/${c.id}?tab=${tab}`;
  const shortcuts = [{ tab: 'details', icon: Pencil, label: 'Edit details' }, { tab: 'curriculum', icon: ListTree, label: 'Curriculum' }, { tab: 'pricing', icon: IndianRupee, label: 'Pricing & access' }, { tab: 'students', icon: Users, label: 'Students' }];
  return (
    <Card className="group flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md">
      <Link to={`/creator/courses/${c.id}`} className="relative block aspect-video overflow-hidden bg-surface-2" tabIndex={-1} aria-hidden>
        {c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" loading="lazy" />
          : <div className="grid size-full place-items-center bg-gradient-to-br from-primary-100 via-primary-50 to-surface dark:from-primary-500/20 dark:via-primary-500/5"><BookOpen className="size-10 text-primary-500" aria-hidden /></div>}
        {c.status !== 'PUBLISHED' && <span className="absolute top-3 left-3"><StatusBadge status={c.status} /></span>}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Link to={`/creator/courses/${c.id}`} className="line-clamp-2 font-semibold text-fg hover:text-primary-700">{c.title}</Link>
        {c.status !== 'PUBLISHED' && <span className="sr-only">Status: {c.status.toLowerCase()}</span>}
        <p className="text-sm text-muted">{c.sectionCount} sections · {c.lessonCount} lessons</p>
        <div className="mt-auto flex items-center justify-between pt-1 text-sm">
          <span className="inline-flex items-center gap-1.5 text-fg-2"><Users className="size-3.5 text-muted" aria-hidden /><span className="font-medium tabular-nums">{c.studentCount ?? 0}</span> enrolled</span>
          <span className="font-medium">{price(c)}</span>
        </div>
        <p className="text-xs text-muted">Updated {timeAgo(c.updatedAt)}</p>
      </div>
      <div className="grid grid-cols-4 divide-x divide-line border-t border-line">
        {shortcuts.map((x) => (
          <Link key={x.tab} to={to(x.tab)} title={x.label} aria-label={`${x.label}: ${c.title}`} className="grid h-10 place-items-center text-muted transition-colors hover:bg-surface-2 hover:text-primary-700">
            <x.icon className="size-4" aria-hidden />
          </Link>
        ))}
      </div>
    </Card>
  );
}

export function CoursesPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params, update] = useListParams({ pageSize: 12 });
  const q = useQuery({ queryKey: ['courses', params], queryFn: () => coursesApi.list(params), placeholderData: (p) => p });
  const canManage = auth.can('courses.manage');
  const [view, setView] = usePersistentState('courses.view', 'grid');

  return (
    <>
      <PageHeader title="Courses" count={q.data?.meta?.total} description="Build, publish and manage your courses." breadcrumbs={[{ label: 'Courses' }]}
        actions={canManage && <Button leftIcon={Plus} onClick={() => navigate('/creator/courses/new')}>Create course</Button>} />
      <Card className="mb-5 flex flex-col gap-3 p-3 md:flex-row md:items-center">
        <SearchInput className="md:flex-1" value={params.q ?? ''} onChange={(v) => update({ q: v })} placeholder="Search by course title" />
        <Select aria-label="Status" placeholder="All active" value={params.status ?? ''} onChange={(e) => update({ status: e.target.value })} className="md:w-44"
          options={['DRAFT', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'].map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))} />
        <SegmentedControl label="View" value={view} onChange={setView} options={[{ value: 'grid', icon: LayoutGrid, ariaLabel: 'Grid view' }, { value: 'list', icon: List, ariaLabel: 'List view' }]} />
      </Card>
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : q.data.items.length === 0 ? (
        <Card><EmptyState icon={BookOpen} title={params.q || params.status ? 'No courses match' : 'Create your first course'} description="Courses are made of sections and lessons. You can publish when you're ready."
          action={canManage && !params.q && <Button leftIcon={Plus} onClick={() => navigate('/creator/courses/new')}>Create course</Button>} /></Card>
      ) : (
        <>
          {view === 'grid' ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {q.data.items.map((c) => <CourseCard key={c.id} c={c} />)}
            </div>
          ) : (
            <Card>
              <DataTable rows={q.data.items} onRowClick={(c) => navigate(`/creator/courses/${c.id}`)}
                columns={[
                  { key: 'title', header: 'Course', cell: (c) => <div className="flex items-center gap-3"><div className="h-10 w-16 shrink-0 overflow-hidden rounded-md bg-surface-2">{c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" /> : <div className="grid size-full place-items-center"><BookOpen className="size-4 text-muted" aria-hidden /></div>}</div><span className="font-medium text-fg">{c.title}</span></div> },
                  { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
                  { key: 'lessonCount', header: 'Lessons', align: 'right' },
                  { key: 'studentCount', header: 'Enrolled', align: 'right', cell: (c) => c.studentCount ?? 0 },
                  { key: 'price', header: 'Price', align: 'right', cell: price },
                  { key: 'updatedAt', header: 'Updated', cell: (c) => timeAgo(c.updatedAt) },
                ]} />
            </Card>
          )}
          <Pagination page={q.data.meta.page} pageSize={q.data.meta.pageSize} total={q.data.meta.total} pageSizes={[12, 24, 48, 96]} onPageChange={(page) => update({ page }, { resetPage: false })} onPageSizeChange={(pageSize) => update({ pageSize })} />
        </>
      )}
    </>
  );
}
