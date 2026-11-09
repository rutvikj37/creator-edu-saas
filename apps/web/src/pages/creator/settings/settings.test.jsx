import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { TaxInvoicingPage } from './TaxInvoicingPage.jsx';
import { academyApi2 } from '../../../services/api/creator.js';

vi.mock('../../../services/api/creator.js', () => ({ academyApi2: { business: vi.fn(), updateBusiness: vi.fn() } }));
vi.mock('../../../context/AuthContext.jsx', () => ({ useAuth: () => ({ status: 'authenticated', can: () => true }) }));

function wrap(el) {
  const router = createMemoryRouter([{ path: '/creator/settings/tax-invoicing', element: el }], { initialEntries: ['/creator/settings/tax-invoicing'] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
}
afterEach(() => vi.clearAllMocks());

const business = { gstRegistered: true, gstin: '29ABCDE1234F1Z5', taxRate: '18', pricesIncludeTax: true, state: null, taxDetails: null, exportsUnderLut: false, invoicesEnabled: true, invoicePrefix: 'INV', invoiceStartNumber: 1, invoiceNote: null, gstInputCredit: true, nextInvoiceNumber: 'INV/2026-27/00004' };

it('tax and invoicing: place of supply, LUT, serial start preview, note and switches save', async () => {
  academyApi2.business.mockResolvedValue(business);
  academyApi2.updateBusiness.mockImplementation(async (b) => ({ ...business, ...b }));
  wrap(<TaxInvoicingPage />);
  expect(await screen.findByText('Next invoice number: INV/2026-27/00004')).toBeInTheDocument();
  expect(screen.getByText(/international sales are charged 18% GST/)).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText('Place of supply'), 'Karnataka');
  await waitFor(() => expect(academyApi2.updateBusiness).toHaveBeenCalledWith({ state: 'Karnataka' }));

  await userEvent.click(screen.getByRole('switch', { name: /I sell to customers outside India/ }));
  await waitFor(() => expect(academyApi2.updateBusiness).toHaveBeenCalledWith({ exportsUnderLut: true }));

  const prefix = screen.getByLabelText('Prefix');
  await userEvent.clear(prefix);
  await userEvent.type(prefix, 'spe');
  const serial = screen.getByLabelText('Serial no.');
  await userEvent.clear(serial);
  await userEvent.type(serial, '10001');
  expect(screen.getByText('First invoice of a year: SPE/2026-27/10001')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[2]);
  await waitFor(() => expect(academyApi2.updateBusiness).toHaveBeenCalledWith({ invoicePrefix: 'SPE', invoiceStartNumber: 10001 }));

  await userEvent.type(screen.getByLabelText('Note on invoice'), 'Thank you!');
  await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[3]);
  await waitFor(() => expect(academyApi2.updateBusiness).toHaveBeenCalledWith({ invoiceNote: 'Thank you!' }));

  expect(screen.getByRole('switch', { name: 'Generate invoice on purchase' })).toHaveAttribute('aria-checked', 'true');
  await userEvent.click(screen.getByRole('switch', { name: 'Allow learners to claim GST input credit' }));
  await waitFor(() => expect(academyApi2.updateBusiness).toHaveBeenCalledWith({ gstInputCredit: false }));
});
