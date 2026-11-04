import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, Minus } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Card, CardBody, CardHeader, ErrorState, Skeleton, StatusBadge } from '../../components/ui/index.js';
import { creatorApi } from '../../services/api/platform.js';
import { formatDate, formatMoney } from '../../utils/format.js';

function featureText(f, value) {
  if (!value || !value.enabled) return null;
  if (f.kind === 'flag') return true;
  return value.limit === null ? 'Unlimited' : value.limit;
}

export function BillingPage() {
  const billing = useQuery({ queryKey: ['creator', 'billing'], queryFn: creatorApi.billing });
  const plans = useQuery({ queryKey: ['public', 'plans'], queryFn: creatorApi.publicPlans });
  if (billing.isError) return <Card><ErrorState error={billing.error} onRetry={() => billing.refetch()} /></Card>;
  if (billing.isLoading) return <Skeleton className="h-96" />;
  const { subscription: s, entitlements: e, usage, catalog } = billing.data;
  const limits = catalog.filter((f) => f.kind === 'limit' && f.key !== 'commission.percent');

  return (
    <>
      <PageHeader title="Billing & subscription" description="Your plan, what's included and how much you're using." breadcrumbs={[{ label: 'Workspace' }, { label: 'Billing' }]} />
      {!e.active && <Alert tone="error" title="No active plan" className="mb-6">Most features are paused. Contact support to restore your plan.</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Current plan" actions={s && <StatusBadge status={s.status} />} />
          <CardBody>
            {s ? (
              <div className="space-y-3 text-sm">
                <p className="text-2xl font-semibold">{s.plan.name}</p>
                <p className="text-muted">{s.planPrice ? `${formatMoney(s.planPrice.amount, s.planPrice.currency)} / ${s.planPrice.interval.toLowerCase()}` : s.status === 'TRIALING' ? 'Free trial' : 'Complimentary'}</p>
                {s.status === 'TRIALING' && <p>Trial ends <strong>{formatDate(s.trialEndsAt)}</strong></p>}
                {s.status !== 'TRIALING' && s.currentPeriodEnd && <p>Renews <strong>{formatDate(s.currentPeriodEnd)}</strong></p>}
                <p className="text-xs text-muted">Transaction fee: {e.features['commission.percent']?.limit ?? 0}% per sale</p>
              </div>
            ) : <p className="text-sm text-muted">No subscription.</p>}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Usage" />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            {limits.map((f) => {
              const v = e.features[f.key];
              const used = usage[f.key];
              const pct = v?.limit === 0 ? ((used ?? 0) > 0 ? 100 : 0) : v?.limit ? Math.min(100, Math.round(((used ?? 0) / v.limit) * 100)) : 0;
              return (
                <div key={f.key} className="space-y-1.5">
                  <div className="flex justify-between text-sm"><span>{f.label}</span>
                    <span className="text-muted tabular-nums">{!v?.enabled ? 'Not included' : used === undefined ? (v.limit === null ? 'Unlimited' : `Up to ${v.limit}`) : `${used} / ${v.limit === null ? '∞' : v.limit}`}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-2"><div className={`h-1.5 rounded-full ${pct >= 90 ? 'bg-red-500' : 'bg-primary-600'}`} style={{ width: `${used !== undefined && v?.limit !== null && v?.limit !== undefined ? pct : 0}%` }} /></div>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>

      <h2 className="mt-10 mb-4 text-lg font-semibold">Compare plans</h2>
      <Alert tone="info" className="mb-4">
        Online plan upgrades open when payments go live. To change plans now, <Link to="/creator/support?new=billing" className="font-semibold underline">contact support</Link>.
      </Alert>
      {plans.isLoading ? <Skeleton className="h-64" /> : (
        <div className="grid gap-4 md:grid-cols-3">
          {(plans.data ?? []).map((p) => {
            const current = s?.plan.id === p.id;
            const values = Object.fromEntries(p.features.map((f) => [f.featureKey, { enabled: f.enabled, limit: f.limitValue }]));
            const monthly = p.prices.find((x) => x.interval === 'MONTH');
            return (
              <Card key={p.id} className={current ? 'ring-2 ring-primary-600' : ''}>
                <CardBody>
                  <p className="flex items-center gap-2 font-semibold">{p.name} {current && <Badge tone="primary">Current</Badge>}</p>
                  <p className="mt-1 text-2xl font-semibold">{monthly ? formatMoney(monthly.amount, monthly.currency) : p.trialDays ? 'Free' : '—'}<span className="text-sm font-normal text-muted">{monthly ? ' / month' : p.trialDays ? ` for ${p.trialDays} days` : ''}</span></p>
                  <ul className="mt-4 space-y-2 text-sm">
                    {catalog.filter((f) => f.key !== 'commission.percent').map((f) => {
                      const t = featureText(f, values[f.key]);
                      return (
                        <li key={f.key} className="flex items-center gap-2">
                          {t ? <Check className="size-4 text-green-600" aria-hidden /> : <Minus className="size-4 text-line-strong" aria-hidden />}
                          <span className={t ? '' : 'text-muted'}>{f.label}{t && t !== true ? `: ${t}` : ''}</span>
                        </li>
                      );
                    })}
                  </ul>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
