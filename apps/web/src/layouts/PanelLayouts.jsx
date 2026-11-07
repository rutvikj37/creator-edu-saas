import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown } from 'lucide-react';
import { NotificationBell } from '../components/layout/NotificationBell.jsx';
import { DashboardShell } from '../components/layout/DashboardShell.jsx';
import { Dropdown, DropdownItem, toast } from '../components/ui/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { academyApi } from '../services/api/auth.js';
import { NAV, filterNav } from './navigation.js';
import { AnnouncementsBanner } from '../components/common/AnnouncementsBanner.jsx';

/** Signed-in user + sign-out wiring shared by every panel layout. */
function useShellAccount(profileTo) {
  const auth = useAuth();
  const navigate = useNavigate();
  return {
    user: auth.user ? { name: auth.user.fullName, email: auth.user.email, profileTo } : null,
    notificationsSlot: auth.user ? <NotificationBell settingsTo={profileTo.replace(/security$/, 'notifications')} /> : undefined,
    onSignOut: async () => {
      await auth.logout();
      navigate('/login', { replace: true });
    },
  };
}

function WorkspaceSwitcher() {
  const auth = useAuth();
  const navigate = useNavigate();
  const memberships = auth.me?.memberships ?? [];
  if (memberships.length < 2) return null;
  return (
    <Dropdown
      align="left"
      className="w-full"
      panelClassName="bottom-full mb-2 mt-0 w-full"
      trigger={(p) => (
        <button type="button" className="flex w-full items-center justify-between rounded-md border border-line px-2.5 py-2 text-left text-sm hover:bg-surface-2" {...p}>
          <span className="truncate">{auth.activeTenant?.name ?? 'Select workspace'}</span>
          <ChevronsUpDown className="size-4 text-muted" aria-hidden />
        </button>
      )}
    >
      {memberships.map((m) => (
        <DropdownItem
          key={m.id}
          onClick={async () => {
            try {
              await auth.switchTenant(m.id);
              navigate('/creator');
            } catch (e) {
              toast.error(e.message);
            }
          }}
        >
          <span className={m.id === auth.me.activeTenantId ? 'font-semibold text-fg' : ''}>{m.name}</span>
          <span className="ml-auto text-xs text-muted">{m.role.name}</span>
        </DropdownItem>
      ))}
    </Dropdown>
  );
}

function usePlatformBrand(subtitle, key) {
  const info = useQuery({ queryKey: ['system', 'info'], queryFn: () => import('../services/api/system.js').then((m) => m.systemApi.info()), staleTime: 5 * 60_000 });
  const name = info.data?.name ?? 'Platform';
  return { key, mark: name.slice(0, 2).toUpperCase(), name, subtitle };
}

export function SuperAdminLayout(props) {
  const auth = useAuth();
  const account = useShellAccount('/super-admin/account/security');
  const roles = auth.me?.platformRoles ?? [];
  const subtitle = roles.includes('SUPER_ADMIN') ? 'Super Admin' : 'Platform Admin';
  return <DashboardShell nav={filterNav(NAV.superAdmin, auth.can)} brand={usePlatformBrand(subtitle, 'super-admin')} {...account} {...props} />;
}
export function FinanceLayout(props) {
  const auth = useAuth();
  const account = useShellAccount('/super-admin/account/security');
  return <DashboardShell nav={filterNav(NAV.finance, auth.can)} brand={usePlatformBrand('Finance', 'finance')} {...account} {...props} />;
}
export function SupportLayout(props) {
  const auth = useAuth();
  const account = useShellAccount('/super-admin/account/security');
  return <DashboardShell nav={filterNav(NAV.support, auth.can)} brand={usePlatformBrand('Support', 'support')} {...account} {...props} />;
}
export function CreatorLayout({ preview = false, ...props }) {
  const auth = useAuth();
  const account = useShellAccount('/creator/account/security');
  const name = auth.activeTenant?.name ?? 'Your academy';
  return (
    <DashboardShell
      nav={preview ? NAV.creator : filterNav(NAV.creator, auth.can)}
      banner={preview ? undefined : <AnnouncementsBanner />}
      brand={{ key: 'creator', mark: name.slice(0, 2).toUpperCase(), name, subtitle: auth.activeTenant?.role?.name ?? 'Creator workspace' }}
      footer={preview ? undefined : <WorkspaceSwitcher />}
      defaultCollapsed
      {...(preview ? {} : account)}
      {...props}
    />
  );
}
export function StudentLayout({ preview = false, ...props }) {
  const account = useShellAccount('/learn/account/security');
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, enabled: !preview, staleTime: 5 * 60_000 });
  const name = site.data?.name ?? 'Academy';
  return <DashboardShell nav={NAV.student} brand={{ key: 'student', mark: name.slice(0, 2).toUpperCase(), name, subtitle: 'Student' }} banner={preview ? undefined : <AnnouncementsBanner />} {...(preview ? {} : account)} {...props} />;
}
export function AffiliateLayout(props) {
  return <DashboardShell nav={NAV.affiliate} brand={{ key: 'affiliate', mark: 'AF', name: 'Academy', subtitle: 'Affiliate' }} {...props} />;
}
