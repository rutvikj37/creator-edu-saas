import { useQuery } from '@tanstack/react-query';
import { Database, HardDrive, ListChecks, RefreshCw, Server } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button, Card, CardBody, CardHeader, ErrorState, Skeleton, StatusBadge } from '../../components/ui/index.js';
import { systemApi } from '../../services/api/system.js';
import { formatDate } from '../../utils/format.js';

const SERVICES = [
  { key: 'database', label: 'MySQL database', icon: Database },
  { key: 'redis', label: 'Redis cache', icon: HardDrive },
  { key: 'queue', label: 'Background queue', icon: ListChecks },
];

/** Live readiness view backed by GET /health (real checks against MySQL, Redis, BullMQ). */
export function SystemStatusPage() {
  const health = useQuery({ queryKey: ['system', 'health'], queryFn: systemApi.health, refetchInterval: 15_000 });
  const info = useQuery({ queryKey: ['system', 'info'], queryFn: systemApi.info });

  return (
    <>
      <PageHeader
        title="System status"
        description="Live connectivity checks for the platform's core services."
        breadcrumbs={[{ label: 'System' }, { label: 'System status' }]}
        actions={
          <Button variant="secondary" leftIcon={RefreshCw} loading={health.isFetching} onClick={() => health.refetch()}>
            Refresh
          </Button>
        }
      />
      {health.isError ? (
        <Card>
          <ErrorState title="API unreachable" error={health.error} onRetry={() => health.refetch()} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium tracking-wide text-muted uppercase">API</p>
              <Server className="size-4 text-muted" aria-hidden />
            </div>
            <div className="mt-3">{health.isLoading ? <Skeleton className="h-6 w-20" /> : <StatusBadge status={health.data?.status ?? 'error'} label={health.data?.status === 'ok' ? 'Operational' : 'Degraded'} />}</div>
            <p className="mt-2 text-xs text-muted">Last checked {health.dataUpdatedAt ? formatDate(health.dataUpdatedAt, { withTime: true }) : '—'}</p>
          </Card>
          {SERVICES.map((s) => {
            const d = health.data?.details?.[s.key];
            return (
              <Card key={s.key} className="p-5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium tracking-wide text-muted uppercase">{s.label}</p>
                  <s.icon className="size-4 text-muted" aria-hidden />
                </div>
                <div className="mt-3">{health.isLoading ? <Skeleton className="h-6 w-20" /> : <StatusBadge status={d?.status ?? 'down'} label={d?.status === 'up' ? 'Up' : 'Down'} />}</div>
                <p className="mt-2 text-xs text-muted">
                  {d?.latencyMs !== undefined ? `${d.latencyMs} ms` : d?.waiting !== undefined ? `${d.waiting} waiting · ${d.failed} failed` : d?.message ?? '—'}
                </p>
              </Card>
            );
          })}
        </div>
      )}
      <Card className="mt-6">
        <CardHeader title="Platform" description="Values served by GET /api/v1/system/info" />
        <CardBody>
          {info.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : info.isError ? (
            <ErrorState error={info.error} onRetry={() => info.refetch()} />
          ) : (
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted">Name</dt>
                <dd className="font-medium">{info.data.name}</dd>
              </div>
              <div>
                <dt className="text-muted">Root domain</dt>
                <dd className="font-medium">{info.data.rootDomain}</dd>
              </div>
              <div>
                <dt className="text-muted">Languages</dt>
                <dd className="font-medium">{info.data.locales.join(', ')}</dd>
              </div>
            </dl>
          )}
        </CardBody>
      </Card>
    </>
  );
}
