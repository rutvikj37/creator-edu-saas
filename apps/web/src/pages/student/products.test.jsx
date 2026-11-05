import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { ProductsPage } from '../creator/ProductsPage.jsx';
import { ProductPage } from '../public/ProductPage.jsx';
import { DownloadsPage } from './DownloadsPage.jsx';
import { productsApi } from '../../services/api/commerce.js';

vi.mock('../../services/api/commerce.js', () => ({
  productsApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), buyers: vi.fn(), publicGet: vi.fn(), mine: vi.fn(async () => []), claim: vi.fn(), download: vi.fn() },
  cartApi: { add: vi.fn() },
}));
vi.mock('../../services/api/auth.js', () => ({ academyApi: { site: vi.fn(async () => ({ name: 'Acme', theme: {}, paymentsEnabled: true })) } }));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ status: 'authenticated', can: () => true }) }));
vi.mock('../public/AcademyLandingPage.jsx', () => ({ AcademyHeader: () => null }));
vi.mock('../../components/forms/FileUpload.jsx', () => ({
  FileUpload: ({ label, onUploaded }) => <button type="button" onClick={() => onUploaded({ id: 'f'.repeat(25), fileName: 'Guide.pdf', sizeBytes: 2048, url: 'x' })}>{`Upload: ${label}`}</button>,
}));

function wrap(routes, path) {
  const router = createMemoryRouter([...routes, { path: '*', element: <p>elsewhere</p> }], { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}
afterEach(() => vi.clearAllMocks());

it('creator creates a product with an uploaded file and a download limit', async () => {
  productsApi.list.mockResolvedValue([]);
  productsApi.create.mockResolvedValue({ id: 'p1' });
  wrap([{ path: '/', element: <ProductsPage /> }], '/');
  await userEvent.click((await screen.findAllByRole('button', { name: /New product|Create a product/ }))[0]);
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText(/^Name/), 'GST Guide');
  await userEvent.type(within(dialog).getByLabelText(/^Price/), '299');
  await userEvent.type(within(dialog).getByLabelText('Downloads per file'), '3');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Upload: Add a file' }));
  expect(within(dialog).getByLabelText('File 1 name')).toHaveValue('Guide');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create product' }));
  await waitFor(() => expect(productsApi.create).toHaveBeenCalled());
  expect(productsApi.create.mock.calls[0][0]).toMatchObject({ title: 'GST Guide', priceAmount: 299, downloadLimit: 3, compareAtAmount: null, files: [{ fileAssetId: 'f'.repeat(25), title: 'Guide' }] });
});

it('free product page claims and sends the student to their downloads', async () => {
  productsApi.publicGet.mockResolvedValue({ id: 'p2', slug: 'checklist', title: 'Free GST checklist', description: null, priceAmount: '0', currency: 'INR', isFree: true, coverUrl: null, downloadLimit: null, files: [{ title: 'Checklist', type: 'PDF', sizeBytes: 4096 }] });
  productsApi.claim.mockResolvedValue({ claimed: true });
  const router = wrap([{ path: '/products/:slug', element: <ProductPage /> }, { path: '/learn/downloads', element: <p>downloads</p> }], '/products/checklist');
  expect(await screen.findByText('Checklist')).toBeInTheDocument();
  expect(screen.getByText('PDF · 4 KB')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Get it free' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/learn/downloads'));
});

it('downloads page shows remaining downloads and fetches a signed link', async () => {
  productsApi.mine.mockResolvedValue([{ id: 'p1', title: 'GST Guide', coverUrl: null, since: '2026-11-05T10:00:00Z', downloadLimit: 2, files: [{ id: 'fa', title: 'The guide', remaining: 1 }, { id: 'fb', title: 'Tracker', remaining: 0 }] }]);
  productsApi.download.mockResolvedValue({ url: 'https://files.example/signed', fileName: 'Guide.pdf' });
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  wrap([{ path: '/', element: <DownloadsPage /> }], '/');
  expect(await screen.findByText('1 download left')).toBeInTheDocument();
  const buttons = screen.getAllByRole('button', { name: 'Download' });
  expect(buttons[1]).toBeDisabled();
  await userEvent.click(buttons[0]);
  await waitFor(() => expect(assign).toHaveBeenCalledWith('https://files.example/signed'));
  expect(productsApi.download).toHaveBeenCalledWith('p1', 'fa');
  vi.unstubAllGlobals();
});
