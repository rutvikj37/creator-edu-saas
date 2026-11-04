import { DashboardShell } from '../components/layout/DashboardShell.jsx';
import { NAV } from './navigation.js';

/**
 * One layout per panel, all sharing DashboardShell. Phase 2 passes the authenticated
 * user and sign-out handler from AuthContext; until then the shell shows no account menu.
 */
export function SuperAdminLayout(props) {
  return <DashboardShell nav={NAV.superAdmin} brand={{ key: 'super-admin', mark: 'CE', name: 'Creator Education', subtitle: 'Super Admin' }} {...props} />;
}
export function FinanceLayout(props) {
  return <DashboardShell nav={NAV.finance} brand={{ key: 'finance', mark: 'CE', name: 'Creator Education', subtitle: 'Finance' }} {...props} />;
}
export function SupportLayout(props) {
  return <DashboardShell nav={NAV.support} brand={{ key: 'support', mark: 'CE', name: 'Creator Education', subtitle: 'Support' }} {...props} />;
}
export function CreatorLayout({ academyName = 'Your academy', ...props }) {
  return <DashboardShell nav={NAV.creator} brand={{ key: 'creator', mark: academyName.slice(0, 2).toUpperCase(), name: academyName, subtitle: 'Creator workspace' }} {...props} />;
}
export function StudentLayout({ academyName = 'Academy', ...props }) {
  return <DashboardShell nav={NAV.student} brand={{ key: 'student', mark: academyName.slice(0, 2).toUpperCase(), name: academyName, subtitle: 'Student' }} {...props} />;
}
export function AffiliateLayout({ academyName = 'Academy', ...props }) {
  return <DashboardShell nav={NAV.affiliate} brand={{ key: 'affiliate', mark: academyName.slice(0, 2).toUpperCase(), name: academyName, subtitle: 'Affiliate' }} {...props} />;
}
