import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { NotificationBell } from './NotificationBell.jsx';
import { notificationsApi } from '../../services/api/notifications.js';

vi.mock('../../services/api/notifications.js', () => ({ notificationsApi: { list: vi.fn(), read: vi.fn(async () => ({})), readAll: vi.fn(async () => ({})) } }));

it('shows the unread count and opens a notification link, marking it read', async () => {
  notificationsApi.list.mockResolvedValue({ unread: 1, nextCursor: null, items: [{ id: 'n1', title: 'Your certificate is ready', body: 'Congrats', link: '/learn/certificates', readAt: null, createdAt: '2026-11-05T10:00:00Z' }] });
  const router = createMemoryRouter([{ path: '/', element: <NotificationBell settingsTo="/learn/account/notifications" /> }, { path: '*', element: <div>other</div> }]);
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>);
  const bell = await screen.findByRole('button', { name: /1 unread/ });
  await userEvent.click(bell);
  await userEvent.click(await screen.findByText('Your certificate is ready'));
  await waitFor(() => expect(router.state.location.pathname).toBe('/learn/certificates'));
  expect(notificationsApi.read.mock.calls[0][0]).toBe('n1');
});
