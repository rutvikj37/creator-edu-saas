import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { BillingPage } from './BillingPage.jsx';
import { creatorApi } from '../../services/api/platform.js';
import { planBillingApi } from '../../services/api/commerce.js';

vi.mock('../../services/api/platform.js', () => ({ creatorApi: { billing: vi.fn() } }));
vi.mock('../../services/api/commerce.js', () => ({ planBillingApi: { plans: vi.fn(), invoices: vi.fn(), pay: vi.fn(), confirm: vi.fn(), pdf: vi.fn(), setCancel: vi.fn() } }));
vi.mock('../../utils/razorpay.js', () => ({ openRazorpay: vi.fn() }));

const catalog = [{ key: 'courses.max', kind: 'limit', label: 'Courses' }, { key: 'commission.percent', kind: 'limit', label: 'Transaction commission %' }];
const plansData = {
  currency: 'INR', paymentsEnabled: true, current: { planId: 'growth', status: 'ACTIVE' },
  plans: [
    { id: 'growth', code: 'growth', name: 'Grow', trialDays: 0, features: [{ key: 'courses.max', enabled: true, limit: 50 }], prices: [{ id: 'gm', interval: 'SIX_MONTH', currency: 'INR', amount: '16999' }] },
    { id: 'rise', code: 'rise', name: 'Rise', trialDays: 0, features: [{ key: 'courses.max', enabled: true, limit: 50 }], prices: [{ id: 'ry', interval: 'YEAR', currency: 'INR', amount: '19999' }] },
  ],
};
const billing = (sub, active = true) => ({ subscription: sub, entitlements: { active, planName: sub?.plan?.name, features: { 'courses.max': { enabled: true, limit: 3 }, 'commission.percent': { enabled: true, limit: 5 } } }, usage: { 'courses.max': 1 }, catalog });

function wrap() {
  const router = createMemoryRouter([{ path: '/', element: <BillingPage /> }]);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
}

afterEach(() => vi.clearAllMocks());

describe('BillingPage', () => {
  it('shows only the active plan and lists invoices with download', async () => {
    creatorApi.billing.mockResolvedValue(billing({ status: 'ACTIVE', currentPeriodEnd: '2027-05-01T00:00:00Z', plan: { id: 'growth', name: 'Grow' }, planPrice: { id: 'gm', amount: '16999', currency: 'INR', interval: 'SIX_MONTH' } }));
    planBillingApi.plans.mockResolvedValue(plansData);
    planBillingApi.invoices.mockResolvedValue([
      { id: 'inv1', kind: 'PLAN', status: 'PAID', number: 'INV-1001', totalAmount: '16999.00', currency: 'INR', paidAt: '2026-11-01T00:00:00Z', createdAt: '2026-11-01T00:00:00Z', periodStart: '2026-11-01T00:00:00Z', periodEnd: '2027-05-01T00:00:00Z' },
    ]);
    wrap();
    expect(await screen.findByText('Grow')).toBeInTheDocument();
    expect(screen.getByText(/₹16,999\.00 \/ 6 months/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Choose/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Plans' })).not.toBeInTheDocument();
    expect(screen.queryByText('Rise')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Invoices' })).toBeInTheDocument();
    expect(screen.getByText('INV-1001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download INV-1001' })).toBeInTheDocument();
  });

  it('shows the overdue renewal with a pay action and offers cancellation for paid plans', async () => {
    creatorApi.billing.mockResolvedValue(billing({ status: 'PAST_DUE', graceEndsAt: '2026-11-12T00:00:00Z', currentPeriodEnd: '2026-11-05T00:00:00Z', plan: { id: 'growth', name: 'Grow' }, planPrice: { id: 'gm', amount: '16999', currency: 'INR', interval: 'SIX_MONTH' } }));
    planBillingApi.plans.mockResolvedValue({ ...plansData, current: { planId: 'growth', planPriceId: 'gm', status: 'PAST_DUE' } });
    planBillingApi.invoices.mockResolvedValue([{ id: 'r1', kind: 'RENEWAL', status: 'OPEN', number: null, totalAmount: '20058.82', currency: 'INR', dueAt: '2026-11-05T00:00:00Z', createdAt: '2026-10-29T00:00:00Z' }]);
    wrap();
    expect(await screen.findByText('Renewal payment overdue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay ₹20,058.82' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel plan' })).toBeInTheDocument();
    expect((await screen.findAllByText('Draft')).length).toBeGreaterThan(0);
  });

  it('explains an expired trial and points to support instead of plan cards', async () => {
    creatorApi.billing.mockResolvedValue(billing({ status: 'EXPIRED', trialEndsAt: '2026-11-01T00:00:00Z', plan: { id: 'trial', name: 'Free Trial' }, planPrice: null }, false));
    planBillingApi.plans.mockResolvedValue({ ...plansData, paymentsEnabled: false });
    planBillingApi.invoices.mockResolvedValue([]);
    wrap();
    expect(await screen.findByText('Your free trial has ended')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'contact support' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Plans' })).not.toBeInTheDocument();
    expect(screen.getByText('No invoices yet')).toBeInTheDocument();
  });
});
