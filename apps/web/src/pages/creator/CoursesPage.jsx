import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Plus } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import { Button, Card, EmptyState, ErrorState, Input, Modal, Pagination, Select, Skeleton, StatusBadge, toast } from '../../components/ui/index.js';
import { coursesApi } from '../../services/api/creator.js';
import { useListParams } from '../../hooks/useListParams.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatMoney } from '../../utils/format.js';

export function CoursesPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params, update] = useListParams({ pageSize: 12 });
  const q = useQuery({ queryKey: ['courses', params], queryFn: () => coursesApi.list(params), placeholderData: (p) => p });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const canManage = auth.can('courses.manage');

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await coursesApi.create({ title });
      toast.success('Course created');
      navigate(`/creator/courses/${c.id}?tab=curriculum`);
    } catch (e) {
      setError(e.details?.[0]?.message ?? e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Courses" description="Build, publish and manage your courses." breadcrumbs={[{ label: 'Content' }, { label: 'Courses' }]}
        actions={canManage && <Button leftIcon={Plus} onClick={() => { setOpen(true); setTitle(''); setError(null); }}>New course</Button>} />
      <div className="mb-4 flex flex-col gap-3 md:flex-row">
        <SearchInput className="md:w-72" value={params.q ?? ''} onChange={(v) => update({ q: v })} placeholder="Search courses" />
        <Select aria-label="Status" placeholder="All active" value={params.status ?? ''} onChange={(e) => update({ status: e.target.value })} className="md:w-44"
          options={['DRAFT', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'].map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))} />
      </div>
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : q.data.items.length === 0 ? (
        <Card><EmptyState icon={BookOpen} title={params.q || params.status ? 'No courses match' : 'Create your first course'} description="Courses are made of sections and lessons. You can publish when you're ready."
          action={canManage && !params.q && <Button leftIcon={Plus} onClick={() => setOpen(true)}>New course</Button>} /></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {q.data.items.map((c) => (
              <Link key={c.id} to={`/creator/courses/${c.id}`} className="group">
                <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-md">
                  <div className="aspect-video bg-surface-2">
                    {c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" /> : <div className="grid size-full place-items-center"><BookOpen className="size-8 text-line-strong" /></div>}
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2"><p className="line-clamp-2 font-semibold">{c.title}</p><StatusBadge status={c.status} /></div>
                    <p className="text-sm text-muted">{c.sectionCount} sections · {c.lessonCount} lessons</p>
                    <p className="flex justify-between text-sm"><span className="font-medium">{c.isFree ? 'Free' : c.priceAmount ? formatMoney(c.priceAmount, c.currency) : 'No price'}</span><span className="text-muted">Updated {formatDate(c.updatedAt)}</span></p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
          <Pagination page={q.data.meta.page} pageSize={q.data.meta.pageSize} total={q.data.meta.total} onPageChange={(page) => update({ page }, { resetPage: false })} />
        </>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New course" description="Start with a title — everything else can be changed later."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={title.trim().length < 3} loading={busy} onClick={create}>Create course</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); if (title.trim().length >= 3) create(); }}>
          <Input label="Course title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} error={error} placeholder="e.g. Figma for Beginners" />
        </form>
      </Modal>
    </>
  );
}
