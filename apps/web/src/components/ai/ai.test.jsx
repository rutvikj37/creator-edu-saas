import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { AiDraftButton, AiQuizGenerator, TutorPanel } from './AiTools.jsx';
import { AiStudioPage } from '../../pages/creator/AiStudioPage.jsx';
import { aiApi } from '../../services/api/ai.js';
import { creatorLearnApi } from '../../services/api/learn.js';

vi.mock('../../services/api/ai.js', () => ({ aiApi: { usage: vi.fn(), settings: vi.fn(), saveSettings: vi.fn(), outline: vi.fn(), applyOutline: vi.fn(), lessonDraft: vi.fn(), quizQuestions: vi.fn(), tutorStatus: vi.fn(), ask: vi.fn() } }));
vi.mock('../../services/api/creator.js', () => ({ coursesApi: {
  list: vi.fn(async () => ({ items: [{ id: 'c1', title: 'Investing 101' }] })),
  curriculum: vi.fn(async () => [{ id: 's1', lessons: [{ id: 'l1', title: 'Index funds', type: 'TEXT', children: [] }, { id: 'q1', title: 'Quiz', type: 'QUIZ', children: [] }] }]),
} }));
vi.mock('../../services/api/learn.js', () => ({ creatorLearnApi: { addQuestion: vi.fn(async () => ({ id: 'quiz', questions: [] })) } }));

const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft' }] }] };

it('lesson draft: warns before replacing content and passes the draft up', async () => {
  aiApi.lessonDraft.mockResolvedValue({ content: doc, credits: 4 });
  const onDraft = vi.fn();
  wrap(<AiDraftButton courseId="c1" lessonId="l1" hasContent onDraft={onDraft} />);
  await userEvent.click(screen.getByRole('button', { name: 'Draft with AI' }));
  expect(screen.getByText(/replaces what is in the editor/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText(/Instructions/), 'Use Indian examples');
  await userEvent.click(screen.getByRole('button', { name: 'Write draft' }));
  await waitFor(() => expect(onDraft).toHaveBeenCalledWith(doc));
  expect(aiApi.lessonDraft.mock.calls[0][0]).toEqual({ courseId: 'c1', lessonId: 'l1', notes: 'Use Indian examples' });
});

it('quiz generator: offers only text lessons and adds the picked questions', async () => {
  const qs = [0, 1].map((i) => ({ type: 'MCQ_SINGLE', prompt: `Question ${i}`, explanation: null, options: [{ label: `Right ${i}`, isCorrect: true }, { label: `Wrong ${i}`, isCorrect: false }] }));
  aiApi.quizQuestions.mockResolvedValue({ questions: qs, credits: 3 });
  wrap(<AiQuizGenerator courseId="c1" lessonId="q1" />);
  await userEvent.click(screen.getByRole('button', { name: 'Generate with AI' }));
  const select = await screen.findByLabelText('From lesson');
  await waitFor(() => expect(screen.getByRole('option', { name: 'Index funds' })).toBeInTheDocument());
  expect(screen.queryByRole('option', { name: 'Quiz' })).toBeNull();
  await userEvent.selectOptions(select, 'l1');
  await userEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await userEvent.click(await screen.findByLabelText('Question 1')); // untick one
  await userEvent.click(screen.getByRole('button', { name: 'Add 1 question' }));
  await waitFor(() => expect(creatorLearnApi.addQuestion).toHaveBeenCalledTimes(1));
  expect(creatorLearnApi.addQuestion).toHaveBeenCalledWith('c1', 'q1', qs[0]);
});

it('tutor: sends history and shows the daily allowance', async () => {
  aiApi.tutorStatus.mockResolvedValue({ enabled: true, remainingToday: 2 });
  aiApi.ask.mockResolvedValueOnce({ answer: 'It tracks an index.', remainingToday: 1 }).mockResolvedValueOnce({ answer: 'Monthly investing.', remainingToday: 0 });
  wrap(<TutorPanel lessonId="l1" />);
  await userEvent.type(await screen.findByLabelText('Ask the study assistant'), 'What is an index fund?');
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(await screen.findByText('It tracks an index.')).toBeInTheDocument();
  expect(screen.getByText('1 question left today')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Ask the study assistant'), 'And SIPs?');
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
  await screen.findByText('Monthly investing.');
  expect(aiApi.ask.mock.calls[1][0]).toEqual({ lessonId: 'l1', question: 'And SIPs?', history: [{ role: 'user', content: 'What is an index fund?' }, { role: 'assistant', content: 'It tracks an index.' }] });
  expect(screen.getByLabelText('Ask the study assistant')).toBeDisabled();
});

it('studio: shows credits and that AI is not configured; generates and applies an outline', async () => {
  aiApi.usage.mockResolvedValue({ configured: false, included: true, limit: 1000, used: 250, periodEnd: '2026-11-30T18:30:00Z', byFeature: [], recent: [] });
  aiApi.settings.mockResolvedValue({ enabled: false, dailyLimit: 20 });
  aiApi.outline.mockResolvedValue({ sections: [{ title: 'Basics', lessons: [{ title: 'What is a fund?', summary: 'Explain funds.' }] }], credits: 6 });
  aiApi.applyOutline.mockResolvedValue({ sections: 1, lessons: 1 });
  wrap(<AiStudioPage />);
  expect(await screen.findByText(/not set up on this platform/)).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  await userEvent.type(screen.getByLabelText(/What is the course about/), 'Mutual funds for beginners');
  await userEvent.click(screen.getByRole('button', { name: 'Generate outline' }));
  expect(await screen.findByDisplayValue('Basics')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add to course as drafts' })).toBeDisabled();
  await userEvent.selectOptions(screen.getByLabelText('Add to course'), 'c1');
  await userEvent.click(screen.getByRole('button', { name: 'Add to course as drafts' }));
  await waitFor(() => expect(aiApi.applyOutline).toHaveBeenCalledWith('c1', [{ title: 'Basics', lessons: [{ title: 'What is a fund?', summary: 'Explain funds.' }] }]));
});
