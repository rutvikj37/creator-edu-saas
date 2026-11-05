import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { PaymentsPage } from './PaymentsPage.jsx';
import { OrderDetailPage } from './OrderDetailPage.jsx';
import { creatorCommerceApi } from '../../services/api/commerce.js';

vi.mock('../../services/api/commerce.js', () => ({
  creatorCommerceApi: { gateway: vi.fn(), saveGateway: vi.fn(), verifyGateway: vi.fn(), setGatewayActive: vi.fn(), removeGateway: vi.fn(), order: vi.fn(), refund: vi.fn(), invoice: vi.fn() },
}));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ can: () => true }) }));

function wrap(element, path = '/', route = '/') {
  const router = createMemoryRouter([{ path: route, element }], { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
}

afterEach(() => vi.clearAllMocks());

describe('PaymentsPage', () => {
  it('validates the key id and connects Razorpay', async () => {
    creatorCommerceApi.gateway.mockResolvedValue({ provider: 'RAZORPAY', configured: false, status: null });
    creatorCommerceApi.saveGateway.mockResolvedValue({ id: 'g1', configured: true, status: 'VERIFIED', mode: 'TEST', keyId: 'rzp_test_AbCdEf123456', isActive: true, hasWebhookSecret: false, webhookUrl: 'http://api/api/v1/webhooks/razorpay/g1', webhookEvents: ['payment.captured'], updatedAt: 'x' });
    wrap(<PaymentsPage />);
    await userEvent.type(await screen.findByLabelText(/Key ID/), 'pk_live_123');
    await userEvent.type(screen.getByLabelText(/Key secret/), 'secret-value');
    await userEvent.click(screen.getByRole('button', { name: 'Connect Razorpay' }));
    expect(await screen.findByText('Starts with rzp_test_ or rzp_live_')).toBeInTheDocument();
    expect(creatorCommerceApi.saveGateway).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText(/Key ID/));
    await userEvent.type(screen.getByLabelText(/Key ID/), 'rzp_test_AbCdEf123456');
    await userEvent.click(screen.getByRole('button', { name: 'Connect Razorpay' }));
    await waitFor(() => expect(creatorCommerceApi.saveGateway).toHaveBeenCalledWith({ keyId: 'rzp_test_AbCdEf123456', keySecret: 'secret-value' }));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('http://api/api/v1/webhooks/razorpay/g1')).toBeInTheDocument();
    expect(screen.getByText('Test mode')).toBeInTheDocument();
  });

  it('explains rejected keys', async () => {
    creatorCommerceApi.gateway.mockResolvedValue({ id: 'g1', configured: true, status: 'ERROR', mode: 'LIVE', keyId: 'rzp_live_AbCdEf123456', lastError: 'Razorpay rejected these keys', isActive: true, hasWebhookSecret: true, webhookUrl: 'u', webhookEvents: [], updatedAt: 'y' });
    wrap(<PaymentsPage />);
    expect(await screen.findByText('Check failed')).toBeInTheDocument();
    expect(screen.getByText('Razorpay rejected these keys')).toBeInTheDocument();
  });

  it('tells a connection failure apart from rejected keys', async () => {
    creatorCommerceApi.gateway.mockResolvedValue({ id: 'g1', configured: true, status: 'ERROR', mode: 'TEST', keyId: 'rzp_test_AbCdEf123456', lastError: 'Could not reach Razorpay', isActive: true, hasWebhookSecret: false, webhookUrl: 'u', webhookEvents: [], updatedAt: 'z' });
    wrap(<PaymentsPage />);
    expect(await screen.findByText("Couldn't verify with Razorpay")).toBeInTheDocument();
    expect(screen.queryByText('Razorpay rejected these keys')).not.toBeInTheDocument();
  });
});

describe('OrderDetailPage', () => {
  const order = {
    id: 'o1', number: 'ORD-000001', status: 'PAID', currency: 'INR', subtotalAmount: '1000', discountAmount: '0', taxAmount: '0', totalAmount: '1000', refundedAmount: '0',
    taxRate: null, taxInclusive: true, couponCode: null, billing: { name: 'Priya', email: 'p@example.test' }, createdAt: '2026-11-05T10:00:00Z', invoiceNumber: 'INV/2026-27/00001',
    items: [{ id: 'i1', title: 'SQL', unitAmount: '1000' }], payments: [{ id: 'p1', status: 'CAPTURED', providerPaymentId: 'pay_1', createdAt: '2026-11-05T10:00:00Z', method: 'upi' }],
    refunds: [], ledger: [{ type: 'SALE', amount: '1000' }, { type: 'PLATFORM_COMMISSION', amount: '-50' }], buyer: { fullName: 'Priya' },
  };

  it('refunds partially and only offers access removal for a full refund', async () => {
    creatorCommerceApi.order.mockResolvedValue(order);
    creatorCommerceApi.refund.mockResolvedValue({ ...order, status: 'PARTIALLY_REFUNDED', refundedAmount: '400', refunds: [{ id: 'r1', amount: '400', status: 'PROCESSED', createdAt: '2026-11-05T11:00:00Z' }] });
    wrap(<OrderDetailPage />, '/creator/orders/o1', '/creator/orders/:id');
    expect(await screen.findByText('Platform commission')).toBeInTheDocument();
    expect(screen.getByText('₹950.00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refund' }));
    const amount = screen.getByLabelText(/Amount/);
    expect(amount).toHaveValue(1000);
    expect(screen.getByLabelText('Also remove course access')).toBeEnabled();
    await userEvent.clear(amount);
    await userEvent.type(amount, '400');
    expect(screen.getByLabelText('Also remove course access')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Refund ₹400.00/ }));
    await waitFor(() => expect(creatorCommerceApi.refund).toHaveBeenCalledWith('o1', { amount: 400, reason: undefined, revokeAccess: false }));
    expect(await screen.findByText('Refunded')).toBeInTheDocument();
  });
});
