import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { MarketingPage } from './MarketingPage.jsx';
import { marketingApi, parseContacts } from '../../services/api/marketing.js';

vi.mock('../../services/api/marketing.js', async (orig) => ({ ...(await orig()), marketingApi: { leads: vi.fn(), campaigns: vi.fn(), campaign: vi.fn(), importLeads: vi.fn() } }));
vi.mock('../../services/api/creator.js', () => ({ coursesApi: { list: vi.fn(async () => ({ items: [] })) } }));
vi.mock('../../services/api/live.js', () => ({ batchesApi: { list: vi.fn(async () => []) } }));
vi.mock('../../components/forms/RichTextEditor.jsx', () => ({ RichTextEditor: () => <div>editor</div> }));

const wrap = (path) => {
  const router = createMemoryRouter([{ path: '/creator/marketing', element: <MarketingPage /> }], { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
};

it('parses pasted contacts, skipping a header row', () => {
  expect(parseContacts('email,name,tags\npriya@example.com, Priya, webinar;vip\nraj@example.com')).toEqual([{ email: 'priya@example.com', name: 'Priya', tags: ['webinar', 'vip'] }, { email: 'raj@example.com' }]);
});

it('imports without consent unless the creator confirms it', async () => {
  marketingApi.leads.mockResolvedValue({ items: [], meta: { page: 1, pageSize: 20, total: 0 } });
  marketingApi.importLeads.mockResolvedValue({ created: 1, updated: 0, invalid: [] });
  wrap('/creator/marketing');
  await userEvent.click(await screen.findByRole('button', { name: 'Import' }));
  await userEvent.type(screen.getByLabelText(/Paste contacts/), 'a@example.com');
  await userEvent.click(screen.getByRole('button', { name: 'Import 1' }));
  await waitFor(() => expect(marketingApi.importLeads).toHaveBeenCalledWith([{ email: 'a@example.com' }], false));
});

it('shows how many contacts a campaign reaches and how many are excluded without consent', async () => {
  marketingApi.campaigns.mockResolvedValue([{ id: 'c1', name: 'News', subject: 'Hello', status: 'DRAFT', stats: null }]);
  marketingApi.campaign.mockResolvedValue({ id: 'c1', name: 'News', subject: 'Hello', previewText: null, content: { type: 'doc', content: [] }, segment: { type: 'all' }, status: 'DRAFT', audience: { recipients: 2, excludedWithoutConsent: 3 } });
  wrap('/creator/marketing?tab=campaigns');
  await userEvent.click(await screen.findByText('News'));
  expect(await screen.findByText(/3 without consent are left out/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send now' })).toBeEnabled();
});
