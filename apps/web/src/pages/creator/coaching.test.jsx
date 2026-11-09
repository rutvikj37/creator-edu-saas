import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CoachingPage } from './CoachingPage.jsx';
import { CoachingCreatePage } from './CoachingCreatePage.jsx';
import { MyCoachingPage } from '../student/MyCoachingPage.jsx';
import { coachingApi } from '../../services/api/coaching.js';

vi.mock('../../services/api/coaching.js', () => ({
  coachingApi: {
    stats: vi.fn(), programs: vi.fn(), program: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), bookings: vi.fn(), setBookingStatus: vi.fn(),
    team: vi.fn(), profile: vi.fn(), saveProfile: vi.fn(), connectGoogle: vi.fn(), disconnectGoogle: vi.fn(), mine: vi.fn(), slots: vi.fn(), book: vi.fn(), cancel: vi.fn(), attachment: vi.fn(),
  },
}));
vi.mock('../../services/api/commerce.js', () => ({ creatorCommerceApi: { gateway: vi.fn(async () => ({ configured: false, status: null })) } }));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ status: 'authenticated', user: { id: 'u'.repeat(25) }, can: () => true }) }));
vi.mock('../../components/forms/RichTextEditor.jsx', () => ({
  RichTextEditor: ({ label, onChange }) => <label>{label ?? 'Editor'}<textarea aria-label={label ?? 'Rich text'} onChange={(e) => onChange({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: e.target.value }] }] })} /></label>,
}));
vi.mock('../../components/forms/FileUpload.jsx', () => ({ FileUpload: ({ label }) => <button type="button">{label}</button> }));

const ME = 'u'.repeat(25);
function wrap(routes, path) {
  const router = createMemoryRouter([...routes, { path: '*', element: <p>elsewhere</p> }], { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}
afterEach(() => vi.clearAllMocks());

const profile = { userId: ME, name: 'Asha Creator', email: 'asha@example.com', displayName: 'Coach Asha', bio: 'Ten years in hiring.', photoFileId: null, photoUrl: null, google: { configured: true, connected: false, email: null, error: null }, timezone: 'UTC', meetingUrl: null, minNoticeHours: 12, bufferMin: 0, hours: [], configured: true };

it('coaching page shows totals, the payments banner, bookings and the coach settings card', async () => {
  coachingApi.stats.mockResolvedValue({ totalBookings: 3, upcomingBookings: 2, totalRevenue: '2997', currency: 'INR' });
  coachingApi.programs.mockResolvedValue([]);
  coachingApi.bookings.mockResolvedValue({ items: [{ id: 'b1', startsAt: '2026-11-20T09:00:00Z', endsAt: '2026-11-20T10:00:00Z', status: 'BOOKED', meetingUrl: 'https://meet.google.com/abc', student: { name: 'Ravi Learner', email: 'ravi@example.com' }, coach: { name: 'Coach Asha' }, program: { title: 'Interview prep' }, session: { title: 'Mock interview' } }], meta: { page: 1, pageSize: 20, total: 1 } });
  coachingApi.team.mockResolvedValue([{ userId: ME, name: 'Coach Asha', email: 'asha@example.com', hasHours: true, isCoach: true }]);
  coachingApi.profile.mockResolvedValue(profile);
  coachingApi.saveProfile.mockResolvedValue({ ...profile, bio: 'Hiring coach.' });
  wrap([{ path: '/creator/coaching', element: <CoachingPage /> }], '/creator/coaching');
  expect(await screen.findByText('3')).toBeInTheDocument();
  expect(screen.getByText('2 upcoming')).toBeInTheDocument();
  expect(await screen.findByText('Set up payments to receive money')).toBeInTheDocument();
  expect((await screen.findAllByText('Ravi Learner')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Mock interview').length).toBeGreaterThan(0);
  expect(coachingApi.bookings).toHaveBeenCalledWith(expect.objectContaining({ when: 'upcoming', page: 1 }));

  await userEvent.click(screen.getByRole('button', { name: 'Coaching settings' }));
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText('Coach Asha', { selector: 'span' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Connect Google Calendar' })).toBeEnabled();
  expect(within(dialog).getByLabelText('Email ID')).toBeDisabled();
  expect(within(dialog).getByText('Email can’t be changed')).toBeInTheDocument();
  const bio = within(dialog).getByLabelText('About the coach');
  await userEvent.clear(bio);
  await userEvent.type(bio, 'Hiring coach.');
  expect(within(dialog).getByText('13/400')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(coachingApi.saveProfile).toHaveBeenCalledWith(undefined, { displayName: 'Coach Asha', bio: 'Hiring coach.', photoFileId: null }));
});

it('wizard saves the landing page, program details and pricing, then publishes', async () => {
  coachingApi.team.mockResolvedValue([{ userId: ME, name: 'Coach Asha', email: 'asha@example.com', hasHours: true }, { userId: 'v'.repeat(25), name: 'Second Coach', email: 'two@example.com', hasHours: true }]);
  coachingApi.create.mockResolvedValue({ id: 'p1', sessions: [] });
  coachingApi.update.mockResolvedValueOnce({ id: 'p1', sessions: [{ id: 's1' }] }).mockResolvedValueOnce({ id: 'p1', sessions: [{ id: 's1' }] });
  coachingApi.setStatus.mockResolvedValue({ id: 'p1', status: 'PUBLISHED' });
  const router = wrap([{ path: '/creator/coaching/new', element: <CoachingCreatePage /> }, { path: '/creator/coaching', element: <p>list</p> }], '/creator/coaching/new');

  // Step 1: name is required.
  await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
  expect(await screen.findByText('Name your coaching program')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Program name'), 'Career Mentorship');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await userEvent.type(screen.getByLabelText('Question 1'), 'Online?');
  await userEvent.type(screen.getByLabelText('Answer 1'), 'Yes');
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(coachingApi.create).toHaveBeenCalledWith({ title: 'Career Mentorship', description: null, coverFileId: null, faqs: [{ question: 'Online?', answer: 'Yes' }] }));

  // Step 2: add a second coach at 2×, write the agenda, set 1 hour.
  expect(await screen.findByRole('heading', { name: 'Program details' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Add coach' }));
  await userEvent.selectOptions(screen.getByLabelText('Weight for coach 2'), '2');
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByText('Write an agenda for every session')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Agenda *'), 'Goals');
  await userEvent.clear(screen.getByLabelText('Session 1 duration'));
  await userEvent.type(screen.getByLabelText('Session 1 duration'), '1');
  await userEvent.selectOptions(screen.getByLabelText('Session 1 duration unit'), 'hr');
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(coachingApi.update).toHaveBeenCalledWith('p1', expect.objectContaining({
    coaches: [{ userId: ME, weight: 1 }, { userId: 'v'.repeat(25), weight: 2 }],
    sessions: [expect.objectContaining({ title: 'Session 1', durationMin: 60, notes: null, attachmentIds: [] })],
  })));

  // Step 3: price 1499 with sale price 999 → charges 999, shows 1499 struck; preview updates.
  expect(await screen.findByRole('heading', { name: 'Set up pricing' })).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Plan name'), 'Mentorship pack');
  await userEvent.type(screen.getByLabelText('Price'), '1499');
  await userEvent.type(screen.getByLabelText('Sale price'), '999');
  expect(screen.getByText('33% off')).toBeInTheDocument();
  expect(screen.getAllByText('Mentorship pack').length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(coachingApi.update).toHaveBeenLastCalledWith('p1', { planName: 'Mentorship pack', priceAmount: 999, compareAtAmount: 1499, passTransactionFee: false }));
  await waitFor(() => expect(coachingApi.setStatus).toHaveBeenCalledWith('p1', 'PUBLISHED'));
  await waitFor(() => expect(router.state.location.pathname).toBe('/creator/coaching'));
});

it('student picks a day and time and books a session', async () => {
  coachingApi.mine.mockResolvedValue([{ id: 'p1', title: 'Interview prep', coverUrl: null, sessions: [{ id: 's1', title: 'Mock interview', durationMin: 60, agenda: null, notes: 'Bring your CV', attachments: [], booking: null }] }]);
  coachingApi.slots.mockResolvedValue({ durationMin: 60, slots: ['2026-11-20T04:30:00.000Z', '2026-11-20T05:00:00.000Z', '2026-11-21T04:30:00.000Z'] });
  coachingApi.book.mockResolvedValue({ id: 'b1', coachName: 'Coach Asha' });
  wrap([{ path: '/', element: <MyCoachingPage /> }], '/');
  expect(await screen.findByText('0 of 1 sessions booked')).toBeInTheDocument();
  expect(screen.getByText('Prepare: Bring your CV')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Book a time' }));
  const dialog = await screen.findByRole('dialog');
  const days = await within(dialog).findAllByRole('tab');
  expect(days).toHaveLength(2);
  expect(within(dialog).getByRole('button', { name: 'Confirm booking' })).toBeDisabled();
  await userEvent.click(within(dialog).getAllByRole('radio')[1]);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm booking' }));
  await waitFor(() => expect(coachingApi.book).toHaveBeenCalledWith('p1', { sessionId: 's1', startsAt: '2026-11-20T05:00:00.000Z' }));
});
