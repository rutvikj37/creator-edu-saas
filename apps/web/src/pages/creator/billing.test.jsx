import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { BillingPage } from './BillingPage.jsx';
import { creatorApi } from '../../services/api/platform.js';
import { planBillingApi } from '../../services/api/commerce.js';
import { openRazorpay } from '../../utils/razorpay.js';

vi.mock('../../services/api/platform.js', () => ({ creatorApi: { billing: vi.fn() } }));
vi.mock('../../services/api/commerce.js', () => ({ planBillingApi: { plans: vi.fn(), quote: vi.fn(), checkout: vi.fn(), invoices: vi.fn(), pay: vi.fn(), confirm: vi.fn(), pdf: vi.fn(), setCancel: vi.fn() } }));
vi.mock('../../utils/razorpay.js', () => ({ openRazorpay: vi.fn() }));

const catalog = [{ key: 'courses.max', kind: 'limit', label: 'Courses' }, { key: 'commission.percent', kind: 'limit', label: 'Transaction commission %' }];
const plansData = {
  currency: 'INR', paymentsEnabled: true, current: { planId: 'trial', status: 'TRIALING' },
  plans: [
    { id: 'trial', code: 'trial', name: 'Free Trial', trialDays: 14, features: [{ key: 'courses.max', enabled: true, limit: 3 }], prices: [] },
    { id: 'growth', code: 'growth', name: 'Growth', trialDays: 0, features: [{ key: 'courses.max', enabled: true, limit: 50 }, { key: 'commission.percent', enabled: true, limit: 2 }], prices: [{ id: 'gm', interval: 'MONTH', currency: 'INR', amount: '2999' }, { id: 'gy', interval: 'YEAR', currency: 'INR', amount: '29990' }] },
  ],
};
const billing = (sub, active = true) => ({ subscription: sub, entitlements: { active, planName: sub?.plan?.name, features: { 'courses.max': { enabled: true, limit: 3 }, 'commission.percent': { enabled: true, limit: 5 } } }, usage: { 'courses.max': 1 }, catalog });

function wrap() {
  const router = createMemoryRouter([{ path: '/', element: <BillingPage /> }]);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
}

afterEach(() => vi.clearAllMocks());

describe('BillingPage', () => {
  it('quotes a plan with GST, pays through Razorpay and confirms', async () => {
    creatorApi.billing.mockResolvedValue(billing({ status: 'TRIALING', trialEndsAt: '2026-11-19T00:00:00Z', plan: { id: 'trial', name: 'Free Trial' }, planPrice: null }));
    planBillingApi.plans.mockResolvedValue(plansData);
    planBillingApi.invoices.mockResolvedValue([]);
    planBillingApi.quote.mockResolvedValue({ plan: { name: 'Growth' }, interval: 'YEAR', currency: 'INR', lines: [{ description: 'Growth plan — yearly', amount: '29990.00' }], credit: '0.00', creditNote: null, taxRate: 18, tax: '5398.20', total: '35388.20', paymentsEnabled: true });
    planBillingApi.checkout.mockResolvedValue({ id: 'inv1', status: 'OPEN' });
    planBillingApi.pay.mockResolvedValue({ invoiceId: 'inv1', checkout: { keyId: 'rzp_test_p', orderId: 'order_9', amount: 3538820 } });
    openRazorpay.mockResolvedValue({ razorpay_order_id: 'order_9', razorpay_payment_id: 'pay_9', razorpay_signature: 's' });
    planBillingApi.confirm.mockResolvedValue({ id: 'inv1', status: 'PAID' });
    wrap();
    await userEvent.click(await screen.findByRole('tab', { name: 'Yearly' }));
    expect(await screen.findByText('₹29,990.00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose Growth' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('GST 18%')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pay ₹35,388.20' }));
    await waitFor(() => expect(planBillingApi.confirm).toHaveBeenCalledWith('inv1', { razorpay_order_id: 'order_9', razorpay_payment_id: 'pay_9', razorpay_signature: 's' }));
    expect(planBillingApi.checkout).toHaveBeenCalledWith('gy');
  });

  it('shows the overdue renewal with a pay action and offers cancellation for paid plans', async () => {
    creatorApi.billing.mockResolvedValue(billing({ status: 'PAST_DUE', graceEndsAt: '2026-11-12T00:00:00Z', currentPeriodEnd: '2026-11-05T00:00:00Z', plan: { id: 'growth', name: 'Growth' }, planPrice: { id: 'gm', amount: '2999', currency: 'INR', interval: 'MONTH' } }));
    planBillingApi.plans.mockResolvedValue({ ...plansData, current: { planId: 'growth', planPriceId: 'gm', status: 'PAST_DUE' } });
    planBillingApi.invoices.mockResolvedValue([{ id: 'r1', kind: 'RENEWAL', status: 'OPEN', number: null, totalAmount: '3538.82', currency: 'INR', dueAt: '2026-11-05T00:00:00Z', createdAt: '2026-10-29T00:00:00Z' }]);
    wrap();
    expect(await screen.findByText('Renewal payment overdue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay ₹3,538.82' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel plan' })).toBeInTheDocument();
    expect((await screen.findAllByText('Draft')).length).toBeGreaterThan(0);
  });

  it('explains an expired trial and when online payments are not enabled', async () => {
    creatorApi.billing.mockResolvedValue(billing({ status: 'EXPIRED', trialEndsAt: '2026-11-01T00:00:00Z', plan: { id: 'trial', name: 'Free Trial' }, planPrice: null }, false));
    planBillingApi.plans.mockResolvedValue({ ...plansData, paymentsEnabled: false });
    planBillingApi.invoices.mockResolvedValue([]);
    wrap();
    expect(await screen.findByText('Your free trial has ended')).toBeInTheDocument();
    expect(await screen.findByText(/Online plan payments are not enabled yet/)).toBeInTheDocument();
  });
});
