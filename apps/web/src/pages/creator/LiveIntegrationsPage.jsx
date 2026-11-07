import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Video } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SettingsTabs } from '../../components/layout/SettingsTabs.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, CardBody, ErrorState, Skeleton, toast } from '../../components/ui/index.js';
import { creatorLiveApi } from '../../services/api/live.js';
import { useAuth } from '../../context/AuthContext.jsx';

const CARDS = [
  { key: 'zoom', path: 'zoom', name: 'Zoom', what: 'Each session gets its own Zoom meeting in your account, created and updated automatically. Students get personal join links, so attendance is recorded per student, and cloud recordings are added to your video library.', note: 'Personal links and cloud recording need a paid Zoom plan; on a free plan everyone uses the meeting link.' },
  { key: 'googleMeet', path: 'google-meet', name: 'Google Meet', what: 'Each session gets a Google Calendar event with a Meet link in your calendar (no invitations are sent). Students join with the link from your academy.', note: 'Meet does not report attendance to apps on personal Google accounts, so joins are recorded as clicks.' },
];

/** Creator: connect the academy's own Zoom and Google accounts. */
export function LiveIntegrationsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['creator', 'live', 'integrations'], queryFn: creatorLiveApi.integrations });
  useEffect(() => {
    if (params.get('connected')) toast.success(`${params.get('connected') === 'zoom' ? 'Zoom' : 'Google'} connected`);
    if (params.get('error')) toast.error(params.get('error'));
    if (params.get('connected') || params.get('error')) setParams({}, { replace: true });
  }, [params, setParams]);
  const connect = useMutation({ mutationFn: creatorLiveApi.connectIntegration, onSuccess: (r) => window.location.assign(r.url), onError: (e) => toast.error(e.message) });
  const disconnect = useMutation({ mutationFn: creatorLiveApi.disconnectIntegration, onSuccess: (d) => { qc.setQueryData(['creator', 'live', 'integrations'], d); qc.invalidateQueries({ queryKey: ['creator', 'live', 'providers'] }); toast.success('Disconnected'); }, onError: (e) => toast.error(e.message) });
  const manage = can('integrations.manage');
  return (
    <>
      <PageHeader title="Live integrations" description="Run live classes and webinars on your own Zoom or Google Meet account." breadcrumbs={[{ label: 'Integrations' }]} /><SettingsTabs />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : !q.data ? <Skeleton className="h-64" /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {CARDS.map((c) => {
            const s = q.data[c.key];
            return (
              <Card key={c.key}>
                <CardBody className="space-y-3">
                  <div className="flex items-center gap-2"><Video className="size-5 text-muted" /><h2 className="text-lg font-semibold">{c.name}</h2>
                    {s.connected ? <Badge tone="success">Connected</Badge> : s.status === 'ERROR' || s.status === 'REVOKED' ? <Badge tone="danger">Needs attention</Badge> : <Badge>Not connected</Badge>}
                  </div>
                  <p className="text-sm text-fg-2">{c.what}</p>
                  <p className="text-xs text-muted">{c.note}</p>
                  {s.accountEmail && <p className="text-sm">Account: <span className="font-medium">{s.accountEmail}</span></p>}
                  {s.lastError && <Alert tone="warning">{s.lastError}</Alert>}
                  {!s.available ? <Alert tone="info">{c.name} is not set up on this platform yet.</Alert> : manage && (
                    <div className="flex gap-2">
                      <Button loading={connect.isPending && connect.variables === c.path} onClick={() => connect.mutate(c.path)}>{s.status ? `Reconnect ${c.name}` : `Connect ${c.name}`}</Button>
                      {s.status && <Button variant="ghost" loading={disconnect.isPending && disconnect.variables === c.path} onClick={() => disconnect.mutate(c.path)}>Disconnect</Button>}
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
