import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { AdminDomainsPage } from './AdminDomainsPage.jsx';
import { platformApi } from '../../services/api/platform.js';

vi.mock('../../services/api/platform.js', () => ({ platformApi: { domains: vi.fn() } }));

describe('AdminDomainsPage', () => {
  it('renders domains list with tenant information and status', async () => {
    platformApi.domains.mockResolvedValue({
      items: [
        {
          id: 'd1',
          tenantId: 't1',
          hostname: 'academy.lvh.me',
          type: 'SUBDOMAIN',
          isPrimary: true,
          status: 'VERIFIED',
          createdAt: new Date().toISOString(),
          tenant: { id: 't1', name: 'Tech Academy', slug: 'tech-academy' },
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1, pageCount: 1 },
    });

    const router = createMemoryRouter([{ path: '/super-admin/domains', element: <AdminDomainsPage /> }], {
      initialEntries: ['/super-admin/domains'],
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const matches = await screen.findAllByText('academy.lvh.me');
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tech Academy').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Primary').length).toBeGreaterThan(0);
  });
});
