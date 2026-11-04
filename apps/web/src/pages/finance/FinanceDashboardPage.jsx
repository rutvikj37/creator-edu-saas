import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CreditCard, TrendingUp } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Card, CardBody, CardHeader, ErrorState, StatCard } from '../../components/ui/index.js';
import { BreakdownChart } from '../../components/charts/ChartCard.jsx';
import { platformApi } from '../../services/api/platform.js';
import { formatMoney, formatNumber } from '../../utils/format.js';

/** Finance view of subscription revenue. Transaction finance (payments, refunds, settlements) lands in Phase 7. */
export function FinanceDashboardPage() {
  const q = useQuery({ queryKey: ['platform', 'dashboard', 'finance'], queryFn: () => platformApi.dashboard({}) });
  const d = q.data;
  const money = (list) => (list?.length ? list.map((m) => formatMoney(m.amount, m.currency)).join(' · ') : formatMoney(0, 'INR'));
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  return (
    <>
      <PageHeader title="Finance overview" description="Subscription revenue across the platform." breadcrumbs={[{ label: 'Finance' }]} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="MRR" value={d && money(d.subscriptions.mrr)} icon={TrendingUp} loading={q.isLoading} />
        <StatCard label="ARR" value={d && money(d.subscriptions.arr)} icon={CreditCard} loading={q.isLoading} />
        <StatCard label="Past due / grace" value={formatNumber(d?.subscriptions.failed)} icon={AlertTriangle} loading={q.isLoading} />
        <StatCard label="Renewals in 7 days" value={formatNumber(d?.subscriptions.expiringIn7Days)} icon={CalendarClock} loading={q.isLoading} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <BreakdownChart title="Subscriptions by plan" loading={q.isLoading} data={d?.planDistribution.map((p) => ({ name: p.name, value: p.count }))} />
        <Card>
          <CardHeader title="Payments, refunds and settlements" />
          <CardBody className="text-sm text-muted">{d?.commerce.reason ?? 'Loading…'}</CardBody>
        </Card>
      </div>
    </>
  );
}
