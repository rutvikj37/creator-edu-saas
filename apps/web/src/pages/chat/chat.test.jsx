import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CreatorChatInboxPage, StudentChatPage } from './ChatPages.jsx';
import { creatorChatApi, learnChatApi } from '../../services/api/chat.js';

const thread = {
  load: vi.fn(), older: vi.fn(), poll: vi.fn(), send: vi.fn(), read: vi.fn(async () => ({ read: true })), setStatus: vi.fn(),
};
vi.mock('../../services/api/chat.js', () => ({
  learnChatApi: { load: vi.fn(), older: vi.fn(), poll: vi.fn(), send: vi.fn(), read: vi.fn(async () => ({ read: true })) },
  supportChatApi: {},
  creatorChatApi: { list: vi.fn(), thread: vi.fn() },
  platformChatApi: { list: vi.fn(), thread: vi.fn() },
}));

const never = () => new Promise(() => {});
function wrap(element, path = '/') {
  const router = createMemoryRouter([{ path: '/', element }], { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}
afterEach(() => vi.clearAllMocks());

it('student sees history, receives a reply through the long poll, and sends a message', async () => {
  learnChatApi.load.mockResolvedValue({ conversation: { id: 'c1', status: 'OPEN' }, messages: [{ id: 'm1', side: 'customer', body: 'Hello there', senderName: 'Riya', createdAt: '2026-11-06T10:00:00Z' }], hasMore: false, unread: 0 });
  learnChatApi.poll
    .mockResolvedValueOnce({ messages: [{ id: 'm2', side: 'agent', body: 'Hi Riya, how can we help?', senderName: 'Team', createdAt: '2026-11-06T10:01:00Z' }], status: 'OPEN' })
    .mockImplementation(never);
  learnChatApi.send.mockResolvedValue({ id: 'm3', side: 'customer', body: 'Where is my certificate?', senderName: 'Riya', createdAt: '2026-11-06T10:02:00Z' });
  wrap(<StudentChatPage />);
  expect(await screen.findByText('Hello there')).toBeInTheDocument();
  expect(await screen.findByText('Hi Riya, how can we help?')).toBeInTheDocument();
  expect(learnChatApi.poll).toHaveBeenCalledWith('m1', true, expect.any(AbortSignal));
  await waitFor(() => expect(learnChatApi.read).toHaveBeenCalled()); // agent message seen
  await waitFor(() => expect(learnChatApi.poll).toHaveBeenLastCalledWith('m2', true, expect.any(AbortSignal)));

  const input = screen.getByLabelText('Message');
  await userEvent.type(input, 'Where is my certificate?{Enter}');
  await waitFor(() => expect(learnChatApi.send).toHaveBeenCalledWith('Where is my certificate?'));
  expect(await screen.findByText('Where is my certificate?')).toBeInTheDocument();
  expect(input).toHaveValue('');
});

it('staff inbox searches, opens a conversation with its contact header, replies and closes it', async () => {
  creatorChatApi.list.mockResolvedValue({ items: [{ id: 'c1', status: 'OPEN', unread: 2, lastMessagePreview: 'Need help with payment', lastMessageAt: '2026-11-06T10:00:00Z', customer: { name: 'Riya Student', email: 'riya@example.com' } }], total: 1, page: 1, pages: 1, unreadConversations: 1 });
  creatorChatApi.thread.mockReturnValue(thread);
  thread.load.mockResolvedValue({ conversation: { id: 'c1', status: 'OPEN' }, messages: [{ id: 'm1', side: 'customer', body: 'My payment failed', senderName: 'Riya Student', createdAt: '2026-11-06T10:00:00Z' }], hasMore: false });
  thread.poll.mockImplementation(never);
  thread.send.mockResolvedValue({ id: 'm2', side: 'agent', body: 'Please try again now.', senderName: 'Owner', createdAt: '2026-11-06T10:01:00Z' });
  thread.setStatus.mockResolvedValue({ status: 'CLOSED' });
  const router = wrap(<CreatorChatInboxPage />);
  await waitFor(() => expect(screen.getByRole('heading', { name: /Inbox/ })).toHaveTextContent('Inbox1'));
  expect(creatorChatApi.list).toHaveBeenCalledWith({});
  await userEvent.type(screen.getByPlaceholderText('Search by name or email'), 'riya');
  await waitFor(() => expect(creatorChatApi.list).toHaveBeenLastCalledWith({ q: 'riya' }));
  await userEvent.click(within(screen.getByRole('list', { name: 'Conversations' })).getByRole('button', { name: /Riya Student/ }));
  expect(router.state.location.search).toContain('c=c1');
  expect(await screen.findByText('My payment failed')).toBeInTheDocument();
  expect(creatorChatApi.thread).toHaveBeenCalledWith('c1');
  expect(screen.getByText('riya@example.com')).toBeInTheDocument(); // contact header
  await waitFor(() => expect(thread.read).toHaveBeenCalled());

  await userEvent.type(screen.getByLabelText('Message'), 'Please try again now.');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText('Please try again now.')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Conversation actions' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Close conversation' }));
  await waitFor(() => expect(thread.setStatus).toHaveBeenCalledWith('CLOSED'));
  await userEvent.click(screen.getByRole('button', { name: 'Conversation actions' }));
  expect(await screen.findByRole('menuitem', { name: 'Reopen conversation' })).toBeInTheDocument();
  expect(screen.getByText(/This conversation is closed/)).toBeInTheDocument();
});
