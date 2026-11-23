import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { PlatformAnalyticsPage } from './PlatformAnalyticsPage.jsx';
import { platformApi } from '../../services/api/platform.js';

vi.mock('../../services/api/platform.js', () => ({
  platformApi: {
    dashboard: vi.fn(),
  },
}));

describe('PlatformAnalyticsPage', () => {
  it('renders platform metrics and stat cards', async () => {
    platformApi.dashboard.mockResolvedValue({
      tenants: { total: 12, byStatus: { ACTIVE: 10, ONBOARDING: 2 } },
      users: { creators: 12, students: 340 },
      subscriptions: {
        mrr: { INR: 45000, USD: 600 },
        planDistribution: [{ planId: 'p1', name: 'Growth', count: 8 }],
      },
      series: {
        newTenants: [{ date: '2026-11-20', count: 2 }],
        newStudents: [{ date: '2026-11-20', count: 15 }],
      },
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PlatformAnalyticsPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Total Academies')).toBeInTheDocument();
    expect(screen.getByText('Platform MRR (INR)')).toBeInTheDocument();
    expect(screen.getByText('Total Students')).toBeInTheDocument();
    expect(screen.getByText('Growth')).toBeInTheDocument();
  });
});
