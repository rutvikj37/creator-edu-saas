import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Check, CreditCard, GraduationCap, MessagesSquare, Palette, Radio, Rocket, UserPlus, Users } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { TrendCard } from '../../components/charts/TrendCard.jsx';
import { EmailVerificationBanner } from '../../components/account/EmailVerificationBanner.jsx';
import { Card, CardBody, CardHeader, ErrorState, Skeleton } from '../../components/ui/index.js';
import { academyApi2 } from '../../services/api/creator.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { cn } from '../../utils/cn.js';
import { formatDate, formatMoney, formatNumber } from '../../utils/format.js';

/** Launch checklist copy; the API only says which steps are done. */
export const SETUP_STEPS = {
  publish_academy: { title: 'Publish your academy', body: 'Finish setup and go live so students can find you.', cta: 'Continue setup', to: '/creator/onboarding', perm: 'academy.manage', icon: Rocket },
  connect_payments: { title: 'Get paid for your courses', body: 'Connect a payment gateway — you can’t collect revenue without one.', cta: 'Connect payments', to: '/creator/payments', perm: 'integrations.manage', icon: CreditCard },
  publish_course: { title: 'Publish your first course', body: 'Build a curriculum with video, quizzes and certificates.', cta: 'Create a course', to: '/creator/courses', perm: 'courses.manage', icon: BookOpen },
  add_students: { title: 'Bring in your students', body: 'Add students one by one or import a CSV of your existing audience.', cta: 'Add students', to: '/creator/students', perm: 'students.manage', icon: GraduationCap },
  schedule_live: { title: 'Host your first live class', body: 'Run a live class or webinar with Zoom, Google Meet or the built-in classroom.', cta: 'Schedule a session', to: '/creator/live', perm: 'live.manage', icon: Radio },
  start_community: { title: 'Start a community', body: 'Give students a place to talk, ask questions and stay engaged.', cta: 'Create a community', to: '/creator/communities', perm: 'community.manage', icon: MessagesSquare },
};

const ACTION_LABEL = { 'course.create': 'created a course', 'course.publish': 'published a course', 'course.update': 'updated a course', 'academy.update': 'updated the academy', 'academy.publish': 'published the academy', 'staff.invite': 'invited a team member', 'staff.join': 'joined the team', 'tenant.create': 'created the academy', 'domain.add': 'added a domain', 'student.create': 'added a student', 'student.import': 'imported students', 'enrollment.grant': 'enrolled a student' };
const bytes = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`);

function Usage({ label, used, limit, format = (n) => n }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm"><span>{label}</span><span className="text-muted tabular-nums">{format(used)} / {limit == null ? 'Unlimited' : format(limit)}</span></div>
      <div className="h-1.5 rounded-full bg-surface-2"><div className={`h-1.5 rounded-full ${pct >= 90 ? 'bg-red-500' : 'bg-primary-600'}`} style={{ width: `${limit ? pct : 0}%` }} /></div>
    </div>
  );
}

/** The most important unfinished step, shown big — the dashboard's main call to action. */
function NextStepHero({ step }) {
  const s = SETUP_STEPS[step.key];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary-200 bg-gradient-to-br from-primary-50 via-surface to-surface p-6 sm:p-8 dark:border-primary-500/30 dark:from-primary-500/10">
      <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-primary-200/40 blur-2xl dark:bg-primary-500/10" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary-600 text-on-primary shadow-sm"><s.icon className="size-6" aria-hidden /></span>
        <div className="flex-1">
          <p className="text-xs font-semibold tracking-wider text-primary-700 uppercase dark:text-primary-300">Next step</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{s.title}</h2>
          <p className="mt-1 max-w-xl text-sm text-fg-2">{s.body}</p>
        </div>
        <Link to={s.to} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 text-sm font-medium text-on-primary shadow-sm hover:bg-primary-700">
          {s.cta}<ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

function SetupChecklist({ steps }) {
  const done = steps.filter((s) => s.done).length;
  const pct = Math.round((done / steps.length) * 100);
  return (
    <section aria-labelledby="setup-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="setup-title" className="text-lg font-semibold tracking-tight">Finish your launch</h2>
          <p className="text-sm text-muted">{done} of {steps.length} done</p>
        </div>
        <div className="h-2 w-full max-w-xs rounded-full bg-surface-2 sm:w-64" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Launch progress">
          <div className="h-2 rounded-full bg-primary-600 transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map((step) => {
          const s = SETUP_STEPS[step.key];
          return (
            <li key={step.key}>
              <Card className={cn('flex h-full flex-col gap-3 p-5', step.done && 'bg-surface-2/50')}>
                <div className="flex items-center gap-3">
                  <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', step.done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300')}>
                    {step.done ? <Check className="size-4" aria-hidden /> : <s.icon className="size-4" aria-hidden />}
                  </span>
                  <p className={cn('font-semibold', step.done && 'text-muted line-through decoration-1')}>{s.title}</p>
                  {step.done && <span className="sr-only">(done)</span>}
                </div>
                {!step.done && <>
                  <p className="flex-1 text-sm text-muted">{s.body}</p>
                  <Link to={s.to} className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline dark:text-primary-300">{s.cta}<ArrowRight className="size-3.5" aria-hidden /></Link>
                </>}
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function CreatorDashboardPage() {
  const auth = useAuth();
  const d = useQuery({ queryKey: ['creator', 'dashboard'], queryFn: academyApi2.dashboard });
  const data = d.data;
  const l30 = data?.last30;
  const steps = (data?.setup ?? []).filter((s) => auth.can(SETUP_STEPS[s.key]?.perm ?? '') || s.done);
  const next = steps.find((s) => !s.done);
  const money = (v) => formatMoney(v ?? 0, l30?.currency ?? 'INR');
  const seriesOf = (k) => (l30?.series ?? []).map((p) => ({ date: p.date, value: Number(p[k] ?? 0) }));
  const firstName = auth.user?.fullName?.split(' ')[0];

  return (
    <>
      <PageHeader title={firstName ? `Welcome back, ${firstName}` : 'Home'} description={`Everything you need to run ${auth.activeTenant?.name ?? 'your academy'}.`} breadcrumbs={[{ label: 'Home' }]} />
      <EmailVerificationBanner />
      {d.isError ? <Card><ErrorState error={d.error} onRetry={() => d.refetch()} /></Card> : (
        <div className="space-y-8">
          <section aria-labelledby="last30-title" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 id="last30-title" className="text-lg font-semibold tracking-tight">In the last 30 days</h2>
              {auth.can('analytics.read') && <Link to="/creator/analytics" className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline dark:text-primary-300">View reports<ArrowRight className="size-3.5" aria-hidden /></Link>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <TrendCard label="Sign-ups" value={l30?.signups?.value} change={l30?.signups?.change} hint={l30?.signups && `vs ${formatNumber(l30.signups.previous)} in the previous 30 days`} series={seriesOf('signups')} asOf={l30?.asOf} loading={d.isLoading} />
              {(d.isLoading || l30?.paidUsers) && <TrendCard label="Paying students" value={l30?.paidUsers?.value} change={l30?.paidUsers?.change} hint={l30?.paidUsers && `vs ${formatNumber(l30.paidUsers.previous)} in the previous 30 days`} series={seriesOf('paidUsers')} asOf={l30?.asOf} loading={d.isLoading} />}
              {(d.isLoading || l30?.revenue) && <TrendCard label="Revenue" value={l30?.revenue?.value} change={l30?.revenue?.change} hint={l30?.revenue && `vs ${money(l30.revenue.previous)} in the previous 30 days`} series={seriesOf('revenue')} asOf={l30?.asOf} format={money} loading={d.isLoading} />}
              <Card className="flex flex-col justify-between gap-4 p-5">
                <p className="text-sm font-medium text-fg-2">Your academy</p>
                {d.isLoading ? <Skeleton className="h-16" /> : (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div><dt className="text-muted">Courses</dt><dd className="text-lg font-semibold tabular-nums">{formatNumber(data.courses.published)}<span className="ml-1 text-xs font-normal text-muted">live</span></dd></div>
                    <div><dt className="text-muted">Drafts</dt><dd className="text-lg font-semibold tabular-nums">{formatNumber(data.courses.draft)}</dd></div>
                    <div><dt className="text-muted">Students</dt><dd className="text-lg font-semibold tabular-nums">{formatNumber(data.students.total)}</dd></div>
                    <div><dt className="text-muted">Team</dt><dd className="text-lg font-semibold tabular-nums">{formatNumber(data.staff)}</dd></div>
                  </dl>
                )}
              </Card>
            </div>
          </section>

          {next && <NextStepHero step={next} />}
          {next && <SetupChecklist steps={steps} />}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Recent activity" />
              {d.isLoading ? <CardBody><Skeleton className="h-32" /></CardBody> : data.activity.length === 0 ? <CardBody><p className="text-sm text-muted">Nothing yet — changes you and your team make show up here.</p></CardBody> : (
                <ul className="divide-y divide-line">
                  {data.activity.map((a) => <li key={a.id} className="flex justify-between gap-4 px-5 py-3 text-sm"><span><span className="font-medium">{a.actor ?? 'System'}</span> {ACTION_LABEL[a.action] ?? a.action}</span><span className="shrink-0 text-muted">{formatDate(a.createdAt, { withTime: true })}</span></li>)}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Plan usage" description={data?.plan.name ? `${data.plan.name}${data.plan.status ? ` · ${data.plan.status.toLowerCase()}` : ''}` : undefined}
                actions={auth.can('billing.manage') && <Link to="/creator/billing" className="text-sm font-medium text-primary-700 hover:underline dark:text-primary-300">Upgrade</Link>} />
              <CardBody className="space-y-4">
                {data ? (<>
                  <Usage label="Courses" used={data.usage.courses.used} limit={data.usage.courses.limit} />
                  <Usage label="Students" used={data.usage.students.used} limit={data.usage.students.limit} />
                  <Usage label="Storage" used={data.usage.storageBytes.used} limit={data.usage.storageBytes.limit} format={bytes} />
                </>) : <Skeleton className="h-32" />}
              </CardBody>
            </Card>
          </div>

          <section aria-labelledby="quick-title" className="space-y-3">
            <h2 id="quick-title" className="text-lg font-semibold tracking-tight">Quick actions</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { to: '/creator/courses', icon: BookOpen, t: 'Create a course', s: 'Build your curriculum', perm: 'courses.manage' },
                { to: '/creator/students', icon: UserPlus, t: 'Add students', s: 'One by one or from a CSV', perm: 'students.manage' },
                { to: '/creator/academy?tab=branding', icon: Palette, t: 'Brand your academy', s: 'Logo, colours and fonts', perm: 'academy.manage' },
                { to: '/creator/staff', icon: Users, t: 'Invite your team', s: 'Instructors and staff', perm: 'staff.manage' },
              ].filter((x) => auth.can(x.perm)).map((x) => (
                <Link key={x.to} to={x.to} className="group"><Card className="flex h-full items-center gap-4 p-5 transition-shadow group-hover:shadow-md"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300"><x.icon className="size-5" aria-hidden /></span><div><p className="font-semibold">{x.t}</p><p className="text-sm text-muted">{x.s}</p></div></Card></Link>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
