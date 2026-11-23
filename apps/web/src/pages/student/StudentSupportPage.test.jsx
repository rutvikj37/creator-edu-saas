import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { StudentSupportPage } from './StudentSupportPage.jsx';
import { learnChatApi } from '../../services/api/chat.js';

vi.mock('../../services/api/chat.js', () => ({ learnChatApi: { send: vi.fn() } }));

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter>
        <StudentSupportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StudentSupportPage', () => {
  it('sends the request to the academy team through student chat', async () => {
    learnChatApi.send.mockResolvedValue({ id: 'm1' });
    renderPage();
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Video will not play' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Lesson 3 shows a black screen.' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));
    await waitFor(() => expect(learnChatApi.send).toHaveBeenCalledWith('Support request: Video will not play\n\nLesson 3 shows a black screen.'));
    expect(await screen.findByText(/request sent/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /chat with us/i })[0]).toHaveAttribute('href', '/learn/chat');
  });

  it('does not claim success when sending fails', async () => {
    learnChatApi.send.mockRejectedValue(new Error('Network down'));
    renderPage();
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Help' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Something broke' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));
    await waitFor(() => expect(learnChatApi.send).toHaveBeenCalled());
    expect(screen.queryByText(/request sent/i)).not.toBeInTheDocument();
  });
});
