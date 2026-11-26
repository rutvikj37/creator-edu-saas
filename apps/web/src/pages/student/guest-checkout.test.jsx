import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CheckoutPage } from './CheckoutPage.jsx';
import { checkoutApi } from '../../services/api/commerce.js';
import { authApi } from '../../services/api/auth.js';
import { catalogApi, learnApi } from '../../services/api/learn.js';

vi.mock('../../services/api/commerce.js', () => ({
  checkoutApi: { quote: vi.fn(), guestQuote: vi.fn(), offers: vi.fn(async () => []), guestOffers: vi.fn(async () => []), checkout: vi.fn(), pay: vi.fn(), confirm: vi.fn(), abandon: vi.fn() },
}));
vi.mock('../../services/api/learn.js', () => ({ catalogApi: { course: vi.fn() }, learnApi: { enroll: vi.fn() } }));
vi.mock('../../services/api/auth.js', () => ({
  academyApi: { site: vi.fn(async () => ({ name: 'Speak Academy', supportEmail: 'help@speak.test', theme: {} })) },
  authApi: { checkoutAccount: vi.fn(), login: vi.fn() },
}));
vi.mock('../../utils/razorpay.js', () => ({ openRazorpay: vi.fn() }));
const auth = { status: 'anonymous', user: null, establish: vi.fn(async () => ({})), logout: vi.fn() };
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => auth }));

const quote = { currency: 'INR', subtotal: '999.00', discount: '0.00', tax: '0.00', total: '999.00', taxRate: null, taxInclusive: true, paymentsEnabled: true, couponCode: null };

function wrap() {
  const router = createMemoryRouter(
    [{ path: '/checkout/:slug', element: <CheckoutPage /> }, { path: '/learn/orders/:id', element: <p>order page</p> }, { path: '/learn/courses/:id', element: <p>player</p> }],
    { initialEntries: ['/checkout/comm'] },
  );
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

async function fillDetails() {
  await userEvent.type(await screen.findByLabelText(/^Name/), 'Asha Guest');
  await userEvent.type(screen.getByLabelText(/^Email/), 'asha@example.test');
  await userEvent.type(screen.getByLabelText(/Phone number/), '9812345678');
}

afterEach(() => vi.clearAllMocks());

describe('Guest checkout', () => {
  it('shows the product, prices it without an account, creates the account and places the order', async () => {
    catalogApi.course.mockResolvedValue({ id: 'c1', slug: 'comm', title: 'Communication course', isFree: false, shortDescription: 'Speak clearly.', currency: 'INR' });
    checkoutApi.guestQuote.mockResolvedValue(quote);
    authApi.checkoutAccount.mockResolvedValue({ accountExists: false, accessToken: 't' });
    checkoutApi.checkout.mockResolvedValue({ id: 'o9', status: 'PAID' });
    const router = wrap();
    expect(await screen.findByRole('heading', { name: 'Communication course' })).toBeInTheDocument();
    expect(screen.getByText('Speak clearly.')).toBeInTheDocument();
    expect(screen.getByText('help@speak.test')).toBeInTheDocument();
    expect(screen.getByText('Lifetime')).toBeInTheDocument();
    expect(checkoutApi.guestQuote).toHaveBeenCalledWith({ courseId: 'c1', couponCode: undefined });
    expect(checkoutApi.quote).not.toHaveBeenCalled();

    // Email and phone are required for a guest.
    await userEvent.click(screen.getByRole('button', { name: /Pay ₹999.00/ }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(authApi.checkoutAccount).not.toHaveBeenCalled();

    await fillDetails();
    await userEvent.click(screen.getByRole('button', { name: /Pay ₹999.00/ }));
    await waitFor(() => expect(authApi.checkoutAccount).toHaveBeenCalledWith({ fullName: 'Asha Guest', email: 'asha@example.test', phone: '+919812345678' }));
    expect(auth.establish).toHaveBeenCalledWith({ accountExists: false, accessToken: 't' });
    expect(checkoutApi.checkout.mock.calls[0][0]).toMatchObject({ courseId: 'c1', billing: { name: 'Asha Guest', phone: '+919812345678' } });
    await waitFor(() => expect(router.state.location.pathname).toBe('/learn/orders/o9'));
  });

  it('asks for the password when the email already has an account', async () => {
    catalogApi.course.mockResolvedValue({ id: 'c1', slug: 'comm', title: 'Communication course', isFree: false, currency: 'INR' });
    checkoutApi.guestQuote.mockResolvedValue(quote);
    authApi.checkoutAccount.mockResolvedValue({ accountExists: true });
    authApi.login.mockResolvedValue({ accessToken: 't2' });
    checkoutApi.checkout.mockResolvedValue({ id: 'o10', status: 'PAID' });
    wrap();
    await fillDetails();
    await userEvent.click(screen.getByRole('button', { name: /Pay ₹999.00/ }));
    expect(await screen.findByText(/already have an account with this email/)).toBeInTheDocument();
    expect(checkoutApi.checkout).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Password'), 'my-password-1');
    await userEvent.click(screen.getByRole('button', { name: /Log in & pay/ }));
    await waitFor(() => expect(authApi.login).toHaveBeenCalledWith({ email: 'asha@example.test', password: 'my-password-1' }));
    expect(auth.establish).toHaveBeenCalledWith({ accessToken: 't2' });
    await waitFor(() => expect(checkoutApi.checkout).toHaveBeenCalled());
  });

  it('free course: "Access now" creates the account and enrols without payment', async () => {
    catalogApi.course.mockResolvedValue({ id: 'c2', slug: 'comm', title: 'Free starter', isFree: true, currency: 'INR' });
    authApi.checkoutAccount.mockResolvedValue({ accountExists: false, accessToken: 't3' });
    learnApi.enroll.mockResolvedValue({ id: 'e1' });
    const router = wrap();
    expect(await screen.findByText('What you’ll get')).toBeInTheDocument();
    expect(checkoutApi.guestQuote).not.toHaveBeenCalled();
    await fillDetails();
    await userEvent.click(screen.getByRole('button', { name: 'Access now' }));
    await waitFor(() => expect(learnApi.enroll).toHaveBeenCalledWith('c2'));
    expect(checkoutApi.checkout).not.toHaveBeenCalled();
    await waitFor(() => expect(router.state.location.pathname).toBe('/learn/courses/c2'));
  });
});
