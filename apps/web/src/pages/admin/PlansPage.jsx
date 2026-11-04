import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Star } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Badge, Card, ErrorState, Skeleton, StatusBadge } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { formatMoney } from '../../utils/format.js';

export function PlansPage() {
  const q = useQuery({ queryKey: ['platform', 'plans'], queryFn: platformApi.plans });
  return (
    <>
      <PageHeader title="Subscription plans" description="Plans, prices and the features each one includes." breadcrumbs={[{ label: 'Subscriptions' }, { label: 'Plans' }]}
        actions={<Link to="/super-admin/plans/new" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary-600 px-4 text-sm font-medium text-on-primary hover:bg-primary-700"><Plus className="size-4" /> New plan</Link>} />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.isLoading ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-48" />) : q.data.map((p) => (
            <Link key={p.id} to={`/super-admin/plans/${p.id}`} className="group">
              <Card className="h-full p-5 transition-shadow group-hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 font-semibold">{p.name} {p.isDefault && <Badge tone="primary"><Star className="size-3" /> Default</Badge>}</p>
                    <p className="text-xs text-muted">{p.code}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-fg-2">{p.description || '—'}</p>
                <div className="mt-4 space-y-1 text-sm">
                  {p.prices.filter((x) => x.active).length === 0 ? <p className="text-muted">{p.trialDays ? `${p.trialDays}-day trial` : 'No price (free / complimentary)'}</p> :
                    p.prices.filter((x) => x.active).map((x) => <p key={x.id}>{formatMoney(x.amount, x.currency)} <span className="text-muted">/ {x.interval.toLowerCase()}</span></p>)}
                </div>
                <p className="mt-4 text-xs text-muted">{p._count?.subscriptions ?? 0} current subscriptions · {p.isPublic ? 'Public' : 'Hidden'}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
