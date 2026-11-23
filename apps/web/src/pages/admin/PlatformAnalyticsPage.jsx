import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Building2, Crown, Download, GraduationCap, TrendingUp, Users, Wallet } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Card, CardBody, CardHeader, Skeleton, StatCard, StatusBadge, Button } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { formatMoney, formatNumber } from '../../utils/format.js';

export function PlatformAnalyticsPage() {
  const [days, setDays] = useState(30);

  const range = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    return {
      from: start.toISOString(),
      to: end.toISOString(),
    };
  }, [days]);

  const q = useQuery({
    queryKey: ['platform', 'analytics', range],
    queryFn: () => platformApi.dashboard(range),
  });

  const m = q.data;

  const exportReport = () => {
    if (!m) return;
    const blob = new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `platform-analytics-${days}d.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Platform Analytics"
        description="Cross-tenant performance, growth trajectories, and recurring revenue metrics."
        breadcrumbs={[{ label: 'Analytics' }, { label: 'Platform analytics' }]}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-line bg-surface p-0.5 text-xs font-medium">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  className={`rounded-md px-3 py-1 transition-colors ${
                    days === d ? 'bg-primary-600 text-white shadow-xs' : 'text-fg-2 hover:text-fg'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <Button variant="secondary" size="sm" leftIcon={Download} onClick={exportReport} disabled={!m}>
              Export
            </Button>
          </div>
        }
      />

      {q.isLoading ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-72 w-full rounded-lg" />
        </div>
      ) : q.isError || !m ? (
        <Card>
          <CardBody className="text-center text-red-600">Failed to load platform analytics</CardBody>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Top KPI Cards */}
          {(() => {
            const inrMrr = Array.isArray(m.subscriptions?.mrr)
              ? m.subscriptions.mrr.find((x) => x.currency === 'INR')?.amount || 0
              : m.subscriptions?.mrr?.INR || 0;
            const usdMrr = Array.isArray(m.subscriptions?.mrr)
              ? m.subscriptions.mrr.find((x) => x.currency === 'USD')?.amount || 0
              : m.subscriptions?.mrr?.USD || 0;
            const activeTenants = m.tenants?.active ?? m.tenants?.byStatus?.ACTIVE ?? 0;
            const onboardingTenants = m.tenants?.onboarding ?? m.tenants?.byStatus?.ONBOARDING ?? 0;
            const totalStudents = m.students ?? m.users?.students ?? 0;
            const totalCreators = m.creators ?? m.users?.creators ?? 0;
            const tenantSeries = m.series?.tenantRegistrations ?? m.series?.newTenants ?? [];
            const studentSeries = m.series?.studentRegistrations ?? m.series?.newStudents ?? [];
            const plans = m.planDistribution ?? m.subscriptions?.planDistribution ?? [];
            const statusEntries = m.tenants?.byStatus
              ? Object.entries(m.tenants.byStatus)
              : [
                  ['ACTIVE', m.tenants?.active ?? 0],
                  ['ONBOARDING', m.tenants?.onboarding ?? 0],
                  ['SUSPENDED', m.tenants?.suspended ?? 0],
                  ['PENDING_DELETION', m.tenants?.pendingDeletion ?? 0],
                ];

            return (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard
                    label="Total Academies"
                    value={formatNumber(m.tenants?.total ?? 0)}
                    hint={`${activeTenants} active, ${onboardingTenants} onboarding`}
                    icon={Building2}
                  />
                  <StatCard
                    label="Platform MRR (INR)"
                    value={formatMoney(inrMrr, 'INR')}
                    hint="Recurring subscription revenue"
                    icon={Wallet}
                  />
                  <StatCard
                    label="Platform MRR (USD)"
                    value={formatMoney(usdMrr, 'USD')}
                    hint="Global currencies converted"
                    icon={TrendingUp}
                  />
                  <StatCard
                    label="Total Students"
                    value={formatNumber(totalStudents)}
                    hint={`Managed by ${totalCreators} creators`}
                    icon={GraduationCap}
                  />
                </div>

                {/* Growth Series */}
                <div className="grid gap-6 lg:grid-cols-2">
                  <Card>
                    <CardHeader title="New Academy Registrations" description={`Daily registrations over the last ${days} days`} />
                    <CardBody>
                      <div className="flex h-44 items-end gap-1.5 pt-4">
                        {tenantSeries.map((pt, idx) => {
                          const max = Math.max(...tenantSeries.map((p) => p.count), 1);
                          const heightPercent = Math.max(8, Math.round((pt.count / max) * 100));
                          return (
                            <div key={idx} className="group relative flex-1 flex flex-col items-center">
                              <div
                                className="w-full rounded-t bg-primary-500/80 transition-all hover:bg-primary-600"
                                style={{ height: `${heightPercent}%` }}
                              />
                              <div className="absolute -top-7 hidden rounded bg-fg px-1.5 py-0.5 text-[10px] text-bg group-hover:block whitespace-nowrap z-10">
                                {pt.date}: {pt.count}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader title="Student Growth Activity" description={`New students enrolled over the last ${days} days`} />
                    <CardBody>
                      <div className="flex h-44 items-end gap-1.5 pt-4">
                        {studentSeries.map((pt, idx) => {
                          const max = Math.max(...studentSeries.map((p) => p.count), 1);
                          const heightPercent = Math.max(8, Math.round((pt.count / max) * 100));
                          return (
                            <div key={idx} className="group relative flex-1 flex flex-col items-center">
                              <div
                                className="w-full rounded-t bg-green-500/80 transition-all hover:bg-green-600"
                                style={{ height: `${heightPercent}%` }}
                              />
                              <div className="absolute -top-7 hidden rounded bg-fg px-1.5 py-0.5 text-[10px] text-bg group-hover:block whitespace-nowrap z-10">
                                {pt.date}: {pt.count}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardBody>
                  </Card>
                </div>

                {/* Breakdown Tables */}
                <div className="grid gap-6 lg:grid-cols-2">
                  <Card>
                    <CardHeader title="Active Subscriptions by Plan" description="Distribution of paid vs trial tiers across academies" />
                    <div className="divide-y divide-line">
                      {plans.map((p) => (
                        <div key={p.planId} className="flex items-center justify-between px-5 py-3 text-sm">
                          <span className="font-medium text-fg">{p.name}</span>
                          <div className="flex items-center gap-3">
                            <span className="tabular-nums text-fg-2">{p.count} academies</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>

                  <Card>
                    <CardHeader title="Tenant Status Health" description="Status distribution across all provisioned academies" />
                    <div className="divide-y divide-line">
                      {statusEntries.map(([st, count]) => (
                        <div key={st} className="flex items-center justify-between px-5 py-3 text-sm">
                          <StatusBadge status={st} />
                          <span className="tabular-nums font-medium text-fg">{count}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </>
  );
}
