import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { DomainsPage } from './DomainsPage.jsx';
import { workspaceApi } from '../../services/api/auth.js';
import { PLATFORM_ROOT } from '../../utils/host.js';

vi.mock('../../services/api/auth.js', () => ({ workspaceApi: { domains: vi.fn(), subdomainAvailability: vi.fn(), addSubdomain: vi.fn(), makePrimary: vi.fn(), addDomain: vi.fn(), verifyDomain: vi.fn(), removeDomain: vi.fn() } }));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ status: 'authenticated', can: () => true }) }));

function wrap() {
  const router = createMemoryRouter([{ path: '/creator/domains', element: <DomainsPage /> }], { initialEntries: ['/creator/domains'] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
}
afterEach(() => vi.clearAllMocks());

const base = { id: 'd1', hostname: `acme.${PLATFORM_ROOT}`, type: 'SUBDOMAIN', isDefault: true, isPrimary: true, status: 'VERIFIED', createdAt: '2026-11-01T00:00:00Z' };

it('default domain: shows the current address and switches to a new available subdomain', async () => {
  workspaceApi.domains.mockResolvedValue([base]);
  workspaceApi.subdomainAvailability.mockResolvedValue({ available: true, hostname: `speakwithacme.${PLATFORM_ROOT}` });
  workspaceApi.addSubdomain.mockResolvedValue({ id: 'd2', hostname: `speakwithacme.${PLATFORM_ROOT}` });
  workspaceApi.makePrimary.mockResolvedValue({});
  wrap();
  const input = await screen.findByLabelText('Subdomain name');
  await waitFor(() => expect(input).toHaveValue('acme'));
  expect(screen.getByText('Primary domain')).toBeInTheDocument();
  expect(screen.getByText('1/3 used')).toBeInTheDocument();
  await userEvent.clear(input);
  await userEvent.type(input, 'speakwithacme');
  expect(await screen.findByText('Available')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(workspaceApi.addSubdomain).toHaveBeenCalledWith('speakwithacme'));
  await waitFor(() => expect(workspaceApi.makePrimary).toHaveBeenCalledWith('d2'));
});

it('custom domain via Cloudflare shows the DNS-only steps and adds the domain', async () => {
  workspaceApi.domains.mockResolvedValue([base]);
  workspaceApi.addDomain.mockResolvedValue({ id: 'd3' });
  wrap();
  await userEvent.click(await screen.findByRole('button', { name: /Cloudflare/ }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Link a domain on Cloudflare')).toBeInTheDocument();
  expect(within(dialog).getByText('DNS only')).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText('Domain'), 'learn.acme.com');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add domain' }));
  await waitFor(() => expect(workspaceApi.addDomain).toHaveBeenCalledWith('learn.acme.com'));
});
