import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import { Badge, Card, DataTable, Drawer, EmptyState, Skeleton, StatusBadge } from '../../components/ui/index.js';
import { creatorLearnApi } from '../../services/api/learn.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDate } from '../../utils/format.js';

function StudentDrawer({ id, onClose }) {
  const q = useQuery({ queryKey: ['creator', 'student', id], queryFn: () => creatorLearnApi.student(id), enabled: Boolean(id) });
  const s = q.data;
  return (
    <Drawer open={Boolean(id)} onClose={onClose} title={s?.fullName ?? 'Student'}>
      {q.isLoading || !s ? <Skeleton className="h-40" /> : (
        <div className="space-y-5 text-sm">
          <dl className="grid grid-cols-3 gap-2"><dt className="text-muted">Email</dt><dd className="col-span-2 break-all">{s.email} {s.emailVerifiedAt ? <Badge tone="success">verified</Badge> : null}</dd><dt className="text-muted">Joined</dt><dd className="col-span-2">{formatDate(s.createdAt)}</dd><dt className="text-muted">Last sign-in</dt><dd className="col-span-2">{formatDate(s.lastLoginAt, { withTime: true })}</dd><dt className="text-muted">Submissions</dt><dd className="col-span-2">{s.submissions}</dd></dl>
          <div><p className="mb-2 font-semibold">Enrolments</p><ul className="space-y-2">{s.enrollments.map((e) => <li key={e.id} className="rounded-md border border-line p-3"><p className="font-medium">{e.course.title}</p><div className="mt-1 flex items-center justify-between text-xs text-muted"><StatusBadge status={e.status} /><span>{e.progressPercent}% · {e.source.toLowerCase()}</span></div></li>)}</ul></div>
          <div><p className="mb-2 font-semibold">Certificates</p>{s.certificates.length ? <ul className="space-y-1">{s.certificates.map((c) => <li key={c.id}>{c.courseTitle} · <span className="text-muted">{c.number}</span></li>)}</ul> : <p className="text-muted">None yet</p>}</div>
        </div>
      )}
    </Drawer>
  );
}

export function StudentsPage() {
  const [params, update] = useListParams();
  const [selected, setSelected] = useState(null);
  const q = useQuery({ queryKey: ['creator', 'students', params], queryFn: () => creatorLearnApi.students(params), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Students" description="Everyone with an account at your academy." breadcrumbs={[{ label: 'Students' }]} />
      <Card>
        <div className="border-b border-line p-4"><SearchInput className="md:w-80" value={params.q ?? ''} onChange={(v) => update({ q: v })} placeholder="Search name or email" /></div>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta} onPageChange={(page) => update({ page }, { resetPage: false })} onRowClick={(r) => setSelected(r.id)}
          empty={<EmptyState icon={GraduationCap} title="No students yet" description="Students appear here when they register or you enrol them in a course." />}
          columns={[
            { key: 'fullName', header: 'Student', cell: (r) => <div><p className="font-medium text-fg">{r.fullName}</p><p className="text-xs text-muted">{r.email}</p></div> },
            { key: 'enrollmentCount', header: 'Courses', align: 'right' },
            { key: 'lastLoginAt', header: 'Last active', cell: (r) => formatDate(r.lastLoginAt, { withTime: true }) },
            { key: 'createdAt', header: 'Joined', cell: (r) => formatDate(r.createdAt) },
          ]} />
      </Card>
      <StudentDrawer id={selected} onClose={() => setSelected(null)} />
    </>
  );
}
