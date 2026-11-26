import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderWithApp } from '../../test/render.jsx';
import { AssignmentsPage, QuizReviewsPage, TestReportsPage, WebinarsReportPage } from './AssessmentPages.jsx';
import { creatorLearnApi } from '../../services/api/learn.js';
import { creatorLiveApi } from '../../services/api/live.js';

vi.mock('../../services/api/learn.js', () => ({
  creatorLearnApi: { testReport: vi.fn(), quizReviews: vi.fn(), allSubmissions: vi.fn(), attempts: vi.fn(async () => []), attemptDetail: vi.fn(), gradeAttempt: vi.fn(), gradeSubmission: vi.fn() },
}));
vi.mock('../../services/api/creator.js', () => ({ coursesApi: { list: vi.fn(async () => ({ items: [{ id: 'c1', title: 'Communication course' }] })) } }));
vi.mock('../../services/api/live.js', () => ({ creatorLiveApi: { webinarReport: vi.fn() } }));

const student = { id: 'u1', fullName: 'Asha Learner', email: 'asha@example.test' };
const render = (el) => renderWithApp([{ path: '/', element: el }]);

afterEach(() => vi.clearAllMocks());

it('test reports: totals, per-quiz rows and the course filter', async () => {
  creatorLearnApi.testReport.mockResolvedValue({
    totals: { quizzes: 2, candidates: 3, completions: 5, pendingReview: 1 },
    items: [{ quizId: 'q1', lessonTitle: 'Checkpoint quiz', courseTitle: 'Communication course', candidates: 3, completions: 4, passed: 2, averagePercent: 72.5, pendingReview: 1 }],
  });
  render(<TestReportsPage />);
  expect((await screen.findAllByText('Checkpoint quiz'))[0]).toBeInTheDocument();
  expect(screen.getByText('Total completions').parentElement).toHaveTextContent('5');
  expect(screen.getByRole('link', { name: 'Review answers' })).toHaveAttribute('href', '/creator/quiz-reviews');
  expect(screen.getAllByText('73%')[0]).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Course' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Communication course' }));
  await waitFor(() => expect(creatorLearnApi.testReport).toHaveBeenLastCalledWith('c1'));
});

it('quiz reviews: lists attempts waiting for grading and switches to reviewed', async () => {
  creatorLearnApi.quizReviews.mockImplementation(async (p) => (p.status === 'GRADED'
    ? { waiting: 1, items: [] }
    : { waiting: 1, items: [{ id: 'a1', lessonTitle: 'Checkpoint quiz', courseTitle: 'Communication course', submittedAt: '2026-11-20T10:00:00Z', percent: 50, status: 'SUBMITTED', student }] }));
  render(<QuizReviewsPage />);
  expect((await screen.findAllByText('Asha Learner'))[0]).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /To review/ })).toHaveTextContent('1');
  expect(screen.getAllByRole('button', { name: 'Review' })[0]).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Reviewed' }));
  expect(await screen.findByText('No reviewed attempts yet')).toBeInTheDocument();
  expect(creatorLearnApi.quizReviews).toHaveBeenLastCalledWith({ status: 'GRADED' });
});

it('assignments: totals, submissions and grading from the list', async () => {
  creatorLearnApi.allSubmissions.mockResolvedValue({
    totals: { assignments: 1, submissions: 2, toReview: 1, graded: 1, returned: 0 },
    items: [{ id: 's1', lessonTitle: 'Homework', courseTitle: 'Communication course', submittedAt: '2026-11-20T10:00:00Z', isLate: true, status: 'SUBMITTED', points: null, maxPoints: 10, text: 'My answer', files: [], student }],
  });
  creatorLearnApi.gradeSubmission.mockResolvedValue({});
  render(<AssignmentsPage />);
  expect((await screen.findAllByText('Homework'))[0]).toBeInTheDocument();
  expect(screen.getAllByText('Late')[0]).toBeInTheDocument();
  expect(creatorLearnApi.allSubmissions).toHaveBeenCalledWith({ status: 'SUBMITTED' });
  await userEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('My answer')).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText('Points (max 10)'), '8');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(creatorLearnApi.gradeSubmission).toHaveBeenCalledWith('s1', { points: 8, feedback: undefined, status: 'GRADED' }));
});

it('webinars report: 30-day totals and the upcoming / past tabs', async () => {
  creatorLiveApi.webinarReport.mockImplementation(async (period) => ({
    last30Days: { registrations: 12, participants: 7, revenue: '2499.00' },
    counts: { upcoming: 1, past: 2 },
    items: period === 'upcoming' ? [{ id: 'w1', title: 'Astrology basics', startsAt: '2026-12-01T10:00:00Z', registrations: 12, attendees: 0, revenue: '2499.00', currency: 'INR' }] : [],
  }));
  render(<WebinarsReportPage />);
  expect((await screen.findAllByRole('link', { name: /Astrology basics/ }))[0]).toHaveAttribute('href', '/creator/live/w1');
  expect(screen.getByText('Participants').parentElement).toHaveTextContent('7');
  await userEvent.click(screen.getByRole('tab', { name: /Past/ }));
  expect(await screen.findByText('No past webinars')).toBeInTheDocument();
  expect(creatorLiveApi.webinarReport).toHaveBeenLastCalledWith('past');
});
