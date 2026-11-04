import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown } from 'lucide-react';
import { DashboardShell } from '../components/layout/DashboardShell.jsx';
import { Dropdown, DropdownItem, toast } from '../components/ui/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { academyApi } from '../services/api/auth.js';
import { NAV } from './navigation.js';

/** Signed-in user + sign-out wiring shared by every panel layout. */
function useShellAccount(profileTo) {
  const auth = useAuth();
  const navigate = useNavigate();
  return {
    user: auth.user ? { name: auth.user.fullName, email: auth.user.email, profileTo } : null,
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

export function SuperAdminLayout(props) {
  const account = useShellAccount('/super-admin/account/security');
  return <DashboardShell nav={NAV.superAdmin} brand={{ key: 'super-admin', mark: 'CE', name: 'Creator Education', subtitle: 'Super Admin' }} {...account} {...props} />;
}
export function FinanceLayout(props) {
  return <DashboardShell nav={NAV.finance} brand={{ key: 'finance', mark: 'CE', name: 'Creator Education', subtitle: 'Finance' }} {...props} />;
}
export function SupportLayout(props) {
  return <DashboardShell nav={NAV.support} brand={{ key: 'support', mark: 'CE', name: 'Creator Education', subtitle: 'Support' }} {...props} />;
}
export function CreatorLayout({ preview = false, ...props }) {
  const auth = useAuth();
  const account = useShellAccount('/creator/account/security');
  const name = auth.activeTenant?.name ?? 'Your academy';
  return (
    <DashboardShell
      nav={NAV.creator}
      brand={{ key: 'creator', mark: name.slice(0, 2).toUpperCase(), name, subtitle: auth.activeTenant?.role?.name ?? 'Creator workspace' }}
      footer={preview ? undefined : <WorkspaceSwitcher />}
      {...(preview ? {} : account)}
      {...props}
    />
  );
}
export function StudentLayout({ preview = false, ...props }) {
  const account = useShellAccount('/learn/account/security');
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, enabled: !preview, staleTime: 5 * 60_000 });
  const name = site.data?.name ?? 'Academy';
  return <DashboardShell nav={NAV.student} brand={{ key: 'student', mark: name.slice(0, 2).toUpperCase(), name, subtitle: 'Student' }} {...(preview ? {} : account)} {...props} />;
}
export function AffiliateLayout(props) {
  return <DashboardShell nav={NAV.affiliate} brand={{ key: 'affiliate', mark: 'AF', name: 'Academy', subtitle: 'Affiliate' }} {...props} />;
}
