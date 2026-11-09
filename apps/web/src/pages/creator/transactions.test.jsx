import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { TransactionsPage } from './OrdersPage.jsx';
import { creatorCommerceApi } from '../../services/api/commerce.js';
import { creatorLearnApi } from '../../services/api/learn.js';

vi.mock('../../services/api/commerce.js', () => ({
  creatorCommerceApi: { orders: vi.fn(), summary: vi.fn(), invoice: vi.fn(), recordOffline: vi.fn(), order: vi.fn(), comments: vi.fn(), addComment: vi.fn(), editOrder: vi.fn(), settlements: vi.fn(), settlementsCsv: vi.fn() },
  bundlesApi: { list: vi.fn(async () => []) }, productsApi: { list: vi.fn(async () => []) },
}));
vi.mock('../../services/api/community.js', () => ({ membershipsApi: { plans: vi.fn(async () => []) } }));
vi.mock('../../services/api/coaching.js', () => ({ coachingApi: { programs: vi.fn(async () => []) } }));
vi.mock('../../services/api/analytics.js', () => ({ analyticsApi: { exportCsv: vi.fn() } }));
vi.mock('../../services/api/creator.js', () => ({ coursesApi: { list: vi.fn(async () => ({ items: [{ id: 'c1', title: 'Accounts Basics', status: 'PUBLISHED', isFree: false, priceAmount: '2499', currency: 'INR' }] })) } }));
vi.mock('../../services/api/learn.js', () => ({ creatorLearnApi: { students: vi.fn() } }));

const order = { id: 'o1', number: 'ORD-000004', status: 'PAID', currency: 'INR', totalAmount: '2000', paidAt: '2026-11-06T13:26:00Z', createdAt: '2026-11-06T13:26:00Z', paymentMode: 'UPI', externalReference: 'UPI-778899', buyer: { fullName: 'Cash Learner', email: 'cash@example.com' }, items: [{ title: 'Accounts Basics', courseId: 'c1' }] };

function wrap() {
  const router = createMemoryRouter([{ path: '/creator/transactions', element: <TransactionsPage /> }, { path: '/creator/orders/:id', element: <p>order detail</p> }], { initialEntries: ['/creator/transactions'] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}
afterEach(() => vi.clearAllMocks());

it('lists transactions with channel and type, filters by channel, and records an offline payment', async () => {
  creatorCommerceApi.orders.mockResolvedValue({ items: [order], meta: { page: 1, pageSize: 20, total: 1 } });
  creatorCommerceApi.summary.mockResolvedValue({ totals: [{ currency: 'INR', gross: '2000.00', refunds: '0.00' }], paidOrders: 1, refundsPending: 0 });
  creatorLearnApi.students.mockResolvedValue({ items: [{ id: 'u1', fullName: 'Cash Learner', email: 'cash@example.com' }], meta: {} });
  creatorCommerceApi.recordOffline.mockResolvedValue({ id: 'o2', number: 'ORD-000005' });
  const router = wrap();
  expect((await screen.findAllByText('UPI (direct) | Course')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Success').length).toBeGreaterThan(0);
  expect(screen.getAllByText('UPI-778899').length).toBeGreaterThan(0);

  await userEvent.click(screen.getByRole('button', { name: 'Channel' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Offline' }));
  await waitFor(() => expect(creatorCommerceApi.orders).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'offline' })));

  creatorCommerceApi.order.mockResolvedValue({ ...order, provider: null, billing: { state: null, gstin: null, phone: '+919108184258' }, buyer: { email: 'cash@example.com', phone: '+919108184258' } });
  creatorCommerceApi.comments.mockResolvedValue([]);
  creatorCommerceApi.addComment.mockResolvedValue([{ id: 'k1', body: 'Called them', author: 'Asha', createdAt: '2026-11-09T10:00:00Z' }]);
  creatorCommerceApi.editOrder.mockResolvedValue({ ...order, billing: { state: 'Karnataka', gstin: '29ABCDE1234F1Z5' } });
  await userEvent.click(screen.getAllByRole('button', { name: 'Actions for ORD-000004' })[0]);
  await userEvent.click(screen.getByRole('menuitem', { name: 'More information' }));
  const drawer = await screen.findByRole('dialog');
  expect(await within(drawer).findByText('UPI-778899')).toBeInTheDocument();
  expect(within(drawer).getByText('+919108184258')).toBeInTheDocument();
  expect(within(drawer).getByRole('button', { name: /Refund/ })).toBeDisabled(); // offline order
  await userEvent.type(within(drawer).getByLabelText('Add comment'), 'Called them');
  await userEvent.click(within(drawer).getByRole('button', { name: 'Add' }));
  expect(await within(drawer).findByText('Called them')).toBeInTheDocument();
  await userEvent.click(within(drawer).getByRole('button', { name: /Edit order/ }));
  const edit = (await screen.findAllByRole('dialog')).at(-1);
  await userEvent.selectOptions(within(edit).getByLabelText('State'), 'Karnataka');
  await userEvent.type(within(edit).getByLabelText('GST number'), '29abcde1234f1z5');
  await userEvent.click(within(edit).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(creatorCommerceApi.editOrder).toHaveBeenCalledWith('o1', expect.objectContaining({ state: 'Karnataka', gstin: '29ABCDE1234F1Z5' })));
  await userEvent.click(within(drawer).getByRole('button', { name: 'Open full order' }));
  expect(router.state.location.pathname).toBe('/creator/orders/o1');
});

it('add a transaction: pick product, learner, reference, mode and amount', async () => {
  creatorCommerceApi.orders.mockResolvedValue({ items: [], meta: { page: 1, pageSize: 20, total: 0 } });
  creatorCommerceApi.summary.mockResolvedValue({ totals: [], paidOrders: 0 });
  creatorLearnApi.students.mockResolvedValue({ items: [{ id: 'u1', fullName: 'Cash Learner', email: 'cash@example.com' }], meta: {} });
  creatorCommerceApi.recordOffline.mockResolvedValue({ id: 'o2', number: 'ORD-000005' });
  wrap();
  await userEvent.click(await screen.findByRole('button', { name: 'Add a transaction' }));
  const dialog = await screen.findByRole('dialog');
  const submit = within(dialog).getByRole('button', { name: 'Add a transaction' });
  expect(submit).toBeDisabled();
  await userEvent.click(await within(dialog).findByRole('option', { name: /Accounts Basics/ }));
  expect(within(dialog).getByLabelText('Amount *')).toHaveValue(2499);
  await userEvent.type(within(dialog).getByLabelText('Search learners'), 'cash');
  await userEvent.click(await within(dialog).findByRole('option', { name: /Cash Learner/ }));
  await userEvent.type(within(dialog).getByLabelText('Transaction ID *'), 'UTR123');
  await userEvent.selectOptions(within(dialog).getByLabelText('Payment mode *'), 'BANK_TRANSFER');
  await userEvent.clear(within(dialog).getByLabelText('Amount *'));
  await userEvent.type(within(dialog).getByLabelText('Amount *'), '2000');
  await userEvent.click(within(dialog).getByLabelText('No'));
  await userEvent.click(submit);
  await waitFor(() => expect(creatorCommerceApi.recordOffline).toHaveBeenCalledWith({ itemKind: 'course', itemId: 'c1', userId: 'u1', mode: 'BANK_TRANSFER', reference: 'UTR123', amount: 2000, sendEmail: false }));
});

it('settlements: totals, list with UTR and transactions, search', async () => {
  const { SettlementsPage } = await import('./SettlementsPage.jsx');
  creatorCommerceApi.settlements.mockResolvedValue({ connected: true, currency: 'INR', totals: { earnings: '1000.00', settled: '950.00', toBeSettled: '26.40' }, items: [{ id: 'setl_A1', date: '2026-11-08T10:00:00Z', amount: '950.00', fees: '20.00', status: 'processed', utr: 'UTR778899', transactions: 2 }] });
  const router = createMemoryRouter([{ path: '/', element: <SettlementsPage /> }], { initialEntries: ['/'] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  expect((await screen.findAllByText('UTR778899')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('₹950.00').length).toBeGreaterThan(0);
  await userEvent.type(screen.getByPlaceholderText('Search for UTR or settlement ID'), 'utr77');
  await waitFor(() => expect(creatorCommerceApi.settlements).toHaveBeenLastCalledWith({ q: 'utr77' }));
});
