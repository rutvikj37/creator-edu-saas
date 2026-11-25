import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { StudentHomePage, expiringEnrollments, upcomingCoachingBookings } from './StudentHomePage.jsx';
import { learnApi } from '../../services/api/learn.js';
import { learnLiveApi } from '../../services/api/live.js';
import { coachingApi } from '../../services/api/coaching.js';

vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { fullName: 'Riya Sharma' } }) }));
vi.mock('../../services/api/learn.js', () => ({
  learnApi: { enrollments: vi.fn(), certificates: vi.fn() },
}));
vi.mock('../../services/api/live.js', () => ({
  learnLiveApi: { upcoming: vi.fn() },
}));
vi.mock('../../services/api/coaching.js', () => ({
  coachingApi: { mine: vi.fn() },
}));
vi.mock('../../components/account/EmailVerificationBanner.jsx', () => ({
  EmailVerificationBanner: () => null,
}));

function wrap(el) {
  const router = createMemoryRouter([{ path: '/', element: el }], { initialEntries: ['/'] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

it('renders stats, resume hero and quick links', async () => {
  learnApi.enrollments.mockResolvedValue([
    {
      id: 'e1',
      usable: true,
      completedAt: null,
      lastAccessedAt: '2026-11-20T10:00:00Z',
      progressPercent: 42,
      course: { id: 'c1', title: 'GST Basics', slug: 'gst' },
    },
  ]);
  learnApi.certificates.mockResolvedValue([{ id: 'k1', status: 'ISSUED' }]);
  learnLiveApi.upcoming.mockResolvedValue([]);
  coachingApi.mine.mockResolvedValue([]);
  wrap(<StudentHomePage />);
  expect(await screen.findByText('Hi, Riya')).toBeInTheDocument();
  expect(screen.getByText('In progress')).toBeInTheDocument();
  expect(screen.getByText('Continue learning')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Resume' })).toHaveAttribute('href', '/learn/courses/c1');
  expect(screen.getByRole('link', { name: 'Certificates' })).toHaveAttribute('href', '/learn/certificates');
});

it('helper: expiring enrollments within 14 days', () => {
  const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
  const late = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const rows = expiringEnrollments([
    { id: 'a', usable: true, completedAt: null, expiresAt: soon, course: { title: 'A' } },
    { id: 'b', usable: true, completedAt: null, expiresAt: late, course: { title: 'B' } },
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe('a');
});

it('helper: upcoming coaching bookings', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const list = upcomingCoachingBookings([
    {
      id: 'p1',
      title: 'Career',
      sessions: [
        { id: 's1', title: 'Kickoff', booking: { id: 'b1', status: 'BOOKED', startsAt: future, endsAt: future, coachName: 'Sam' } },
        { id: 's2', title: 'Done', booking: { id: 'b2', status: 'BOOKED', startsAt: past, endsAt: past } },
      ],
    },
  ]);
  expect(list).toHaveLength(1);
  expect(list[0].sessionTitle).toBe('Kickoff');
});