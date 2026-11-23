import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { StudentOrdersPage } from './OrdersPages.jsx';
import { StudentCertificatesPage } from './CertificatesPage.jsx';
import { checkoutApi } from '../../services/api/commerce.js';
import { learnApi } from '../../services/api/learn.js';

vi.mock('../../services/api/commerce.js', () => ({ checkoutApi: { orders: vi.fn(), invoice: vi.fn() } }));
vi.mock('../../services/api/learn.js', () => ({ learnApi: { certificates: vi.fn(), certificatePdf: vi.fn() } }));
vi.mock('../../services/api/auth.js', () => ({ academyApi: { site: vi.fn(async () => ({})) } }));

function wrap(el) {
  const router = createMemoryRouter([{ path: '/', element: el }], { initialEntries: ['/'] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
}
afterEach(() => vi.clearAllMocks());

it('student orders: totals, item type, filter by status and search', async () => {
  checkoutApi.orders.mockResolvedValue([
    { id: 'o1', number: 'ORD-000001', status: 'PAID', currency: 'INR', totalAmount: '999', refundedAmount: '0', createdAt: '2026-11-05T10:00:00Z', paidAt: '2026-11-05T10:00:00Z', items: [{ title: 'GST Basics', courseId: 'c1' }] },
    { id: 'o2', number: 'ORD-000002', status: 'PAYMENT_INITIATED', currency: 'INR', totalAmount: '499', refundedAmount: '0', createdAt: '2026-11-06T10:00:00Z', items: [{ title: 'Tally pack', bundleId: 'b1' }] },
  ]);
  wrap(<StudentOrdersPage />);
  expect((await screen.findAllByText('₹999.00')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Paid | Bundle').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Complete payment').length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: 'Status' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Paid' }));
  await waitFor(() => expect(screen.queryAllByText('Tally pack')).toHaveLength(0));
  expect(screen.getAllByText('GST Basics').length).toBeGreaterThan(0);
});

it('student certificates: search and copy the verification link', async () => {
  const writeText = vi.fn(async () => {});
  Object.assign(navigator, { clipboard: { writeText } });
  learnApi.certificates.mockResolvedValue([
    { id: 'k1', number: 'CERT-001', courseTitle: 'GST Basics', issuedAt: '2026-11-01T00:00:00Z', status: 'ISSUED' },
    { id: 'k2', number: 'CERT-002', courseTitle: 'Excel Pro', issuedAt: '2026-11-02T00:00:00Z', status: 'ISSUED' },
  ]);
  wrap(<StudentCertificatesPage />);
  expect(await screen.findByText('Excel Pro')).toBeInTheDocument();
  await userEvent.type(screen.getByPlaceholderText('Search by course or certificate number'), 'gst');
  await waitFor(() => expect(screen.queryByText('Excel Pro')).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/verify\/CERT-001$/));
});
