import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SettingsTabs } from '../../components/layout/SettingsTabs.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Card, CardBody, CardHeader, ErrorState, Skeleton, toast } from '../../components/ui/index.js';
import { notificationsApi } from '../../services/api/notifications.js';

const LABELS = {
  learning: ['Learning', 'Certificates, course updates, grading'],
  live: ['Live classes', 'Reminders before sessions start'],
  orders: ['Purchases', 'Payment confirmations and refunds (receipts are always emailed)'],
  community: ['Community', 'Replies and mentions'],
  marketing: ['Offers & news', 'Promotions from the academy (email offers need your consent)'],
};
const CHANNELS = [['email', 'Email'], ['push', 'Browser'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp']];

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function NotificationSettingsPage({ breadcrumbs = [] }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications', 'prefs'], queryFn: notificationsApi.preferences });
  const [pushBusy, setPushBusy] = useState(false);
  const save = useMutation({ mutationFn: notificationsApi.setPreferences, onSuccess: (d) => { qc.setQueryData(['notifications', 'prefs'], d); toast.success('Saved'); }, onError: (e) => toast.error(e.message) });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const p = q.data;
  const pushSupported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
  const enablePush = async () => {
    setPushBusy(true);
    try {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked in your browser settings.');
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(p.pushKey) });
      const json = sub.toJSON();
      await notificationsApi.subscribePush({ endpoint: json.endpoint, keys: json.keys });
      toast.success('Browser notifications enabled on this device');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setPushBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="Notifications" description="Choose how you hear about what matters to you." breadcrumbs={[...breadcrumbs, { label: 'Notifications' }]} /><SettingsTabs />
      {!p ? <Skeleton className="h-72" /> : (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Channels" description="In-app notifications are always on." />
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full min-w-[560px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-5 py-2 font-medium">Category</th>{CHANNELS.map(([k, l]) => <th key={k} className="px-3 py-2 text-center font-medium">{l}{k !== 'email' && !p.channels[k] && <span className="block font-normal">(not available)</span>}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {p.categories.map((c) => (
                    <tr key={c.category}>
                      <td className="px-5 py-3"><p className="font-medium">{LABELS[c.category][0]}</p><p className="text-xs text-muted">{LABELS[c.category][1]}</p></td>
                      {CHANNELS.map(([k, l]) => {
                        const unavailable = (k !== 'email' && !p.channels[k]) || (c.category === 'marketing' && k === 'email');
                        return (
                          <td key={k} className="px-3 py-3 text-center">
                            <input type="checkbox" className="size-4 accent-primary-600" aria-label={`${LABELS[c.category][0]} by ${l}`} checked={Boolean(c[k]) && !unavailable} disabled={unavailable || save.isPending}
                              onChange={(e) => save.mutate([{ category: c.category, [k]: e.target.checked }])} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
          {(p.channels.sms || p.channels.whatsapp) && !p.phoneVerified && <Alert tone="info">SMS and WhatsApp messages need a verified phone number on your account.</Alert>}
          {p.channels.push && p.pushKey && (
            <Card>
              <CardBody className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3"><BellRing className="size-5 text-muted" /><div><p className="font-medium">Browser notifications</p><p className="text-sm text-muted">Get alerts on this device even when the tab is closed.</p></div></div>
                <Button variant="secondary" loading={pushBusy} disabled={!pushSupported} onClick={enablePush}>{pushSupported ? 'Enable on this device' : 'Not supported in this browser'}</Button>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
