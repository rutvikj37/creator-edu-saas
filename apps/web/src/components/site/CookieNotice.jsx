import { useState } from 'react';

const KEY = 'ce.cookie-notice.accepted';

/** Cookie notice for the academy website (Settings → User experience). Stays dismissed once accepted. */
export function CookieNotice({ enabled, color }) {
  const [accepted, setAccepted] = useState(() => {
    try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; }
  });
  if (!enabled || accepted) return null;
  const accept = () => { try { window.localStorage.setItem(KEY, '1'); } catch { /* storage blocked: hide for this visit */ } setAccepted(true); };
  return (
    <div role="region" aria-label="Cookie notice" className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-3xl flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-lg sm:flex-row sm:items-center">
      <p className="flex-1 text-sm text-fg-2">We use cookies to keep you signed in, remember your preferences and understand how our website is used.</p>
      <button type="button" onClick={accept} className="h-9 shrink-0 rounded-md px-4 text-sm font-medium text-white" style={{ background: color ?? '#4f46e5' }}>Accept</button>
    </div>
  );
}

/** Where to send a logged-out visitor who needs an account: the academy's default form (sign up or log in). */
export function accountPath(site, next) {
  const base = site?.defaultForm === 'login' || site?.acceptingRegistrations === false ? '/login' : '/register';
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}
