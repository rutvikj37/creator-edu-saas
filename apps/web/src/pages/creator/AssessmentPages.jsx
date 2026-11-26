import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, FileCheck2, ListChecks, Radio } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { MetricCard } from '../../components/common/ListToolbar.jsx';
import { Badge, Button, Card, DataTable, EmptyState, Modal, Tabs } from '../../components/ui/index.js';
import { creatorLearnApi } from '../../services/api/learn.js';
import { coursesApi } from '../../services/api/creator.js';
import { creatorLiveApi } from '../../services/api/live.js';
import { formatDate, formatMoney } from '../../utils/format.js';
import { GradeModal } from './QuizEditor.jsx';
import { SubmissionGradeModal } from './AssignmentEditor.jsx';

/** "Course" filter chip fed by the academy's courses. */
function useCourseOptions() {
  const courses = useQuery({ queryKey: ['creator', 'courses', 'options'], queryFn: () => coursesApi.list({ pageSize: 100 }), staleTime: 60_000 });
  return (courses.data?.items ?? []).map((c) => ({ value: c.id, label: c.title }));
}

const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);
const learner = (s) => (
  <span className="min-w-0">
    <span className="block truncate font-medium">{s?.fullName ?? 'Deleted learner'}</span>
    {s?.email && <span className="block truncate text-xs text-muted">{s.email}</span>}
  </span>
);

/** Test reports: every quiz with candidates, completions and results; open one to see its attempts. */
export function TestReportsPage() {
  const [courseId, setCourseId] = useState();
  const [open, setOpen] = useState(null);
  const courseOptions = useCourseOptions();
  const r = useQuery({ queryKey: ['creator', 'assessments', 'quizzes', courseId], queryFn: () => creatorLearnApi.testReport(courseId), placeholderData: (p) => p });
  const d = r.data;
  return (
    <>
      <PageHeader title="Test reports" description="How learners are doing on every quiz across your courses." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total quizzes" value={d?.totals.quizzes ?? 0} loading={r.isLoading} />
        <MetricCard label="Total candidates" value={d?.totals.candidates ?? 0} hint="Learners who submitted at least one quiz" loading={r.isLoading} />
        <MetricCard label="Total completions" value={d?.totals.completions ?? 0} hint="Submitted attempts" loading={r.isLoading} />
        <MetricCard label="Waiting for review" value={d?.totals.pendingReview ?? 0} hint={d?.totals.pendingReview ? <Link to="/creator/quiz-reviews" className="text-primary-600 hover:underline">Review answers</Link> : 'Open answers you still need to grade'} loading={r.isLoading} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4"><span className="text-sm text-muted">Filter by:</span><FilterChip label="Course" value={courseId} onChange={setCourseId} options={courseOptions} /></div>
        {d && <p className="px-4 pt-3 text-sm text-muted">{d.items.length} quiz{d.items.length === 1 ? '' : 'zes'}</p>}
        <DataTable loading={r.isLoading} error={r.error} onRetry={() => r.refetch()} rows={d?.items ?? []} rowKey="quizId" onRowClick={(x) => setOpen(x)}
          empty={<EmptyState icon={ListChecks} title="No quizzes yet" description="Add a quiz lesson to a course to see results here." />}
          columns={[
            { key: 'name', header: 'Test name', cell: (x) => <span className="min-w-0"><span className="block truncate font-medium">{x.lessonTitle}</span><span className="block truncate text-xs text-muted">{x.courseTitle}</span></span> },
            { key: 'candidates', header: 'Total candidates', align: 'right', cell: (x) => x.candidates },
            { key: 'completions', header: 'Completed', align: 'right', cell: (x) => x.completions },
            { key: 'passed', header: 'Passed', align: 'right', cell: (x) => x.passed },
            { key: 'avg', header: 'Average score', align: 'right', cell: (x) => pct(x.averagePercent) },
            { key: 'review', header: 'To review', align: 'right', cell: (x) => (x.pendingReview ? <Badge tone="warning">{x.pendingReview}</Badge> : '—') },
          ]} />
      </Card>
      <QuizAttemptsModal quiz={open} onClose={() => setOpen(null)} />
    </>
  );
}

function QuizAttemptsModal({ quiz, onClose }) {
  const qc = useQueryClient();
  const [grading, setGrading] = useState(null);
  const a = useQuery({ queryKey: ['creator', 'attempts', quiz?.quizId], queryFn: () => creatorLearnApi.attempts(quiz.quizId), enabled: Boolean(quiz) });
  return (
    <>
      <Modal open={Boolean(quiz) && !grading} onClose={onClose} title={quiz ? `${quiz.lessonTitle} — attempts` : ''} size="lg">
        <DataTable loading={a.isLoading} rows={a.data ?? []} empty={<EmptyState icon={ListChecks} title="No attempts yet" />}
          columns={[
            { key: 'learner', header: 'Learner', cell: (x) => learner(x.student) },
            { key: 'attempt', header: 'Attempt', align: 'right', cell: (x) => `#${x.attemptNo}` },
            { key: 'submitted', header: 'Submitted', cell: (x) => formatDate(x.submittedAt, { withTime: true }) },
            { key: 'score', header: 'Score', align: 'right', cell: (x) => (x.status === 'SUBMITTED' ? <Badge tone="warning">To review</Badge> : <span className="tabular-nums">{pct(x.percent)}{x.passed !== null && <Badge className="ml-2" tone={x.passed ? 'success' : 'danger'}>{x.passed ? 'Passed' : 'Failed'}</Badge>}</span>) },
            { key: 'act', header: '', align: 'right', cell: (x) => <Button size="sm" variant="ghost" onClick={() => setGrading(x.id)}>{x.status === 'SUBMITTED' ? 'Review' : 'View'}</Button> },
          ]} />
      </Modal>
      <GradeModal attemptId={grading} onClose={() => setGrading(null)} onGraded={() => { a.refetch(); qc.invalidateQueries({ queryKey: ['creator', 'assessments'] }); }} />
    </>
  );
}

/** Quiz reviews: open answers waiting for you to grade, across every course. */
export function QuizReviewsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('SUBMITTED');
  const [courseId, setCourseId] = useState();
  const [grading, setGrading] = useState(null);
  const courseOptions = useCourseOptions();
  const params = { status, ...(courseId ? { courseId } : {}) };
  const r = useQuery({ queryKey: ['creator', 'assessments', 'reviews', params], queryFn: () => creatorLearnApi.quizReviews(params), placeholderData: (p) => p });
  const d = r.data;
  return (
    <>
      <PageHeader title="Quiz reviews" description="Grade short and long answers that need your judgement." />
      <Card>
        <div className="space-y-3 border-b border-line p-4">
          <Tabs value={status} onChange={setStatus} tabs={[{ value: 'SUBMITTED', label: 'To review', count: d?.waiting || undefined }, { value: 'GRADED', label: 'Reviewed' }]} />
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted">Filter by:</span><FilterChip label="Course" value={courseId} onChange={setCourseId} options={courseOptions} /></div>
        </div>
        <DataTable loading={r.isLoading} error={r.error} onRetry={() => r.refetch()} rows={d?.items ?? []}
          empty={<EmptyState icon={ClipboardCheck} title={status === 'SUBMITTED' ? 'Nothing to review' : 'No reviewed attempts yet'} description={status === 'SUBMITTED' ? 'Attempts with open answers appear here after learners submit them.' : undefined} />}
          columns={[
            { key: 'learner', header: 'Learner', cell: (x) => learner(x.student) },
            { key: 'quiz', header: 'Quiz', cell: (x) => <span className="min-w-0"><span className="block truncate">{x.lessonTitle}</span><span className="block truncate text-xs text-muted">{x.courseTitle}</span></span> },
            { key: 'submitted', header: 'Submitted on', cell: (x) => formatDate(x.submittedAt, { withTime: true }) },
            { key: 'score', header: 'Score', align: 'right', cell: (x) => (status === 'SUBMITTED' ? <span className="text-muted">Auto-graded {pct(x.percent)}</span> : <span className="tabular-nums">{pct(x.percent)}</span>) },
            { key: 'act', header: '', align: 'right', cell: (x) => <Button size="sm" variant={status === 'SUBMITTED' ? 'secondary' : 'ghost'} onClick={() => setGrading(x.id)}>{status === 'SUBMITTED' ? 'Review' : 'View'}</Button> },
          ]} />
      </Card>
      <GradeModal attemptId={grading} onClose={() => setGrading(null)} onGraded={() => qc.invalidateQueries({ queryKey: ['creator', 'assessments'] })} />
    </>
  );
}

const SUBMISSION_TABS = [{ value: 'SUBMITTED', label: 'To review' }, { value: 'RETURNED', label: 'Returned' }, { value: 'GRADED', label: 'Graded' }, { value: 'ALL', label: 'All' }];

/** Assignments: every submission across your courses, ready to review. */
export function AssignmentsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('SUBMITTED');
  const [courseId, setCourseId] = useState();
  const [grading, setGrading] = useState(null);
  const courseOptions = useCourseOptions();
  const params = { ...(status !== 'ALL' ? { status } : {}), ...(courseId ? { courseId } : {}) };
  const r = useQuery({ queryKey: ['creator', 'assessments', 'submissions', params], queryFn: () => creatorLearnApi.allSubmissions(params), placeholderData: (p) => p });
  const d = r.data;
  return (
    <>
      <PageHeader title="Assignments" description="Review and grade what learners hand in." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Assignments" value={d?.totals.assignments ?? 0} loading={r.isLoading} />
        <MetricCard label="Submissions" value={d?.totals.submissions ?? 0} loading={r.isLoading} />
        <MetricCard label="To review" value={d?.totals.toReview ?? 0} loading={r.isLoading} />
        <MetricCard label="Graded" value={d?.totals.graded ?? 0} loading={r.isLoading} />
      </div>
      <Card>
        <div className="space-y-3 border-b border-line p-4">
          <Tabs value={status} onChange={setStatus} tabs={SUBMISSION_TABS.map((t) => ({ ...t, count: t.value === 'SUBMITTED' ? d?.totals.toReview || undefined : undefined }))} />
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted">Filter by:</span><FilterChip label="Course" value={courseId} onChange={setCourseId} options={courseOptions} /></div>
        </div>
        <DataTable loading={r.isLoading} error={r.error} onRetry={() => r.refetch()} rows={d?.items ?? []}
          empty={<EmptyState icon={FileCheck2} title={status === 'SUBMITTED' ? 'Nothing to review' : 'No submissions here'} description="Submissions appear here when learners hand in an assignment lesson." />}
          columns={[
            { key: 'learner', header: 'Learner', cell: (x) => learner(x.student) },
            { key: 'assignment', header: 'Assignment', cell: (x) => <span className="min-w-0"><span className="block truncate">{x.lessonTitle}</span><span className="block truncate text-xs text-muted">{x.courseTitle}</span></span> },
            { key: 'submitted', header: 'Submitted on', cell: (x) => <span className="flex items-center gap-2">{formatDate(x.submittedAt, { withTime: true })}{x.isLate && <Badge tone="warning">Late</Badge>}</span> },
            { key: 'status', header: 'Status', cell: (x) => <Badge tone={x.status === 'GRADED' ? 'success' : x.status === 'RETURNED' ? 'danger' : 'info'}>{x.status === 'GRADED' ? `${x.points}/${x.maxPoints} pts` : x.status === 'RETURNED' ? 'Returned' : 'To review'}</Badge> },
            { key: 'act', header: '', align: 'right', cell: (x) => <Button size="sm" variant={x.status === 'SUBMITTED' ? 'secondary' : 'ghost'} onClick={() => setGrading(x)}>Review</Button> },
          ]} />
      </Card>
      <SubmissionGradeModal submission={grading} maxPoints={grading?.maxPoints} onClose={() => setGrading(null)} onSaved={() => qc.invalidateQueries({ queryKey: ['creator', 'assessments'] })} />
    </>
  );
}

/** Webinars report: registrations, attendees and revenue per webinar. */
export function WebinarsReportPage() {
  const [period, setPeriod] = useState('upcoming');
  const r = useQuery({ queryKey: ['creator', 'live', 'webinar-report', period], queryFn: () => creatorLiveApi.webinarReport(period), placeholderData: (p) => p });
  const d = r.data;
  const m = (v, cur = 'INR') => formatMoney(v ?? 0, cur);
  return (
    <>
      <PageHeader title="Webinars" description="Registrations, attendance and revenue for your webinars." />
      <p className="mb-3 text-sm font-medium text-fg-2">In the last 30 days</p>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <MetricCard label="Registrations" value={d?.last30Days.registrations ?? 0} loading={r.isLoading} />
        <MetricCard label="Participants" value={d?.last30Days.participants ?? 0} hint="People who joined a session" loading={r.isLoading} />
        <MetricCard label="Total revenue" value={m(d?.last30Days.revenue)} hint="Paid webinar tickets" loading={r.isLoading} />
      </div>
      <Card>
        <div className="border-b border-line p-4"><Tabs value={period} onChange={setPeriod} tabs={[{ value: 'upcoming', label: 'Upcoming', count: d?.counts.upcoming }, { value: 'past', label: 'Past', count: d?.counts.past }]} /></div>
        {d && <p className="px-4 pt-3 text-sm text-muted">{d.items.length} webinar{d.items.length === 1 ? '' : 's'}</p>}
        <DataTable loading={r.isLoading} error={r.error} onRetry={() => r.refetch()} rows={d?.items ?? []}
          empty={<EmptyState icon={Radio} title={period === 'upcoming' ? 'No upcoming webinars' : 'No past webinars'} action={<Link to="/creator/live/new"><Button size="sm">Create webinar</Button></Link>} />}
          columns={[
            { key: 'title', header: 'Webinar', cell: (x) => <Link to={`/creator/live/${x.id}`} className="min-w-0 hover:underline"><span className="block truncate font-medium">{x.title}{x.cancelled && <Badge className="ml-2" tone="danger">Cancelled</Badge>}</span><span className="block text-xs text-muted">{x.startsAt ? formatDate(x.startsAt, { withTime: true }) : 'No session scheduled'}</span></Link> },
            { key: 'registrations', header: 'Registrations', align: 'right', cell: (x) => x.registrations },
            { key: 'attendees', header: 'Attendees', align: 'right', cell: (x) => x.attendees },
            { key: 'revenue', header: 'Revenue collected', align: 'right', cell: (x) => <span className="tabular-nums">{m(x.revenue, x.currency)}</span> },
          ]} />
      </Card>
    </>
  );
}
