import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner } from '../components/ui/index.js';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';
import { StudentLayout } from '../layouts/PanelLayouts.jsx';

export function landingPath(me, surface) {
  if (!me) return '/login';
  const roles = me.platformRoles ?? [];
  if (roles.includes('SUPER_ADMIN') || roles.includes('PLATFORM_ADMIN')) {
    // Super Admin console only on the dedicated admin / platform hosts.
    if (surface !== 'academy') return '/super-admin';
  }
  if (surface !== 'academy') {
    if (roles.includes('FINANCE_ADMIN')) return '/finance';
    if (roles.includes('SUPPORT_ADMIN')) return '/support';
  }
  // Dedicated Super Admin host: no agency panel here — stay on security.
  if (surface === 'admin') return '/account/security';
  // Learners land in /learn on academy and platform hosts (platform bridge for TechX LMS).
  // Dedicated Super Admin host has no student UI.
  if (me.realm === 'TENANT') return surface === 'admin' ? '/account/security' : '/learn';
  // Agency staff signing in on their academy domain (or platform host) land in the creator panel.
  if (me.realm === 'PLATFORM' && me.activeTenantId) return '/creator';
  // Platform accounts can't use the student app (its API is learner-only): academy home instead.
  if (surface === 'academy') return '/';
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

/** Requires a signed-in user; optionally an admin, a creator workspace, or a learner (TENANT realm). */
export function RequireAuth({ admin = false, workspace = false, student = false }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <FullPageSpinner />;
  if (auth.status !== 'authenticated') {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  if (admin && !auth.isAdmin) return <Navigate to={landingPath(auth.me, auth.surface)} replace />;
  const hasWorkspace =
    auth.me.realm === 'PLATFORM' && Boolean(auth.me.activeTenantId);
  if (workspace && !hasWorkspace) return <Navigate to={landingPath(auth.me, auth.surface)} replace />;
  // Student pages call learner-only APIs that answer 403 for agency/platform accounts.
  if (student && auth.me.realm !== 'TENANT') return <Navigate to={landingPath(auth.me, auth.surface)} replace />;
  return <Outlet />;
}

/** Sign-in/sign-up pages: bounce signed-in users to their home. */
/** Only same-site relative paths are accepted as post-sign-in destinations (no open redirects). */
export function safeNextPath(next) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

const STUDENT_PREFIXES = ['/learn', '/checkout', '/cart', '/courses', '/memberships', '/bundles', '/products', '/coaching', '/webinars', '/pay'];
const WORKSPACE_PREFIXES = ['/creator'];
const STAFF_PREFIXES = ['/super-admin', '/finance', '/support'];
const under = (path, prefixes) => prefixes.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));

/**
 * Post-sign-in destination: honour `next` only when it belongs to the signed-in
 * user's realm. A `next` left behind by a previous session (e.g. a student signs
 * out on /learn/coaching, then agency staff sign in) would otherwise open a page
 * whose API rejects this user with 403.
 */
export function postLoginPath(me, surface, next) {
  const path = safeNextPath(next);
  const home = landingPath(me, surface);
  if (!path || !me) return home;
  const isStudent = me.realm === 'TENANT';
  const hasWorkspace = me.realm === 'PLATFORM' && Boolean(me.activeTenantId);
  if (under(path, STUDENT_PREFIXES) && !isStudent) return home;
  if (under(path, WORKSPACE_PREFIXES) && !hasWorkspace) return home;
  if (under(path, STAFF_PREFIXES) && me.realm !== 'PLATFORM') return home;
  // On the platform LMS host, learners only belong in /learn (and cart/checkout) —
  // ignore leftover ?next=/ or marketing paths from a prior guest session.
  if (isStudent && surface === 'platform' && !under(path, STUDENT_PREFIXES)) return home;
  return path;
}

export function GuestOnly() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <FullPageSpinner />;
  if (auth.status === 'authenticated') {
    return <Navigate to={postLoginPath(auth.me, auth.surface, new URLSearchParams(location.search).get('next'))} replace />;
  }
  return <Outlet />;
}

/** Signed-in learners keep the student shell on public catalogue URLs (`/courses`, `/memberships`). */
export function AcademyCatalogLayout() {
  const auth = useAuth();
  if (auth.status === 'loading') return <FullPageSpinner />;
  if (auth.status === 'authenticated' && auth.me?.realm === 'TENANT') return <StudentLayout />;
  return <Outlet />;
}
