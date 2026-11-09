import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Clock } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Change, TrendCard, timeAgo } from '../../components/charts/TrendCard.jsx';
import { Card, EmptyState, ErrorState, SegmentedControl, Skeleton, Tabs } from '../../components/ui/index.js';
import { analyticsApi } from '../../services/api/analytics.js';
import { formatMoney, formatNumber } from '../../utils/format.js';

const RANGES = [{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '1 year' }];
const TABS = [{ value: 'overview', label: 'Overview' }, { value: 'sales', label: 'Sales' }, { value: 'usage', label: 'Bandwidth & Usage' }, { value: 'activity', label: 'School Activity' }];
export const duration = (s) => { if (!s) return '0 Secs'; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return h ? `${h} hr ${m} min` : m ? `${m} min ${sec} sec` : `${sec} Secs`; };
const short = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
const axis = { tick: { fontSize: 11, fill: 'var(--muted)' }, tickLine: false, axisLine: false };

function SeriesCard({ title, value, change, data, keys, format = formatNumber, asOf, height = 220 }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between"><p className="text-sm font-medium text-fg-2">{title}</p>{asOf && <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Clock className="size-3" aria-hidden />{timeAgo(asOf)}</span>}</div>
      <div className="mt-2 flex items-baseline gap-2"><p className="text-2xl font-semibold tabular-nums">{value}</p><Change value={change} /></div>
      <div className="mt-4" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: -8, right: 8, top: 4 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={short} minTickGap={32} {...axis} />
            <YAxis allowDecimals={false} tickFormatter={(v) => format(v)} width={56} {...axis} />
            <Tooltip labelFormatter={short} formatter={(v, n) => [format(v), n]} contentStyle={{ borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 12 }} />
            {keys.length > 1 && <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
            {keys.map((k) => <Area key={k.key} type="monotone" dataKey={k.key} name={k.label} stroke={k.color} fill={k.color} fillOpacity={0.08} strokeWidth={2} />)}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/** Reports: sales, engagement and academy activity for the last 7/30/90/365 days vs the period before. */
export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const days = params.get('days') ?? '7';
  const set = (patch) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => n.set(k, v)); return n; }, { replace: true });
  const q = useQuery({ queryKey: ['analytics', 'reports', days], queryFn: () => analyticsApi.reports(Number(days)), placeholderData: (p) => p });
  const d = q.data;
  const money = (v) => formatMoney(v ?? 0, d?.range.currency ?? 'INR');
  const pts = (k) => (d?.series ?? []).map((x) => ({ date: x.date, value: x[k] }));
  const loading = q.isLoading;
  const card = (label, key, fmt, series) => <TrendCard key={label} label={label} value={d?.totals[key] ?? 0} change={d?.change[key]} series={series ? pts(series) : undefined} asOf={d?.asOf} format={fmt} loading={loading} />;
  const primary = 'var(--primary-600)';
  const series = (title, key, fmt) => <SeriesCard key={title} title={title} value={(fmt ?? formatNumber)(d?.totals[key === 'successful' ? 'successfulTransactions' : key] ?? 0)} change={d?.change[key]} data={d?.series ?? []} keys={[{ key, label: title, color: primary }]} format={fmt} asOf={d?.asOf} />;
  const timeChart = <SeriesCard title="Learning time" value={duration(d?.totals.timeSpentSeconds ?? 0)} change={d?.change.timeSpentSeconds} data={d?.series ?? []} format={(v) => duration(v)} asOf={d?.asOf}
    keys={[{ key: 'webSeconds', label: 'Web', color: '#60a5fa' }, { key: 'mobileSeconds', label: 'Mobile', color: '#f87171' }]} />;

  return (
    <>
      <PageHeader title="Reports" description="Insights into your sales, engagement and academy activity." />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Tabs className="border-b-0" tabs={TABS} value={tab} onChange={(t) => set({ tab: t })} />
        <SegmentedControl label="Period" size="sm" options={RANGES} value={days} onChange={(v) => set({ days: v })} />
      </div>
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : loading ? <Skeleton className="h-96" /> : (
        <div className="space-y-6">
          {tab === 'overview' && <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {card('Total revenue', 'revenue', money, 'revenue')}
              {card('New signups', 'signups', formatNumber, 'signups')}
              {card('New enrollments', 'enrollments', formatNumber, 'enrollments')}
              {card('Active users', 'activeUsers', formatNumber, 'activeUsers')}
              {card('Total time spent', 'timeSpentSeconds', duration)}
              {card('Paid users', 'paidUsers', formatNumber, 'paidUsers')}
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              {series('Revenue', 'revenue', money)}{series('Transactions', 'transactions')}
              {series('New signups', 'signups')}{series('New enrollments', 'enrollments')}
              {series('Active users', 'activeUsers')}{series('Paid users', 'paidUsers')}
              {timeChart}
            </div>
          </>}
          {tab === 'sales' && <>
            <div className="grid gap-4 sm:grid-cols-3">
              {card('Total transactions', 'transactions', formatNumber, 'transactions')}
              {card('Successful transactions', 'successfulTransactions', formatNumber, 'successful')}
              {card('Transaction amount', 'transactionAmount', money)}
            </div>
            <div className="grid gap-6 lg:grid-cols-2">{series('Revenue', 'revenue', money)}{series('Successful transactions', 'successful')}</div>
          </>}
          {tab === 'usage' && <>
            <div className="grid gap-4 sm:grid-cols-2">{card('Active users', 'activeUsers', formatNumber, 'activeUsers')}{card('Total time spent', 'timeSpentSeconds', duration)}</div>
            <div className="grid gap-6 lg:grid-cols-2">
              {series('Active users', 'activeUsers')}
              {timeChart}
              <Card className="p-5">
                <p className="text-sm font-medium text-fg-2">Usage split across devices</p>
                {!d.totals.timeSpentSeconds ? <EmptyState title="No viewing yet in this period" className="py-8" /> : (
                  <div className="mt-4 space-y-3">{[['Web', d.totals.webSeconds, 'bg-blue-400'], ['Mobile', d.totals.mobileSeconds, 'bg-red-400']].map(([l, v, c]) => (
                    <div key={l}><div className="mb-1 flex justify-between text-sm"><span>{l}</span><span className="tabular-nums text-muted">{duration(v)} · {Math.round((v / d.totals.timeSpentSeconds) * 100)}%</span></div><div className="h-2 rounded-full bg-surface-2"><div className={`h-2 rounded-full ${c}`} style={{ width: `${(v / d.totals.timeSpentSeconds) * 100}%` }} /></div></div>
                  ))}<p className="text-xs text-muted">Mobile means phone and tablet browsers.</p></div>
                )}
              </Card>
              <Card className="p-5">
                <p className="text-sm font-medium text-fg-2">Courses with highest engagement</p>
                {!d.topCourses.length ? <EmptyState title="No viewing yet in this period" className="py-8" /> : (
                  <ul className="mt-3 divide-y divide-line">{d.topCourses.map((c) => <li key={c.courseId} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="truncate font-medium">{c.title}</span><span className="shrink-0 text-muted">{duration(c.seconds)} · {c.learners} learner{c.learners === 1 ? '' : 's'}</span></li>)}</ul>
                )}
              </Card>
            </div>
          </>}
          {tab === 'activity' && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {card('New enrollments', 'enrollments', formatNumber, 'enrollments')}
              {card('Course completions', 'completions', formatNumber)}
              {card('Certificates issued', 'certificates', formatNumber)}
              {card('Quiz attempts', 'quizAttempts', formatNumber)}
              {card('Assignment submissions', 'assignmentSubmissions', formatNumber)}
              {card('Comments', 'comments', formatNumber)}
            </div>
          )}
          <p className="text-xs text-muted">Compared with the previous {days === '365' ? 'year' : `${days} days`}. Learning time is measured from video viewing.</p>
        </div>
      )}
    </>
  );
}
