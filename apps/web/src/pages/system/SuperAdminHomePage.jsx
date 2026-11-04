import { Link } from 'react-router';
import { HeartPulse, KeyRound } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Card } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';

/** Admin landing until the analytics dashboard ships in Phase 3. */
export function SuperAdminHomePage() {
  const auth = useAuth();
  const links = [
    { to: '/super-admin/status', title: 'System status', text: 'Database, cache and queue health.', icon: HeartPulse },
    { to: '/super-admin/account/security', title: 'Account security', text: 'Two-factor, password and devices.', icon: KeyRound },
  ];
  return (
    <>
      <PageHeader title={`Welcome, ${auth.user?.fullName ?? ''}`} description={`Signed in as ${(auth.me?.platformRoles ?? []).join(', ').replace(/_/g, ' ').toLowerCase()}.`} breadcrumbs={[{ label: 'Dashboard' }]} />
      <div className="grid gap-4 sm:grid-cols-2">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="group">
            <Card className="flex items-center gap-4 p-5 transition-shadow group-hover:shadow-md">
              <l.icon className="size-5 text-primary-600" aria-hidden />
              <div><p className="font-semibold">{l.title}</p><p className="text-sm text-muted">{l.text}</p></div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
