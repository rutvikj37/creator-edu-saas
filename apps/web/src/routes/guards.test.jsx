import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { AcademyCatalogLayout, RequireAuth, GuestOnly, landingPath, postLoginPath, safeNextPath } from './guards.jsx';

const authState = { current: null };
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => authState.current }));
vi.mock('../layouts/PanelLayouts.jsx', () => ({ StudentLayout: () => <p>student shell</p> }));

function renderAt(path, routes) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const routes = [
  { path: '/login', element: <p>login page</p> },
  { path: '/setup-2fa', element: <p>mfa setup</p> },
  { path: '/creator', element: <p>creator home</p> },
  { path: '/learn', element: <p>learn home</p> },
  { element: <RequireAuth admin />, children: [{ path: '/super-admin', element: <p>admin area</p> }] },
  { element: <RequireAuth workspace />, children: [{ path: '/creator/domains', element: <p>domains</p> }] },
  { element: <GuestOnly />, children: [{ path: '/signup', element: <p>signup</p> }] },
  { element: <RequireAuth student />, children: [{ path: '/learn/coaching', element: <p>my coaching</p> }] },
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

  it('lets admins in and redirects signed-in users away from sign-up', () => {
    authState.current = { status: 'authenticated', surface: 'platform', isAdmin: true, me: me({ platformRoles: ['SUPER_ADMIN'], activeTenantId: null }) };
    renderAt('/super-admin', routes);
    expect(screen.getByText('admin area')).toBeInTheDocument();
  });

  it('keeps agency staff out of the student app (its API is learner-only)', () => {
    authState.current = { status: 'authenticated', surface: 'academy', isAdmin: false, me: me() };
    renderAt('/learn/coaching', routes);
    expect(screen.getByText('creator home')).toBeInTheDocument();
  });

  it('lets learners into the student app', () => {
    authState.current = { status: 'authenticated', surface: 'academy', isAdmin: false, me: me({ realm: 'TENANT' }) };
    renderAt('/learn/coaching', routes);
    expect(screen.getByText('my coaching')).toBeInTheDocument();
  });

  it('keeps tenant learners out of the creator workspace', () => {
    authState.current = {
      status: 'authenticated',
      surface: 'academy',
      isAdmin: false,
      me: me({ realm: 'TENANT', activeTenantId: 't1' }),
    };
    renderAt('/creator/domains', routes);
    expect(screen.getByText('learn home')).toBeInTheDocument();
  });

  it('computes landing paths per surface and role', () => {
    expect(landingPath(me({ realm: 'TENANT', activeTenantId: null }), 'academy')).toBe('/learn');
    expect(landingPath(me({ realm: 'TENANT', activeTenantId: 't1' }), 'academy')).toBe('/learn');
    expect(landingPath(me({ realm: 'TENANT' }), 'platform')).toBe('/learn');
    expect(landingPath(me({ realm: 'TENANT' }), 'admin')).toBe('/account/security');
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

describe('AcademyCatalogLayout', () => {
  it('wraps signed-in users in the student shell and leaves guests on the catalogue page', () => {
    const child = [{ element: <AcademyCatalogLayout />, children: [{ path: '/courses', element: <p>catalogue</p> }] }];
    authState.current = { status: 'loading', surface: 'academy' };
    const loading = renderAt('/courses', child);
    expect(screen.getByText('Loading your session')).toBeInTheDocument();

    authState.current = { status: 'anonymous', surface: 'academy' };
    renderAt('/courses', child);
    expect(screen.getByText('catalogue')).toBeInTheDocument();
    expect(screen.queryByText('student shell')).toBeNull();

    authState.current = { status: 'authenticated', surface: 'academy', me: me({ realm: 'TENANT' }) };
    renderAt('/courses', child);
    expect(screen.getByText('student shell')).toBeInTheDocument();
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

describe('postLoginPath', () => {
  const student = { realm: 'TENANT', platformRoles: [], activeTenantId: 't1' };
  const agency = { realm: 'PLATFORM', platformRoles: [], activeTenantId: 't1' };
  it('drops a student-only next left by a previous session for agency staff', () => {
    expect(postLoginPath(agency, 'academy', '/learn/coaching')).toBe('/creator');
  });
  it('drops a creator next for a student', () => {
    expect(postLoginPath(student, 'academy', '/creator/courses')).toBe('/learn');
  });
  it('keeps a next that fits the user', () => {
    expect(postLoginPath(student, 'academy', '/learn/coaching')).toBe('/learn/coaching');
    expect(postLoginPath(agency, 'academy', '/creator/courses?tab=x')).toBe('/creator/courses?tab=x');
    expect(postLoginPath(agency, 'academy', '/courses/foo')).toBe('/courses/foo');
  });
  it('rejects open redirects', () => {
    expect(postLoginPath(student, 'academy', '//evil.com')).toBe('/learn');
  });
});
