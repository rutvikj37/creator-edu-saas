import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { planSchema } from './PlanEditorPage.jsx';
import { AdminDashboardPage } from './AdminDashboardPage.jsx';
import { filterNav, NAV } from '../../layouts/navigation.js';
import { platformApi } from '../../services/api/platform.js';

vi.mock('../../services/api/platform.js', () => ({ platformApi: { dashboard: vi.fn() } }));

describe('plan schema', () => {
  const base = { code: 'growth', name: 'Growth', status: 'ACTIVE', isPublic: true, isDefault: false, trialDays: 0, sortOrder: 1, prices: [{ interval: 'MONTH', currency: 'INR', amount: 2999 }] };
  it('accepts a valid plan and rejects bad codes / currencies', () => {
    expect(planSchema.safeParse(base).success).toBe(true);
    expect(planSchema.safeParse({ ...base, code: 'Growth Plan' }).success).toBe(false);
    expect(planSchema.safeParse({ ...base, prices: [{ interval: 'MONTH', currency: 'rupee', amount: 1 }] }).success).toBe(false);
  });
});

describe('filterNav', () => {
  it('hides items without permission and drops empty groups', () => {
    const nav = filterNav(NAV.superAdmin, (p) => p === 'platform.support.manage');
    const labels = nav.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain('Tickets');
    expect(labels).not.toContain('Plans');
    expect(labels).not.toContain('Settings');
  });
});

describe('AdminDashboardPage', () => {
  it('renders API metrics, MRR per currency and the commerce notice', async () => {
    platformApi.dashboard.mockResolvedValue({
      tenants: { total: 12, active: 9, onboarding: 2, suspended: 1, pendingDeletion: 0 },
      creators: 11, students: 340,
      subscriptions: { byStatus: { ACTIVE: 4, TRIALING: 6 }, active: 10, expiringIn7Days: 2, failed: 0, mrr: [{ currency: 'INR', amount: 11996 }], arr: [{ currency: 'INR', amount: 143952 }] },
      planDistribution: [{ planId: 'p1', name: 'Growth', count: 4 }],
      series: { tenantRegistrations: [{ date: '2026-11-01', count: 3 }], studentRegistrations: [{ date: '2026-11-01', count: 20 }] },
      commerce: { available: false, reason: 'Transaction revenue appears once payments are enabled.' },
    });
    const router = createMemoryRouter([{ path: '/', element: <AdminDashboardPage /> }]);
    render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>);
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('340')).toBeInTheDocument();
    expect(screen.getByText('₹11,996.00')).toBeInTheDocument();
    expect(screen.getByText(/appears once payments are enabled/)).toBeInTheDocument();
    expect(platformApi.dashboard).toHaveBeenCalledWith(expect.objectContaining({ from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
  });
});
