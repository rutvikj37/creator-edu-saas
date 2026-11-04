import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../auth/Alert.jsx';
import { commonApi } from '../../services/api/platform.js';
import { prefs } from '../../utils/storage.js';

/** Platform announcements for the signed-in user; dismissals are remembered per browser. */
export function AnnouncementsBanner() {
  const q = useQuery({ queryKey: ['announcements', 'active'], queryFn: commonApi.activeAnnouncements, staleTime: 5 * 60_000 });
  const [dismissed, setDismissed] = useState(() => prefs.get('dismissedAnnouncements', []));
  const visible = (q.data ?? []).filter((a) => !dismissed.includes(a.id));
  if (!visible.length) return null;
  const dismiss = (id) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    prefs.set('dismissedAnnouncements', next);
  };
  return (
    <div className="mb-6 space-y-3">
      {visible.map((a) => (
        <Alert key={a.id} tone={a.tone === 'warning' ? 'error' : a.tone === 'success' ? 'success' : 'info'} title={a.title}
          action={<button type="button" aria-label="Dismiss" onClick={() => dismiss(a.id)} className="opacity-70 hover:opacity-100"><X className="size-4" /></button>}>
          <span className="whitespace-pre-line">{a.body}</span>
        </Alert>
      ))}
    </div>
  );
}
