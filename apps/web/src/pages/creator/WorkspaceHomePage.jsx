import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, ExternalLink, Globe, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { EmailVerificationBanner } from '../../components/account/EmailVerificationBanner.jsx';
import { Card, CardBody, CardHeader, ErrorState, Skeleton, StatusBadge } from '../../components/ui/index.js';
import { workspaceApi } from '../../services/api/auth.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate } from '../../utils/format.js';

/** Workspace overview with live data. The full analytics dashboard arrives in Phase 4. */
export function WorkspaceHomePage() {
  const auth = useAuth();
  const ws = useQuery({ queryKey: ['workspace'], queryFn: workspaceApi.workspace });
  const steps = [
    { done: Boolean(auth.user?.emailVerifiedAt), label: 'Verify your email address', to: null },
    { done: Boolean(auth.user?.twoFactorEnabledAt), label: 'Turn on two-factor authentication', to: '/creator/account/security' },
    { done: false, label: 'Connect a custom domain (optional)', to: '/creator/domains' },
  ];
  const academyUrl = ws.data?.primaryHostname ? `${window.location.protocol}//${ws.data.primaryHostname}${window.location.port ? `:${window.location.port}` : ''}` : null;

  return (
    <>
      <PageHeader title={`Welcome, ${auth.user?.fullName?.split(' ')[0] ?? ''}`} description="Here's the state of your academy workspace." breadcrumbs={[{ label: 'Dashboard' }]} />
      <EmailVerificationBanner />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Your academy" />
          <CardBody>
            {ws.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : ws.isError ? (
              <ErrorState error={ws.error} onRetry={() => ws.refetch()} />
            ) : (
              <dl className="grid gap-5 text-sm sm:grid-cols-2">
                <div><dt className="text-muted">Name</dt><dd className="mt-0.5 font-medium">{ws.data.name}</dd></div>
                <div><dt className="text-muted">Status</dt><dd className="mt-1"><StatusBadge status={ws.data.status} /></dd></div>
                <div>
                  <dt className="text-muted">Academy address</dt>
                  <dd className="mt-0.5 font-medium">
                    {academyUrl ? (
                      <a href={academyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-600 hover:underline">
                        {ws.data.primaryHostname} <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    ) : '—'}
                  </dd>
                </div>
                <div><dt className="text-muted">Created</dt><dd className="mt-0.5 font-medium">{formatDate(ws.data.createdAt)}</dd></div>
                <div><dt className="text-muted">Currency</dt><dd className="mt-0.5 font-medium">{ws.data.defaultCurrency}</dd></div>
                <div><dt className="text-muted">Time zone</dt><dd className="mt-0.5 font-medium">{ws.data.timezone}</dd></div>
              </dl>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Getting started" description="Secure your account and set up your address." />
          <ul className="divide-y divide-line">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3 px-5 py-3.5 text-sm">
                {s.done ? <CheckCircle2 className="size-5 text-green-600" aria-label="Done" /> : <Circle className="size-5 text-line-strong" aria-label="To do" />}
                {s.to && !s.done ? <Link to={s.to} className="font-medium text-primary-600 hover:underline">{s.label}</Link> : <span className={s.done ? 'text-muted line-through' : ''}>{s.label}</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link to="/creator/domains" className="group">
          <Card className="flex items-center gap-4 p-5 transition-shadow group-hover:shadow-md">
            <Globe className="size-5 text-primary-600" aria-hidden />
            <div><p className="font-semibold">Domains</p><p className="text-sm text-muted">Use your own domain for your academy.</p></div>
          </Card>
        </Link>
        <Link to="/creator/account/security" className="group">
          <Card className="flex items-center gap-4 p-5 transition-shadow group-hover:shadow-md">
            <ShieldCheck className="size-5 text-primary-600" aria-hidden />
            <div><p className="font-semibold">Account security</p><p className="text-sm text-muted">Password, two-factor and devices.</p></div>
          </Card>
        </Link>
      </div>
    </>
  );
}
