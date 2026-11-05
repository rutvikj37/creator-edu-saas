import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CheckoutPage } from './CheckoutPage.jsx';
import { OrderStatusPage } from './OrdersPages.jsx';
import { checkoutApi } from '../../services/api/commerce.js';
import { openRazorpay } from '../../utils/razorpay.js';

vi.mock('../../services/api/commerce.js', () => ({
  checkoutApi: { quote: vi.fn(), checkout: vi.fn(), pay: vi.fn(), confirm: vi.fn(), abandon: vi.fn(), order: vi.fn(), invoice: vi.fn() },
}));
vi.mock('../../services/api/learn.js', () => ({ catalogApi: { course: vi.fn(async () => ({ id: 'c1', slug: 'sql', title: 'SQL Basics', currency: 'INR' })) } }));
vi.mock('../../services/api/auth.js', () => ({ academyApi: { site: vi.fn(async () => ({ name: 'Acme', theme: {} })) } }));
vi.mock('../../utils/razorpay.js', () => ({ openRazorpay: vi.fn() }));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ status: 'authenticated', user: { fullName: 'Priya', email: 'p@example.test' } }) }));
vi.mock('../public/AcademyLandingPage.jsx', () => ({ AcademyHeader: () => null }));

const quote = (over = {}) => ({ currency: 'INR', subtotal: '1180.00', discount: '0.00', tax: '180.00', total: '1180.00', taxRate: 18, taxInclusive: true, paymentsEnabled: true, couponCode: null, ...over });

function wrap() {
  const router = createMemoryRouter(
    [{ path: '/checkout/:slug', element: <CheckoutPage /> }, { path: '/learn/orders/:id', element: <OrderStatusPage /> }],
    { initialEntries: ['/checkout/sql'] },
  );
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

afterEach(() => vi.clearAllMocks());

describe('CheckoutPage', () => {
  it('shows the GST breakdown and rejects an invalid coupon inline', async () => {
    checkoutApi.quote.mockImplementation(async ({ couponCode }) => {
      if (couponCode) throw Object.assign(new Error('Invalid'), { details: [{ field: 'couponCode', message: 'This coupon code is not valid' }] });
      return quote();
    });
    wrap();
    expect(await screen.findByText('GST 18% (included)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pay ₹1,180.00/ })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Coupon code'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This coupon code is not valid');
  });

  it('applies a coupon, pays through Razorpay and confirms on the server', async () => {
    checkoutApi.quote.mockImplementation(async ({ couponCode }) => (couponCode ? quote({ discount: '118.00', total: '1062.00', tax: '162.00', couponCode: 'SAVE10' }) : quote()));
    checkoutApi.checkout.mockResolvedValue({ id: 'o1', status: 'PENDING' });
    checkoutApi.pay.mockResolvedValue({ orderId: 'o1', checkout: { keyId: 'rzp_test_x', orderId: 'order_1', amount: 106200, currency: 'INR' } });
    openRazorpay.mockResolvedValue({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' });
    checkoutApi.confirm.mockResolvedValue({ id: 'o1', status: 'PAID' });
    checkoutApi.order.mockResolvedValue({ id: 'o1', number: 'ORD-000001', status: 'PAID', totalAmount: '1062', currency: 'INR', items: [{ courseId: 'c1', title: 'SQL Basics' }], paidAt: '2026-11-05T10:00:00Z', invoiceNumber: 'INV/2026-27/00001' });
    const router = wrap();
    await userEvent.type(await screen.findByLabelText('Coupon code'), 'save10');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('SAVE10 applied')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Pay ₹1,062.00/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/learn/orders/o1'));
    expect(checkoutApi.checkout).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'c1', couponCode: 'SAVE10', billing: expect.objectContaining({ name: 'Priya' }) }), expect.any(String));
    expect(checkoutApi.confirm).toHaveBeenCalledWith('o1', { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' });
    expect(await screen.findByText('Payment successful')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start learning' })).toHaveAttribute('href', '/learn/courses/c1');
  });

  it('reuses the same order when the buyer closes Razorpay and tries again', async () => {
    checkoutApi.quote.mockResolvedValue(quote());
    checkoutApi.checkout.mockResolvedValue({ id: 'o2', status: 'PENDING' });
    checkoutApi.pay.mockResolvedValue({ orderId: 'o2', checkout: { keyId: 'k', orderId: 'order_2' } });
    checkoutApi.abandon.mockResolvedValue({});
    openRazorpay.mockResolvedValue({ dismissed: true });
    wrap();
    const pay = await screen.findByRole('button', { name: /Pay/ });
    await userEvent.click(pay);
    await waitFor(() => expect(checkoutApi.abandon).toHaveBeenCalledWith('o2', 'Checkout closed'));
    await userEvent.click(pay);
    await waitFor(() => expect(checkoutApi.pay).toHaveBeenCalledTimes(2));
    expect(checkoutApi.checkout).toHaveBeenCalledTimes(1);
  });

  it('completes a free (100% coupon) order without opening Razorpay', async () => {
    checkoutApi.quote.mockResolvedValue(quote({ total: '0.00', tax: '0.00', discount: '1180.00' }));
    checkoutApi.checkout.mockResolvedValue({ id: 'o3', status: 'PAID' });
    checkoutApi.order.mockResolvedValue({ id: 'o3', number: 'ORD-3', status: 'PAID', totalAmount: '0', currency: 'INR', items: [{ courseId: 'c1', title: 'SQL Basics' }] });
    const router = wrap();
    await userEvent.click(await screen.findByRole('button', { name: 'Get access' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/learn/orders/o3'));
    expect(openRazorpay).not.toHaveBeenCalled();
    expect(await screen.findByText('You’re enrolled')).toBeInTheDocument();
    expect(checkoutApi.pay).not.toHaveBeenCalled();
  });
});
