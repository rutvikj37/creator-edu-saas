import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Building2, CalendarClock, CreditCard, GraduationCap, PauseCircle, TrendingUp, Users } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Card, CardBody, CardHeader, ErrorState, StatCard } from '../../components/ui/index.js';
import { BreakdownChart, TrendChart } from '../../components/charts/ChartCard.jsx';
import { DateRangeFilter, presetRange } from '../../components/common/DateRangeFilter.jsx';
import { platformApi } from '../../services/api/platform.js';
import { formatMoney, formatNumber } from '../../utils/format.js';

function moneyList(list) {
  if (!list?.length) return formatMoney(0, 'INR');
  return list.map((m) => formatMoney(m.amount, m.currency)).join(' · ');
}

/** Super Admin dashboard. Every figure is computed by the API from live data. */
export function AdminDashboardPage() {
  const [range, setRange] = useState({ preset: '30d', ...presetRange('30d') });
  const q = useQuery({ queryKey: ['platform', 'dashboard', range.from, range.to], queryFn: () => platformApi.dashboard({ from: range.from, to: range.to }), placeholderData: (prev) => prev });
  const d = q.data;
  const loading = q.isLoading;

  return (
    <>
      <PageHeader title="Platform overview" description="Tenants, subscriptions and growth across the platform." breadcrumbs={[{ label: 'Dashboard' }]} actions={<DateRangeFilter value={range} onChange={setRange} />} />
      {q.isError ? (
        <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total tenants" value={formatNumber(d?.tenants.total)} hint={d && `${d.tenants.active} active · ${d.tenants.onboarding} onboarding`} icon={Building2} loading={loading} />
            <StatCard label="Suspended" value={formatNumber(d?.tenants.suspended)} hint={d && `${d.tenants.pendingDeletion} pending deletion`} icon={PauseCircle} loading={loading} />
            <StatCard label="Creators" value={formatNumber(d?.creators)} icon={Users} loading={loading} />
            <StatCard label="Students" value={formatNumber(d?.students)} icon={GraduationCap} loading={loading} />
            <StatCard label="MRR" value={d && moneyList(d.subscriptions.mrr)} hint="Paying subscriptions" icon={TrendingUp} loading={loading} />
            <StatCard label="ARR" value={d && moneyList(d.subscriptions.arr)} icon={CreditCard} loading={loading} />
            <StatCard label="Active subscriptions" value={formatNumber(d?.subscriptions.active)} hint="Including trials" icon={CreditCard} loading={loading} />
            <StatCard label="Expiring in 7 days" value={formatNumber(d?.subscriptions.expiringIn7Days)} hint={d && `${d.subscriptions.failed} past due / grace`} icon={CalendarClock} loading={loading} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <TrendChart title="Tenant registrations" description="New academies per day" data={d?.series.tenantRegistrations} loading={loading} />
            <TrendChart title="Student growth" description="New student accounts per day" data={d?.series.studentRegistrations} loading={loading} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <BreakdownChart title="Plan distribution" description="Current subscriptions by plan" data={d?.planDistribution.map((p) => ({ name: p.name, value: p.count }))} loading={loading} />
            <BreakdownChart title="Subscription status" data={d && Object.entries(d.subscriptions.byStatus).map(([name, value]) => ({ name: name.charAt(0) + name.slice(1).toLowerCase().replace('_', ' '), value }))} loading={loading} />
          </div>
          {d && !d.commerce.available && (
            <Card>
              <CardHeader title="Sales, commissions and settlements" />
              <CardBody className="flex items-center gap-3 text-sm text-muted">
                <AlertTriangle className="size-4" aria-hidden /> {d.commerce.reason}
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
