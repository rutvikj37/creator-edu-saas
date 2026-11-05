import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { ReviewDialog } from './ReviewDialog.jsx';
import { CourseReviews } from './CourseReviews.jsx';
import { ReviewsPage } from '../../pages/creator/ReviewsPage.jsx';
import { reviewsApi } from '../../services/api/reviews.js';

vi.mock('../../services/api/reviews.js', () => ({ reviewsApi: { mine: vi.fn(), save: vi.fn(), remove: vi.fn(), publicList: vi.fn(), list: vi.fn(), reply: vi.fn(), setStatus: vi.fn() } }));
vi.mock('../../services/api/creator.js', () => ({ coursesApi: { list: vi.fn(async () => ({ items: [{ id: 'c1', title: 'Budgeting 101' }] })) } }));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ can: () => true }) }));

const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
afterEach(() => vi.clearAllMocks());

it('student rates a course; a hidden review shows the academy reason', async () => {
  reviewsApi.mine.mockResolvedValueOnce(null);
  reviewsApi.save.mockResolvedValue({ id: 'r1', rating: 4 });
  const onClose = vi.fn();
  wrap(<ReviewDialog courseId="c1" open onClose={onClose} />);
  const submit = await screen.findByRole('button', { name: 'Submit' });
  expect(submit).toBeDisabled();
  await userEvent.click(screen.getByLabelText('4 stars'));
  expect(screen.getByText('Very good')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Your review (optional)'), 'Clear lessons');
  await userEvent.click(submit);
  await waitFor(() => expect(reviewsApi.save).toHaveBeenCalledWith('c1', { rating: 4, title: null, body: 'Clear lessons' }));
  expect(onClose).toHaveBeenCalled();
});

it('student sees why a review was hidden and can delete it', async () => {
  reviewsApi.mine.mockResolvedValue({ id: 'r1', rating: 1, title: null, body: 'spam', status: 'HIDDEN', hiddenReason: 'Contains advertising', reply: null });
  reviewsApi.remove.mockResolvedValue({ deleted: true });
  wrap(<ReviewDialog courseId="c1" open onClose={() => {}} />);
  expect(await screen.findByText('Contains advertising')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(reviewsApi.remove).toHaveBeenCalledWith('c1'));
});

it('course page reviews: summary, distribution filter and replies', async () => {
  reviewsApi.publicList.mockImplementation(async (slug, params) => ({
    summary: { average: 4, count: 2, distribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 } },
    items: params.rating === 5 ? [{ id: 'a', rating: 5, title: 'Excellent', body: 'Loved it', author: 'Asha V.', reply: 'Thank you!', createdAt: '2026-11-05T10:00:00Z', edited: false }]
      : [{ id: 'a', rating: 5, title: 'Excellent', body: 'Loved it', author: 'Asha V.', reply: 'Thank you!', createdAt: '2026-11-05T10:00:00Z', edited: false }, { id: 'b', rating: 3, title: null, body: null, author: 'Bob', reply: null, createdAt: '2026-11-04T10:00:00Z', edited: true }],
    page: 1, total: 2, pages: 1,
  }));
  wrap(<CourseReviews slug="budgeting" />);
  expect(await screen.findByText('Student reviews')).toBeInTheDocument();
  expect(screen.getByText('2 ratings')).toBeInTheDocument();
  expect(screen.getByText('Thank you!')).toBeInTheDocument();
  expect(screen.getByText(/edited/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^5 stars: 50%/ }));
  await waitFor(() => expect(reviewsApi.publicList).toHaveBeenLastCalledWith('budgeting', { page: 1, rating: 5 }));
  await waitFor(() => expect(screen.queryByText('Bob')).toBeNull());
});

it('creator replies and hides a review with a reason', async () => {
  reviewsApi.list.mockResolvedValue({ total: 1, page: 1, pages: 1, average: 1, publishedCount: 1, items: [{ id: 'r9', rating: 1, title: null, body: 'Visit my site', status: 'PUBLISHED', hiddenReason: null, reply: null, createdAt: '2026-11-05T10:00:00Z', course: { id: 'c1', title: 'Budgeting 101' }, student: { name: 'Chitra Nair', email: 'c@example.test' } }] });
  reviewsApi.reply.mockResolvedValue({});
  reviewsApi.setStatus.mockResolvedValue({ status: 'HIDDEN' });
  wrap(<ReviewsPage />);
  expect(await screen.findByText('Visit my site')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
  let dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Reply'), 'Sorry to hear that');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Post reply' }));
  await waitFor(() => expect(reviewsApi.reply).toHaveBeenCalledWith('r9', 'Sorry to hear that'));
  await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
  dialog = await screen.findByRole('dialog', { name: 'Hide this review?' });
  const hide = within(dialog).getByRole('button', { name: 'Hide review' });
  expect(hide).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText('Reason'), 'Contains advertising');
  await userEvent.click(hide);
  await waitFor(() => expect(reviewsApi.setStatus).toHaveBeenCalledWith('r9', 'HIDDEN', 'Contains advertising'));
});
