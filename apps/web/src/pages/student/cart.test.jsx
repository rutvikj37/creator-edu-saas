import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CartPage } from './CartPage.jsx';
import { CheckoutPage } from './CheckoutPage.jsx';
import { BundlePage } from '../public/BundlePage.jsx';
import { BundlesPage } from '../creator/BundlesPage.jsx';
import { bundlesApi, cartApi, checkoutApi } from '../../services/api/commerce.js';

vi.mock('../../services/api/commerce.js', () => ({
  checkoutApi: { quote: vi.fn(), checkout: vi.fn(), pay: vi.fn(), confirm: vi.fn(), abandon: vi.fn() },
  cartApi: { get: vi.fn(), add: vi.fn(), remove: vi.fn(), clear: vi.fn() },
  bundlesApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), publicGet: vi.fn(), publicList: vi.fn() },
}));
vi.mock('../../services/api/creator.js', () => ({ coursesApi: { list: vi.fn(async () => ({ items: [
  { id: 'c1', title: 'Excel Basics', status: 'PUBLISHED', isFree: false, priceAmount: '999', currency: 'INR' },
  { id: 'c2', title: 'Excel Charts', status: 'PUBLISHED', isFree: false, priceAmount: '1499', currency: 'INR' },
  { id: 'c3', title: 'Excel Macros', status: 'DRAFT', isFree: false, priceAmount: '799', currency: 'INR' },
] })) } }));
vi.mock('../../services/api/learn.js', () => ({ catalogApi: { course: vi.fn() }, learnApi: { enrollments: vi.fn(async () => [{ course: { id: 'c1' }, usable: true }]) } }));
vi.mock('../../services/api/auth.js', () => ({ academyApi: { site: vi.fn(async () => ({ name: 'Acme', theme: {}, paymentsEnabled: true })) } }));
vi.mock('../../services/api/community.js', () => ({ membershipsApi: { publicPlans: vi.fn() } }));
vi.mock('../../services/api/affiliates.js', () => ({ storedReferral: () => null }));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ status: 'authenticated', user: { fullName: 'Priya', email: 'p@example.test' }, can: () => true }) }));
vi.mock('../public/AcademyLandingPage.jsx', () => ({ AcademyHeader: () => null }));
vi.mock('../../components/forms/FileUpload.jsx', () => ({ FileUpload: () => <div>upload</div> }));

function wrap(routes, path) {
  const router = createMemoryRouter([...routes, { path: '*', element: <p>elsewhere</p> }], { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

afterEach(() => vi.clearAllMocks());

it('cart: lists items, flags problems and only checks out a clean cart', async () => {
  cartApi.get.mockResolvedValue({ count: 2, currency: 'INR', subtotal: '5999.00', ready: false, items: [
    { id: 'i1', kind: 'bundle', refId: 'b1', title: 'Python Path', slug: 'python-path', priceAmount: '4500', currency: 'INR', courseCount: 2, problem: null },
    { id: 'i2', kind: 'course', refId: 'c9', title: 'Old course', slug: 'old', priceAmount: '1499', currency: 'INR', courseCount: 1, problem: 'No longer available' },
  ] });
  cartApi.remove.mockResolvedValue({ count: 1, currency: 'INR', subtotal: '4500.00', ready: true, items: [{ id: 'i1', kind: 'bundle', refId: 'b1', title: 'Python Path', slug: 'python-path', priceAmount: '4500', currency: 'INR', courseCount: 2, problem: null }] });
  const router = wrap([{ path: '/cart', element: <CartPage /> }], '/cart');
  expect(await screen.findByText('No longer available')).toBeInTheDocument();
  expect(screen.getByText('Bundle · 2 courses')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Checkout' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Remove Old course' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Checkout' })).toBeEnabled());
  expect(cartApi.remove.mock.calls[0][0]).toBe('i2');
  await userEvent.click(screen.getByRole('button', { name: 'Checkout' }));
  expect(router.state.location.pathname).toBe('/cart/checkout');
});

it('cart checkout: shows every line and checks out the whole cart', async () => {
  checkoutApi.quote.mockResolvedValue({ kind: 'cart', currency: 'INR', subtotal: '9500.00', discount: '500.00', tax: '0.00', total: '9000.00', taxRate: null, taxInclusive: true, paymentsEnabled: true, couponCode: 'PY10',
    items: [{ kind: 'course', id: 'x', title: 'Python 1', unit: '1000.00', discount: '100.00', total: '900.00' }, { kind: 'bundle', id: 'b', title: 'Python Path (bundle)', unit: '4500.00', discount: '0.00', total: '4500.00' }, { kind: 'course', id: 'w', title: 'Data Science', unit: '4000.00', discount: '400.00', total: '3600.00' }] });
  checkoutApi.checkout.mockResolvedValue({ id: 'o1', status: 'PAID' });
  const router = wrap([{ path: '/cart/checkout', element: <CheckoutPage /> }, { path: '/learn/orders/:id', element: <p>order page</p> }], '/cart/checkout');
  expect(await screen.findByText('Python Path (bundle)')).toBeInTheDocument();
  expect(screen.getByText('3 items')).toBeInTheDocument();
  expect(checkoutApi.quote).toHaveBeenCalledWith({ fromCart: true, couponCode: undefined });
  await userEvent.click(screen.getByRole('button', { name: /^Pay/ }));
  await waitFor(() => expect(checkoutApi.checkout).toHaveBeenCalled());
  expect(checkoutApi.checkout.mock.calls[0][0]).toMatchObject({ fromCart: true, billing: { name: 'Priya' } });
  await waitFor(() => expect(router.state.location.pathname).toBe('/learn/orders/o1'));
});

it('bundle page: shows the saving and courses already owned; adds to cart', async () => {
  bundlesApi.publicGet.mockResolvedValue({ id: 'b1', slug: 'excel-pro', title: 'Excel Pro', description: 'Everything Excel', priceAmount: '1999', worthAmount: '2498.00', currency: 'INR', courseCount: 2,
    courses: [{ id: 'c1', title: 'Excel Basics', slug: 'excel-basics', thumbnailUrl: null }, { id: 'c2', title: 'Excel Charts', slug: 'excel-charts', thumbnailUrl: null }] });
  cartApi.add.mockResolvedValue({ count: 1, items: [] });
  const router = wrap([{ path: '/bundles/:slug', element: <BundlePage /> }], '/bundles/excel-pro');
  expect(await screen.findByText('Excel Pro')).toBeInTheDocument();
  expect(screen.getByText(/you save/)).toHaveTextContent('you save ₹499.00');
  expect(await screen.findByText('You have this course')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
  await waitFor(() => expect(cartApi.add).toHaveBeenCalledWith({ bundleId: 'b1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Buy bundle' }));
  expect(router.state.location.pathname).toBe('/checkout/bundle/excel-pro');
});

it('creator: creates a bundle from chosen courses and sees the saving', async () => {
  bundlesApi.list.mockResolvedValue([]);
  bundlesApi.create.mockResolvedValue({ id: 'b1' });
  wrap([{ path: '/creator/bundles', element: <BundlesPage /> }], '/creator/bundles');
  await userEvent.click((await screen.findAllByRole('button', { name: /New bundle|Create a bundle/ }))[0]);
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Excel Pro');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create bundle' }));
  expect(await within(dialog).findByText('Choose at least 2 courses')).toBeInTheDocument();
  await userEvent.click(await within(dialog).findByRole('checkbox', { name: /Excel Basics/ }));
  await userEvent.click(within(dialog).getByRole('checkbox', { name: /Excel Charts/ }));
  expect(within(dialog).getByRole('checkbox', { name: /Excel Macros \(not published\)/ })).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText(/Bundle price/), '1999');
  expect(within(dialog).getByText(/students save ₹499.00/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getAllByRole('button', { name: 'Move up' })[1]); // Charts first
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create bundle' }));
  await waitFor(() => expect(bundlesApi.create).toHaveBeenCalled());
  expect(bundlesApi.create.mock.calls[0][0]).toEqual({ title: 'Excel Pro', description: null, priceAmount: 1999, courseIds: ['c2', 'c1'], coverFileId: null });
});
