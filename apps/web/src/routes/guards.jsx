import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner } from '../components/ui/index.js';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';

export function landingPath(me, surface) {
  if (!me) return '/login';
  if (me.mfaSetupRequired) return '/setup-2fa';
  if (surface === 'academy') return '/learn';
  const roles = me.platformRoles ?? [];
  if (roles.includes('SUPER_ADMIN') || roles.includes('PLATFORM_ADMIN')) return '/super-admin';
  if (roles.includes('FINANCE_ADMIN')) return '/finance';
  if (roles.includes('SUPPORT_ADMIN')) return '/support';
  return me.activeTenantId ? '/creator' : '/account/security';
}

function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner label="Loading your session" />
    </div>
  );
}

/** Renders children only on the given surface (platform vs academy host). */
export function SurfaceOnly({ surface }) {
  const auth = useAuth();
  return auth.surface === surface ? <Outlet /> : <NotFoundPage />;
}

/** Requires a signed-in user; optionally an admin or a creator workspace. */
export function RequireAuth({ admin = false, workspace = false, allowMfaSetup = false }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <FullPageSpinner />;
  if (auth.status !== 'authenticated') {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  if (auth.me.mfaSetupRequired && !allowMfaSetup) return <Navigate to="/setup-2fa" replace />;
  if (admin && !auth.isAdmin) return <Navigate to={landingPath(auth.me, auth.surface)} replace />;
  if (workspace && !auth.me.activeTenantId) return <Navigate to={landingPath(auth.me, auth.surface)} replace />;
  return <Outlet />;
}

/** Sign-in/sign-up pages: bounce signed-in users to their home. */
/** Only same-site relative paths are accepted as post-sign-in destinations (no open redirects). */
export function safeNextPath(next) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

export function GuestOnly() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <FullPageSpinner />;
  if (auth.status === 'authenticated') {
    const next = safeNextPath(new URLSearchParams(location.search).get('next'));
    return <Navigate to={auth.me?.mfaSetupRequired ? '/setup-2fa' : next ?? landingPath(auth.me, auth.surface)} replace />;
  }
  return <Outlet />;
}
