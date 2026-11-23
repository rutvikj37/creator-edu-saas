import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CreatorsPage } from './CreatorsPage.jsx';
import { platformApi } from '../../services/api/platform.js';

vi.mock('../../services/api/platform.js', () => ({ platformApi: { creators: vi.fn() } }));

describe('CreatorsPage', () => {
  it('renders creators list with academies and status', async () => {
    platformApi.creators.mockResolvedValue({
      items: [
        {
          id: 'u1',
          fullName: 'Jane Creator',
          email: 'jane@example.com',
          phone: '+1 555-0100',
          status: 'ACTIVE',
          role: 'CREATOR',
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
          academies: [{ id: 't1', name: 'Design Academy', slug: 'design-academy', role: 'OWNER' }],
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1, pageCount: 1 },
    });

    const router = createMemoryRouter([{ path: '/super-admin/creators', element: <CreatorsPage /> }], {
      initialEntries: ['/super-admin/creators'],
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const names = await screen.findAllByText('Jane Creator');
    expect(names.length).toBeGreaterThan(0);
    expect(screen.getAllByText('jane@example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Design Academy').length).toBeGreaterThan(0);
  });
});
