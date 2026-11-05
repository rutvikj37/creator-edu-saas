import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { QuizRunner } from './QuizRunner.jsx';
import { VerifyCertificatePage } from '../public/VerifyCertificatePage.jsx';
import { catalogApi, learnApi } from '../../services/api/learn.js';

vi.mock('../../services/api/learn.js', () => ({
  learnApi: { quiz: vi.fn(), startQuiz: vi.fn(), attempt: vi.fn(), answer: vi.fn(), submitQuiz: vi.fn() },
  catalogApi: { verifyCertificate: vi.fn() },
}));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ surface: 'platform' }) }));
vi.mock('../../services/api/system.js', () => ({ systemApi: { info: vi.fn(async () => ({ name: 'Platform' })) } }));

const wrap = (ui, path = '/', route = '/') => {
  const router = createMemoryRouter([{ path: route, element: ui }], { initialEntries: [path] });
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
};

describe('QuizRunner', () => {
  it('starts an attempt, autosaves answers and shows the result', async () => {
    learnApi.quiz.mockResolvedValue({ quizId: 'qz', questionCount: 1, passPercent: 60, maxAttempts: 2, attemptsUsed: 0, attempts: [], openAttemptId: null, passed: false, timeLimitSeconds: null });
    const inProgress = { id: 'a1', attemptNo: 1, status: 'IN_PROGRESS', questions: [{ id: 'q1', type: 'MCQ_SINGLE', prompt: 'Pick A', points: 1, options: [{ id: 'oA', label: 'A' }, { id: 'oB', label: 'B' }], response: null }] };
    learnApi.startQuiz.mockResolvedValue(inProgress);
    learnApi.attempt.mockResolvedValue(inProgress);
    learnApi.answer.mockResolvedValue({ saved: true });
    learnApi.submitQuiz.mockResolvedValue({ ...inProgress, status: 'GRADED', score: 1, maxScore: 1, percent: 100, passed: true, passPercent: 60, questions: [{ ...inProgress.questions[0], isCorrect: true, pointsAwarded: 1, options: [{ id: 'oA', label: 'A', isCorrect: true }, { id: 'oB', label: 'B', isCorrect: false }] }] });
    const onPassed = vi.fn();
    wrap(<QuizRunner lessonId="l1" onPassed={onPassed} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Start quiz' }));
    await userEvent.click(await screen.findByLabelText('A'));
    expect(learnApi.answer).toHaveBeenCalledWith('a1', { questionId: 'q1', response: { optionId: 'oA' } });
    await userEvent.click(screen.getByRole('button', { name: 'Submit quiz' }));
    expect(await screen.findByText('You passed!')).toBeInTheDocument();
    expect(onPassed).toHaveBeenCalled();
  });

  it('blocks new attempts when the limit is reached', async () => {
    learnApi.quiz.mockResolvedValue({ quizId: 'qz', questionCount: 1, passPercent: 60, maxAttempts: 1, attemptsUsed: 1, attempts: [{ id: 'a1', attemptNo: 1, status: 'GRADED', percent: 0, passed: false }], openAttemptId: null, passed: false });
    wrap(<QuizRunner lessonId="l1" />);
    expect(await screen.findByText('You have used all attempts.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled();
  });
});

describe('VerifyCertificatePage', () => {
  it('shows valid and revoked certificates', async () => {
    catalogApi.verifyCertificate.mockResolvedValueOnce({ valid: true, recipientName: 'Lena', courseTitle: 'Data 101', academyName: 'Acme', issuedAt: '2026-11-01T00:00:00Z' });
    wrap(<VerifyCertificatePage />, '/verify/CE-2026-AAAA', '/verify/:number');
    expect(await screen.findByText('Valid certificate')).toBeInTheDocument();
    expect(screen.getByText('Lena')).toBeInTheDocument();
  });
  it('shows revoked status', async () => {
    catalogApi.verifyCertificate.mockResolvedValueOnce({ valid: false, status: 'REVOKED', revokedAt: '2026-11-02T00:00:00Z' });
    wrap(<VerifyCertificatePage />, '/verify/CE-2026-BBBB', '/verify/:number');
    expect(await screen.findByText(/was revoked/)).toBeInTheDocument();
  });
});
