import { NavLink, useLocation } from 'react-router';
import { useAuth } from '../../context/AuthContext.jsx';
import { cn } from '../../utils/cn.js';

const ITEMS = [
  { to: '/creator/academy', label: 'My academy', perm: 'academy.manage' },
  { to: '/creator/payments', label: 'Payments', perm: 'integrations.manage' },
  { to: '/creator/domains', label: 'Domains', perm: 'domains.manage' },
  { to: '/creator/integrations', label: 'Live integrations', perm: 'live.manage' },
  { to: '/creator/billing', label: 'Billing & usage', perm: 'billing.manage' },
  { to: '/creator/account/security', label: 'Account security' },
  { to: '/creator/account/notifications', label: 'Notifications' },
];

/**
 * Settings sub-navigation (Graphy keeps all settings under one area with a shared menu).
 * Renders only inside the creator workspace, so shared account pages stay clean elsewhere.
 */
export function SettingsTabs() {
  const { pathname } = useLocation();
  return pathname.startsWith('/creator') ? <CreatorSettingsTabs /> : null;
}

function CreatorSettingsTabs() {
  const auth = useAuth();
  const items = ITEMS.filter((i) => !i.perm || auth.can?.(i.perm));
  return (
    <nav aria-label="Settings" className="-mt-2 mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end
          className={({ isActive }) => cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors', isActive ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-muted hover:text-fg')}>
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}
