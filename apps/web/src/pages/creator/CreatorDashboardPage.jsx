import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, CheckCircle2, GraduationCap, Rocket, UserPlus, Users } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { EmailVerificationBanner } from '../../components/account/EmailVerificationBanner.jsx';
import { Card, CardBody, CardHeader, ErrorState, Skeleton, StatCard } from '../../components/ui/index.js';
import { academyApi2 } from '../../services/api/creator.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatNumber } from '../../utils/format.js';

function Usage({ label, used, limit, format = (n) => n }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm"><span>{label}</span><span className="text-muted tabular-nums">{format(used)} / {limit == null ? 'Unlimited' : format(limit)}</span></div>
      <div className="h-1.5 rounded-full bg-surface-2"><div className={`h-1.5 rounded-full ${pct >= 90 ? 'bg-red-500' : 'bg-primary-600'}`} style={{ width: `${limit ? pct : 0}%` }} /></div>
    </div>
  );
}
const bytes = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`);
const ACTION_LABEL = { 'course.create': 'created a course', 'course.publish': 'published a course', 'course.update': 'updated a course', 'academy.update': 'updated the academy', 'academy.publish': 'published the academy', 'staff.invite': 'invited a team member', 'staff.join': 'joined the team', 'tenant.create': 'created the academy', 'domain.add': 'added a domain' };

export function CreatorDashboardPage() {
  const auth = useAuth();
  const d = useQuery({ queryKey: ['creator', 'dashboard'], queryFn: academyApi2.dashboard });
  const ob = useQuery({ queryKey: ['onboarding'], queryFn: academyApi2.onboarding });
  const data = d.data;
  return (
    <>
      <PageHeader title={`Welcome back, ${auth.user?.fullName?.split(' ')[0] ?? ''}`} description={auth.activeTenant?.name} breadcrumbs={[{ label: 'Dashboard' }]} />
      <EmailVerificationBanner />
      {ob.data && !ob.data.completedAt && (
        <Card className="mb-6 border-primary-200 bg-primary-50/40">
          <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Rocket className="size-6 text-primary-600" aria-hidden />
            <div className="flex-1"><p className="font-semibold">Finish setting up your academy</p><p className="text-sm text-muted">{ob.data.progress}% complete · step {ob.data.currentStep} of 10</p></div>
            <Link to="/creator/onboarding" className="inline-flex h-9 items-center rounded-md bg-primary-600 px-4 text-sm font-medium text-on-primary hover:bg-primary-700">Continue setup</Link>
          </CardBody>
        </Card>
      )}
      {d.isError ? <Card><ErrorState error={d.error} onRetry={() => d.refetch()} /></Card> : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Courses" value={formatNumber(data?.courses.total)} hint={data && `${data.courses.published} published · ${data.courses.draft} drafts`} icon={BookOpen} loading={d.isLoading} />
            <StatCard label="Students" value={formatNumber(data?.students.total)} hint={data && `${data.students.newLast30Days} new in 30 days`} icon={GraduationCap} loading={d.isLoading} />
            <StatCard label="Team" value={formatNumber(data?.staff)} icon={Users} loading={d.isLoading} />
            <StatCard label="Plan" value={data?.plan.name ?? '—'} hint={data?.plan.status?.toLowerCase()} icon={CheckCircle2} loading={d.isLoading} />
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Recent activity" />
              {d.isLoading ? <CardBody><Skeleton className="h-32" /></CardBody> : (
                <ul className="divide-y divide-line">
                  {data.activity.map((a) => <li key={a.id} className="flex justify-between gap-4 px-5 py-3 text-sm"><span><span className="font-medium">{a.actor ?? 'System'}</span> {ACTION_LABEL[a.action] ?? a.action}</span><span className="text-muted">{formatDate(a.createdAt, { withTime: true })}</span></li>)}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Plan usage" />
              <CardBody className="space-y-4">
                {data ? (<>
                  <Usage label="Courses" used={data.usage.courses.used} limit={data.usage.courses.limit} />
                  <Usage label="Students" used={data.usage.students.used} limit={data.usage.students.limit} />
                  <Usage label="Storage" used={data.usage.storageBytes.used} limit={data.usage.storageBytes.limit} format={bytes} />
                  <p className="text-xs text-muted">{data.revenue.reason}</p>
                </>) : <Skeleton className="h-32" />}
              </CardBody>
            </Card>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {[{ to: '/creator/courses', icon: BookOpen, t: 'Create a course', s: 'Build your curriculum' }, { to: '/creator/academy?tab=branding', icon: Rocket, t: 'Brand your academy', s: 'Logo, colours and fonts' }, { to: '/creator/staff', icon: UserPlus, t: 'Invite your team', s: 'Instructors and staff' }].map((x) => (
              <Link key={x.to} to={x.to} className="group"><Card className="flex items-center gap-4 p-5 transition-shadow group-hover:shadow-md"><x.icon className="size-5 text-primary-600" /><div><p className="font-semibold">{x.t}</p><p className="text-sm text-muted">{x.s}</p></div></Card></Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
