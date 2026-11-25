import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { RequireAuth, GuestOnly, landingPath, safeNextPath } from './guards.jsx';

const authState = { current: null };
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => authState.current }));

function renderAt(path, routes) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const routes = [
  { path: '/login', element: <p>login page</p> },
  { path: '/setup-2fa', element: <p>mfa setup</p> },
  { path: '/creator', element: <p>creator home</p> },
  { element: <RequireAuth admin />, children: [{ path: '/super-admin', element: <p>admin area</p> }] },
  { element: <RequireAuth workspace />, children: [{ path: '/creator/domains', element: <p>domains</p> }] },
  { element: <GuestOnly />, children: [{ path: '/signup', element: <p>signup</p> }] },
];

const me = (over = {}) => ({ realm: 'PLATFORM', platformRoles: [], activeTenantId: 't1', mfaSetupRequired: false, ...over });

describe('route guards', () => {
  it('sends anonymous users to login with a return path', () => {
    authState.current = { status: 'anonymous', surface: 'platform' };
    const router = renderAt('/creator/domains?tab=1', routes);
    expect(screen.getByText('login page')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?next=%2Fcreator%2Fdomains%3Ftab%3D1');
  });

  it('keeps creators out of the admin area', () => {
    authState.current = { status: 'authenticated', surface: 'platform', isAdmin: false, me: me() };
    renderAt('/super-admin', routes);
    expect(screen.getByText('creator home')).toBeInTheDocument();
  });

  it('forces pending admins to enrol in two-factor first', () => {
    authState.current = { status: 'authenticated', surface: 'platform', isAdmin: true, me: me({ platformRoles: ['SUPER_ADMIN'], mfaSetupRequired: true }) };
    renderAt('/super-admin', routes);
    expect(screen.getByText('mfa setup')).toBeInTheDocument();
  });

  it('lets admins in and redirects signed-in users away from sign-up', () => {
    authState.current = { status: 'authenticated', surface: 'platform', isAdmin: true, me: me({ platformRoles: ['SUPER_ADMIN'], activeTenantId: null }) };
    renderAt('/super-admin', routes);
    expect(screen.getByText('admin area')).toBeInTheDocument();
  });

  it('computes landing paths per surface and role', () => {
    expect(landingPath(me({ realm: 'TENANT', activeTenantId: null }), 'academy')).toBe('/learn');
    expect(landingPath(me({ realm: 'PLATFORM', platformRoles: [] }), 'academy')).toBe('/creator');
    expect(landingPath(me({ platformRoles: ['FINANCE_ADMIN'] }), 'platform')).toBe('/finance');
    expect(landingPath(me({ platformRoles: ['SUPPORT_ADMIN'] }), 'platform')).toBe('/support');
    expect(landingPath(me({ platformRoles: ['PLATFORM_ADMIN'] }), 'platform')).toBe('/super-admin');
    expect(landingPath(me({ platformRoles: ['SUPER_ADMIN'] }), 'admin')).toBe('/super-admin');
    expect(landingPath(me({ realm: 'PLATFORM' }), 'platform')).toBe('/creator');
    expect(landingPath(me({ realm: 'PLATFORM', activeTenantId: null, platformRoles: [] }), 'admin')).toBe('/account/security');
    expect(landingPath(null, 'platform')).toBe('/login');
  });
});

describe('GuestOnly', () => {
  it('sends signed-in users to a safe ?next destination', () => {
    authState.current = { status: 'authenticated', surface: 'academy', me: me() };
    const router = renderAt('/signup?next=%2Fcourses%2Fsql', [...routes, { path: '/courses/sql', element: <p>course page</p> }]);
    expect(screen.getByText('course page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/courses/sql');
  });
  it('rejects open redirects', () => {
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('https://evil.example')).toBeNull();
    expect(safeNextPath('/learn')).toBe('/learn');
  });
});
