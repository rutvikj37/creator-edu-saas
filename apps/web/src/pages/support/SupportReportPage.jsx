import { useQuery } from '@tanstack/react-query';
import { Clock, Inbox, Timer } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Card, ErrorState, StatCard } from '../../components/ui/index.js';
import { BreakdownChart } from '../../components/charts/ChartCard.jsx';
import { platformApi } from '../../services/api/platform.js';

export function SupportReportPage() {
  const q = useQuery({ queryKey: ['platform', 'support-report'], queryFn: platformApi.supportReport });
  const d = q.data;
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const open = d ? Object.entries(d.byStatus).filter(([k]) => !['RESOLVED', 'CLOSED'].includes(k)).reduce((s, [, v]) => s + v, 0) : undefined;
  return (
    <>
      <PageHeader title="Support reports" breadcrumbs={[{ label: 'Support' }, { label: 'Reports' }]} />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Open tickets" value={open} icon={Inbox} loading={q.isLoading} />
        <StatCard label="Avg first response" value={d?.avgFirstResponseHours == null ? '—' : `${d.avgFirstResponseHours} h`} icon={Timer} loading={q.isLoading} />
        <StatCard label="Avg resolution" value={d?.avgResolutionHours == null ? '—' : `${d.avgResolutionHours} h`} icon={Clock} loading={q.isLoading} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <BreakdownChart title="Tickets by status" loading={q.isLoading} data={d && Object.entries(d.byStatus).map(([name, value]) => ({ name: name.replace('_', ' ').toLowerCase(), value }))} />
        <BreakdownChart title="Open by priority" loading={q.isLoading} data={d && Object.entries(d.openByPriority).map(([name, value]) => ({ name: name.toLowerCase(), value }))} />
      </div>
    </>
  );
}
