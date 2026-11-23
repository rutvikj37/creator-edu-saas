import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { FinanceLayout, SupportLayout } from './PanelLayouts.jsx';

const authState = { current: null };
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => authState.current }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { name: 'Creator Education' } }) }));
vi.mock('../components/layout/NotificationBell.jsx', () => ({ NotificationBell: () => null }));
vi.mock('../components/layout/DashboardShell.jsx', () => ({
  DashboardShell: ({ brand, nav }) => (
    <div>
      <p>panel:{brand.subtitle}</p>
      <ul>{nav.flatMap((g) => g.items).map((i) => <li key={i.to}>{i.label}</li>)}</ul>
    </div>
  ),
}));

const signedIn = (roles) => ({ user: { fullName: 'A', email: 'a@x.io' }, me: { platformRoles: roles }, can: () => true });

function renderLayout(Layout) {
  render(<MemoryRouter><Layout /></MemoryRouter>);
}

describe('Finance and Support panels', () => {
  it.each([['SUPER_ADMIN', 'Super Admin'], ['PLATFORM_ADMIN', 'Platform Admin']])('%s keeps the full admin sidebar on finance and support pages', (role, subtitle) => {
    authState.current = signedIn([role]);
    renderLayout(FinanceLayout);
    expect(screen.getByText(`panel:${subtitle}`)).toBeInTheDocument();
    expect(screen.getByText('All tenants')).toBeInTheDocument();
    expect(screen.getByText('Tax reports')).toBeInTheDocument();
  });

  it('a Finance Admin gets the focused finance panel', () => {
    authState.current = signedIn(['FINANCE_ADMIN']);
    renderLayout(FinanceLayout);
    expect(screen.getByText('panel:Finance')).toBeInTheDocument();
    expect(screen.queryByText('All tenants')).not.toBeInTheDocument();
  });

  it('a Support Admin gets the focused support panel; a Super Admin does not', () => {
    authState.current = signedIn(['SUPPORT_ADMIN']);
    renderLayout(SupportLayout);
    expect(screen.getByText('panel:Support')).toBeInTheDocument();
    authState.current = signedIn(['SUPER_ADMIN']);
    renderLayout(SupportLayout);
    expect(screen.getByText('panel:Super Admin')).toBeInTheDocument();
  });
});
