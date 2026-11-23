import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { StudentSupportPage, StudentTicketPage } from './HelpdeskPages.jsx';
import { learnSupportApi } from '../../services/api/helpdesk.js';

vi.mock('../../services/api/helpdesk.js', () => ({
  learnSupportApi: { tickets: vi.fn(), ticket: vi.fn(), create: vi.fn(), reply: vi.fn(), close: vi.fn() },
  helpdeskApi: {},
}));

const wrap = (path) => {
  const router = createMemoryRouter([
    { path: '/learn/support', element: <StudentSupportPage /> },
    { path: '/learn/support/:id', element: <StudentTicketPage /> },
  ], { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
};

const ticket = (over = {}) => ({
  id: 't1', number: 7, subject: 'Video will not play', category: 'technical', status: 'PENDING', createdAt: '2026-11-09T05:00:00Z', lastActivityAt: '2026-11-09T05:10:00Z',
  messages: [
    { id: 'm1', body: 'Lesson 3 stays black.', isStaff: false, createdAt: '2026-11-09T05:00:00Z', author: { fullName: 'Riya' } },
    { id: 'm2', body: 'Please update the app.', isStaff: true, createdAt: '2026-11-09T05:10:00Z', author: { fullName: 'Asha' } },
  ],
  ...over,
});

it('student validates and opens a request, then lands on it', async () => {
  learnSupportApi.tickets.mockResolvedValue({ items: [], meta: { page: 1, pageSize: 20, total: 0 } });
  learnSupportApi.create.mockResolvedValue(ticket({ status: 'OPEN' }));
  learnSupportApi.ticket.mockResolvedValue(ticket({ status: 'OPEN' }));
  const router = wrap('/learn/support');
  await userEvent.click((await screen.findAllByRole('button', { name: 'New request' }))[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
  expect(await screen.findByText('At least 5 characters')).toBeInTheDocument();
  expect(learnSupportApi.create).not.toHaveBeenCalled();

  await userEvent.type(screen.getByLabelText('Subject'), 'Video will not play');
  await userEvent.selectOptions(screen.getByLabelText('Topic'), 'technical');
  await userEvent.type(screen.getByLabelText(/What do you need help with/), 'Lesson 3 stays black.');
  await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
  await waitFor(() => expect(learnSupportApi.create).toHaveBeenCalledWith({ subject: 'Video will not play', category: 'technical', body: 'Lesson 3 stays black.' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/learn/support/t1'));
});

it('ticket page shows the academy reply, sends a reply and hides the composer once closed', async () => {
  learnSupportApi.ticket.mockResolvedValue(ticket());
  learnSupportApi.reply.mockResolvedValue(ticket({ status: 'OPEN' }));
  learnSupportApi.close.mockResolvedValue(ticket({ status: 'CLOSED' }));
  wrap('/learn/support/t1');
  expect(await screen.findByText('Please update the app.')).toBeInTheDocument();
  expect(screen.getByText('Academy team')).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('Reply'), 'Still black');
  await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
  await waitFor(() => expect(learnSupportApi.reply).toHaveBeenCalledWith('t1', 'Still black'));

  await userEvent.click(screen.getByRole('button', { name: 'Close request' }));
  await userEvent.click((await screen.findAllByRole('button', { name: 'Close request' })).at(-1));
  expect(await screen.findByText('This request is closed.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send reply' })).not.toBeInTheDocument();
});
