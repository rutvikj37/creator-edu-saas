import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Award,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  GraduationCap,
  PlayCircle,
  Radio,
  Users,
  Video,
} from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { EmailVerificationBanner } from '../../components/account/EmailVerificationBanner.jsx';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton, StatCard, Tabs } from '../../components/ui/index.js';
import { learnApi } from '../../services/api/learn.js';
import { learnLiveApi } from '../../services/api/live.js';
import { coachingApi } from '../../services/api/coaching.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatNumber } from '../../utils/format.js';

const EXPIRY_DAYS = 14;
const MS_DAY = 86_400_000;

function daysUntil(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / MS_DAY);
}

export function upcomingCoachingBookings(programs) {
  const now = Date.now();
  const out = [];
  for (const p of programs ?? []) {
    for (const s of p.sessions ?? []) {
      const b = s.booking;
      if (b?.status === 'BOOKED' && new Date(b.endsAt).getTime() > now) {
        out.push({
          id: b.id,
          programTitle: p.title,
          sessionTitle: s.title,
          startsAt: b.startsAt,
          coachName: b.coachName,
        });
      }
    }
  }
  return out.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

export function expiringEnrollments(enrollments) {
  const now = Date.now();
  const horizon = now + EXPIRY_DAYS * MS_DAY;
  return (enrollments ?? [])
    .filter((e) => {
      if (!e.usable || e.completedAt || !e.expiresAt) return false;
      const t = new Date(e.expiresAt).getTime();
      return t > now && t <= horizon;
    })
    .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
}

const QUICK_LINKS = [
  { label: 'Certificates', to: '/learn/certificates', icon: Award },
  { label: 'Live', to: '/learn/live', icon: Video },
  { label: 'Coaching', to: '/learn/coaching', icon: Users },
  { label: 'Browse courses', to: '/courses', icon: BookOpen },
];

export function StudentHomePage() {
  const auth = useAuth();
  const enrollmentsQ = useQuery({ queryKey: ['learn', 'enrollments'], queryFn: learnApi.enrollments });
  const certificatesQ = useQuery({ queryKey: ['learn', 'certificates'], queryFn: learnApi.certificates });
  const liveQ = useQuery({ queryKey: ['learn', 'live', 'upcoming'], queryFn: learnLiveApi.upcoming, refetchInterval: 60_000 });
  const coachingQ = useQuery({ queryKey: ['learn', 'coaching'], queryFn: coachingApi.mine });

  const [tab, setTab] = useState('progress');
  const all = enrollmentsQ.data ?? [];
  const rows = all.filter((e) => (tab === 'progress' ? !e.completedAt : tab === 'completed' ? e.completedAt : true));
  const inProgressCount = all.filter((e) => !e.completedAt && e.usable).length;
  const completedCount = all.filter((e) => e.completedAt).length;

  const resume = useMemo(() => {
    const candidates = all.filter((e) => e.usable && !e.completedAt);
    if (!candidates.length) return null;
    return [...candidates].sort((a, b) => new Date(b.lastAccessedAt ?? 0) - new Date(a.lastAccessedAt ?? 0))[0];
  }, [all]);

  const coachingBookings = useMemo(() => upcomingCoachingBookings(coachingQ.data), [coachingQ.data]);
  const expiring = useMemo(() => expiringEnrollments(all), [all]);
  const liveUpcoming = liveQ.data ?? [];
  const upcomingCount = liveUpcoming.length + coachingBookings.length;

  const certCount = (certificatesQ.data ?? []).filter((c) => c.status === 'ISSUED').length;
  const statsLoading = enrollmentsQ.isLoading || certificatesQ.isLoading || liveQ.isLoading || coachingQ.isLoading;

  const upNextItems = useMemo(() => {
    const items = [];
    for (const s of liveUpcoming.slice(0, 5)) {
      items.push({
        key: `live-${s.id}`,
        icon: Radio,
        title: s.liveClass?.title ?? 'Live class',
        meta: s.status === 'LIVE' ? 'Live now' : formatDate(s.startsAt, { withTime: true }),
        to: '/learn/live',
        accent: s.status === 'LIVE',
      });
    }
    for (const b of coachingBookings.slice(0, 5)) {
      items.push({
        key: `coach-${b.id}`,
        icon: CalendarCheck,
        title: b.sessionTitle,
        meta: `${formatDate(b.startsAt, { withTime: true })} · ${b.coachName ?? b.programTitle}`,
        to: '/learn/coaching',
      });
    }
    for (const e of expiring.slice(0, 3)) {
      const d = daysUntil(e.expiresAt);
      items.push({
        key: `exp-${e.id}`,
        icon: Clock,
        title: e.course.title,
        meta: d != null ? `Access ends in ${d} day${d === 1 ? '' : 's'}` : `Access until ${formatDate(e.expiresAt)}`,
        to: `/learn/courses/${e.course.id}`,
        accent: true,
      });
    }
    return items;
  }, [liveUpcoming, coachingBookings, expiring]);

  const firstName = auth.user?.fullName?.split(' ')[0] ?? 'there';

  return (
    <>
      <PageHeader title={`Hi, ${firstName}`} description="Pick up where you left off." breadcrumbs={[{ label: 'My learning' }]} />
      <EmailVerificationBanner />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="In progress" value={formatNumber(inProgressCount)} icon={PlayCircle} loading={enrollmentsQ.isLoading} />
        <StatCard label="Completed" value={formatNumber(completedCount)} icon={CheckCircle2} loading={enrollmentsQ.isLoading} />
        <StatCard label="Certificates" value={formatNumber(certCount)} icon={GraduationCap} loading={certificatesQ.isLoading} />
        <StatCard label="Upcoming" value={formatNumber(upcomingCount)} hint="Live & coaching" icon={CalendarClock} loading={statsLoading} />
      </div>

      {resume && (
        <Card className="mb-6 overflow-hidden border-primary-200 bg-gradient-to-r from-primary-50/80 to-surface dark:border-primary-500/30 dark:from-primary-500/10">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-primary-600 text-on-primary">
              <PlayCircle className="size-7" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold tracking-wide text-primary-700 uppercase dark:text-primary-300">Continue learning</p>
              <p className="mt-1 truncate text-lg font-semibold text-fg">{resume.course.title}</p>
              <div className="mt-3 flex max-w-md items-center gap-3">
                <div className="h-2 min-w-0 flex-1 rounded-full bg-surface-2">
                  <div className="h-2 rounded-full bg-green-600 transition-all" style={{ width: `${resume.progressPercent}%` }} />
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums text-muted">{resume.progressPercent}%</span>
              </div>
            </div>
            <Link
              to={`/learn/courses/${resume.course.id}`}
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-primary-600 px-5 text-sm font-medium text-on-primary transition hover:bg-primary-700"
            >
              Resume
            </Link>
          </div>
        </Card>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card className="h-fit">
          <CardHeader title="Up next" description="Live sessions, coaching and access reminders" />
          <CardBody className="p-0">
            {liveQ.isLoading || coachingQ.isLoading ? (
              <div className="p-5">
                <Skeleton className="h-20" />
              </div>
            ) : upNextItems.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted">You’re all caught up — nothing scheduled in the next few weeks.</p>
            ) : (
              <ul className="divide-y divide-line">
                {upNextItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.key}>
                      <Link
                        to={item.to}
                        className="flex items-start gap-3 px-5 py-4 text-sm transition hover:bg-surface-2"
                      >
                        <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-md ${item.accent ? 'bg-red-50 text-red-600 dark:bg-red-500/10' : 'bg-surface-2 text-muted'}`}>
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-fg">{item.title}</p>
                          <p className="mt-0.5 text-xs text-muted">{item.meta}</p>
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-line-strong" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <div>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-sm font-semibold text-fg">My courses</h2>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'progress', label: 'In progress', count: all.filter((e) => !e.completedAt).length },
                { value: 'completed', label: 'Completed', count: all.filter((e) => e.completedAt).length },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
          {enrollmentsQ.isError ? (
            <Card>
              <ErrorState error={enrollmentsQ.error} onRetry={() => enrollmentsQ.refetch()} />
            </Card>
          ) : enrollmentsQ.isLoading ? (
            <Skeleton className="h-48" />
          ) : rows.length === 0 ? (
            <Card>
              <EmptyState
                icon={BookOpen}
                title={tab === 'completed' ? 'Nothing completed yet' : 'No courses yet'}
                description="Browse the catalogue to start learning."
                action={
                  <Link to="/courses" className="text-sm font-semibold text-primary-600">
                    Browse courses
                  </Link>
                }
              />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {rows.map((e) => (
                <Link key={e.id} to={e.usable ? `/learn/courses/${e.course.id}` : `/courses/${e.course.slug}`} className="group">
                  <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-md">
                    <div className="aspect-video bg-surface-2">
                      {e.course.thumbnailUrl ? (
                        <img src={e.course.thumbnailUrl} alt="" className="size-full object-cover" />
                      ) : (
                        <div className="grid size-full place-items-center">
                          <BookOpen className="size-8 text-line-strong" />
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 p-4">
                      <p className="font-semibold">{e.course.title}</p>
                      <div className="h-1.5 rounded-full bg-surface-2">
                        <div className="h-1.5 rounded-full bg-green-600" style={{ width: `${e.progressPercent}%` }} />
                      </div>
                      <p className="flex items-center justify-between text-xs text-muted">
                        {e.progressPercent}% complete
                        {e.completedAt ? (
                          <span className="flex items-center gap-1 text-green-700">
                            <CheckCircle2 className="size-3.5" />
                            Completed
                          </span>
                        ) : !e.usable ? (
                          <Badge tone="danger">Access ended</Badge>
                        ) : e.expiresAt ? (
                          <span>Access until {formatDate(e.expiresAt)}</span>
                        ) : null}
                      </p>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line pt-5">
        <span className="mr-1 self-center text-xs font-medium text-muted">Quick links</span>
        {QUICK_LINKS.map(({ label, to, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition hover:border-primary-300 hover:bg-primary-50 dark:hover:bg-primary-500/10"
          >
            <Icon className="size-4 text-primary-600" aria-hidden />
            {label}
          </Link>
        ))}
      </div>
    </>
  );
}