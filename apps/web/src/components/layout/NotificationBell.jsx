import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown, EmptyState } from '../ui/index.js';
import { notificationsApi } from '../../services/api/notifications.js';
import { formatDate } from '../../utils/format.js';

/** Top-bar bell with the signed-in user's notifications (refreshes every minute). */
export function NotificationBell({ settingsTo }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => notificationsApi.list(), refetchInterval: 60_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: notificationsApi.read, onSuccess: refresh });
  const readAll = useMutation({ mutationFn: notificationsApi.readAll, onSuccess: refresh });
  const items = q.data?.items ?? [];
  const unread = q.data?.unread ?? 0;
  return (
    <Dropdown
      panelClassName="w-80 p-0"
      trigger={(p) => (
        <Button variant="ghost" size="icon-sm" aria-label={unread ? `${t('shell.notifications')} (${unread} unread)` : t('shell.notifications')} className="relative" {...p}>
          <Bell className="size-4" />
          {unread > 0 && <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white">{unread > 9 ? '9+' : unread}</span>}
        </Button>
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-sm font-semibold">{t('shell.notifications')}</span>
        <span className="flex items-center gap-1">
          {unread > 0 && <Button variant="link" size="sm" onClick={() => readAll.mutate()}>Mark all read</Button>}
          {settingsTo && <Link to={settingsTo} aria-label="Notification settings" className="rounded p-1 text-muted hover:bg-surface-2"><Settings className="size-4" /></Link>}
        </span>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Bell} title={t('shell.noNotifications')} description={t('shell.noNotificationsHint')} className="py-8" />
      ) : (
        <ul className="max-h-96 divide-y divide-line overflow-y-auto">
          {items.map((n) => (
            <li key={n.id}>
              <button type="button" className={`block w-full px-4 py-3 text-left text-sm hover:bg-surface-2 ${n.readAt ? '' : 'bg-primary-50/60 dark:bg-primary-950/30'}`}
                onClick={() => { if (!n.readAt) read.mutate(n.id); if (n.link) navigate(n.link); }}>
                <p className="flex items-start justify-between gap-2 font-medium">{n.title}{!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary-600" aria-label="Unread" />}</p>
                <p className="text-muted">{n.body}</p>
                <p className="mt-1 text-xs text-muted">{formatDate(n.createdAt, { withTime: true })}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dropdown>
  );
}
