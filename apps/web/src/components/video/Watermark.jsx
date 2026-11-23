import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { http } from '../../services/api/client.js';

const fetchWatermark = () => http.get('/learn/watermark').then((r) => r.data);

/**
 * Overlay with the learner's email/phone over videos and live classes (Settings → Security).
 * Static: faint text across the whole player. Dynamic: shows for N seconds every M seconds at a
 * random spot. Purely visual — it deters screen recording but can't prevent it.
 */
export function Watermark({ enabled = true }) {
  const q = useQuery({ queryKey: ['learn', 'watermark'], queryFn: fetchWatermark, enabled, staleTime: 5 * 60_000, retry: false });
  const w = q.data;
  const [spot, setSpot] = useState(null);
  useEffect(() => {
    if (w?.mode !== 'dynamic') return undefined;
    let hide;
    const show = () => {
      setSpot({ top: `${8 + Math.random() * 76}%`, left: `${4 + Math.random() * 60}%` });
      hide = setTimeout(() => setSpot(null), w.showForSec * 1000);
    };
    show();
    const t = setInterval(show, (w.showForSec + w.everySec) * 1000);
    return () => { clearInterval(t); clearTimeout(hide); };
  }, [w?.mode, w?.showForSec, w?.everySec]);
  if (!w || w.mode === 'off' || !w.text) return null;
  if (w.mode === 'static') {
    return (
      <div aria-hidden data-testid="watermark" className="pointer-events-none absolute inset-0 z-10 grid grid-cols-2 place-items-center overflow-hidden select-none sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => <span key={i} className="-rotate-[20deg] text-xs whitespace-nowrap text-white/25 [text-shadow:0_0_2px_rgba(0,0,0,.4)] sm:text-sm">{w.text}</span>)}
      </div>
    );
  }
  return spot ? (
    <span aria-hidden data-testid="watermark" style={spot} className="pointer-events-none absolute z-10 rounded bg-black/20 px-2 py-0.5 text-xs whitespace-nowrap text-white/70 select-none sm:text-sm">{w.text}</span>
  ) : null;
}
