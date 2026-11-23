import { render, screen, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { TenantsPage } from './TenantsPage.jsx';
import { platformApi } from '../../services/api/platform.js';

vi.mock('../../services/api/platform.js', () => ({
  platformApi: {
    plans: vi.fn(),
    tenants: vi.fn(),
    activateTenant: vi.fn(),
    suspendTenant: vi.fn(),
    deleteTenant: vi.fn(),
    updateTenant: vi.fn(),
  },
}));

describe('TenantsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformApi.plans.mockResolvedValue([]);
    platformApi.tenants.mockResolvedValue({
      items: [
        {
          id: 't-1',
          name: 'TechX Academy',
          slug: 'techx-academy',
          status: 'ACTIVE',
          country: 'IN',
          timezone: 'Asia/Kolkata',
          createdAt: new Date().toISOString(),
          studentCount: 42,
          owner: {
            id: 'u-1',
            fullName: 'Rutvik Joshi',
            email: 'rutvik@example.com',
            phone: '+91 9999999999',
          },
          subscription: {
            status: 'ACTIVE',
            plan: { id: 'p-1', name: 'Growth' },
          },
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1, pageCount: 1 },
    });
  });

  it('renders table with actions button and opens actions dropdown', async () => {
    const router = createMemoryRouter([{ path: '/super-admin/tenants', element: <TenantsPage /> }], {
      initialEntries: ['/super-admin/tenants'],
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const matches = await screen.findAllByText('TechX Academy');
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rutvik Joshi').length).toBeGreaterThan(0);

    // Verify Actions button exists
    const actionBtns = screen.getAllByLabelText('Actions for TechX Academy');
    expect(actionBtns.length).toBeGreaterThan(0);

    // Click Actions dropdown button
    fireEvent.click(actionBtns[0]);

    // Verify dropdown items
    expect(screen.getAllByText('View details').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Edit agency').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Change plan').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Suspend agency').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Delete agency').length).toBeGreaterThan(0);
  });

  it('opens delete confirmation modal when Delete agency is clicked', async () => {
    const router = createMemoryRouter([{ path: '/super-admin/tenants', element: <TenantsPage /> }], {
      initialEntries: ['/super-admin/tenants'],
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await screen.findAllByText('TechX Academy');

    // Click Actions dropdown
    const actionBtns = screen.getAllByLabelText('Actions for TechX Academy');
    fireEvent.click(actionBtns[0]);

    // Click Delete agency
    fireEvent.click(screen.getAllByText('Delete agency')[0]);

    // Confirm dialog should be open
    expect(screen.getByText('Delete TechX Academy?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schedule deletion' })).toBeInTheDocument();
  });
});
