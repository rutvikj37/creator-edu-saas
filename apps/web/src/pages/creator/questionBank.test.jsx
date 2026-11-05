import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { QuestionBankPage } from './QuestionBankPage.jsx';
import { QuizEditor } from './QuizEditor.jsx';
import { questionBankApi } from '../../services/api/questionBank.js';
import { creatorLearnApi } from '../../services/api/learn.js';

vi.mock('../../services/api/questionBank.js', () => ({ questionBankApi: { list: vi.fn(), tags: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), addToQuiz: vi.fn(), saveToBank: vi.fn() } }));
vi.mock('../../services/api/learn.js', () => ({ creatorLearnApi: { quiz: vi.fn(), attempts: vi.fn(async () => []), addQuestion: vi.fn(), updateQuestion: vi.fn(), removeQuestion: vi.fn(), quizSettings: vi.fn() } }));
vi.mock('../../components/ai/AiTools.jsx', () => ({ AiQuizGenerator: () => null }));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ can: () => true }) }));

const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const bankQ = (id, prompt, tags = ['algebra']) => ({ id, type: 'MCQ_SINGLE', prompt, points: 1, options: [{ label: 'a', isCorrect: true }, { label: 'b', isCorrect: false }], meta: null, tags, usedInQuizzes: 0 });
afterEach(() => vi.clearAllMocks());

it('bank page: creates a question with tags and filters by tag', async () => {
  questionBankApi.list.mockResolvedValue({ items: [bankQ('b1', '2 + 2 = ?', ['arithmetic'])], total: 1, page: 1, pages: 1 });
  questionBankApi.tags.mockResolvedValue([{ tag: 'arithmetic', count: 1 }]);
  questionBankApi.create.mockResolvedValue({ id: 'b2' });
  wrap(<QuestionBankPage />);
  expect(await screen.findByText('2 + 2 = ?')).toBeInTheDocument();
  expect(screen.getByText('arithmetic')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Tag'), 'arithmetic');
  await waitFor(() => expect(questionBankApi.list).toHaveBeenLastCalledWith({ tag: 'arithmetic', page: 1 }));
  await userEvent.click(screen.getByRole('button', { name: 'New question' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Question'), '3 × 3 = ?');
  await userEvent.type(within(dialog).getByLabelText('Option 1'), '9');
  await userEvent.type(within(dialog).getByLabelText('Option 2'), '6');
  await userEvent.type(within(dialog).getByLabelText('Tags'), 'arithmetic, chapter 1');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save question' }));
  await waitFor(() => expect(questionBankApi.create).toHaveBeenCalled());
  expect(questionBankApi.create.mock.calls[0][0]).toMatchObject({ type: 'MCQ_SINGLE', prompt: '3 × 3 = ?', options: [{ label: '9', isCorrect: true }, { label: '6', isCorrect: false }], tags: ['arithmetic', 'chapter 1'] });
});

it('quiz editor: picks questions from the bank, draws random ones and saves a quiz question to the bank', async () => {
  const quiz = { id: 'q1', passPercent: 60, timeLimitSeconds: null, maxAttempts: null, negativeMarkRatio: 0, shuffleQuestions: false, shuffleOptions: false, randomPickCount: null, showResults: true, instructions: null,
    questions: [{ id: 'x1', type: 'TRUE_FALSE', prompt: 'Zero is even', points: 1, options: [], bankQuestionId: null }, { id: 'x2', type: 'MCQ_SINGLE', prompt: 'Copied one', points: 1, options: [], bankQuestionId: 'b9' }] };
  creatorLearnApi.quiz.mockResolvedValue(quiz);
  questionBankApi.list.mockResolvedValue({ items: [bankQ('b1', 'x + 1 = 3'), bankQ('b9', 'Copied one')], total: 2, page: 1, pages: 1 });
  questionBankApi.tags.mockResolvedValue([{ tag: 'algebra', count: 2 }]);
  questionBankApi.addToQuiz.mockResolvedValue({ added: 1, skipped: 0, quiz });
  questionBankApi.saveToBank.mockResolvedValue({ id: 'b10' });
  wrap(<QuizEditor courseId="c1" lessonId="l1" />);
  expect(await screen.findByText('Zero is even')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Save to question bank' })).toHaveLength(1); // copied questions are already in the bank
  await userEvent.click(screen.getByRole('button', { name: 'Save to question bank' }));
  await waitFor(() => expect(questionBankApi.saveToBank).toHaveBeenCalledWith('c1', 'l1', 'x1', []));

  await userEvent.click(screen.getByRole('button', { name: 'Add from question bank' }));
  let dialog = await screen.findByRole('dialog', { name: 'Add from question bank' });
  expect(await within(dialog).findByRole('checkbox', { name: 'Copied one' })).toBeDisabled();
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'x + 1 = 3' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add 1 question' }));
  await waitFor(() => expect(questionBankApi.addToQuiz).toHaveBeenCalledWith('c1', 'l1', { questionIds: ['b1'] }));

  await userEvent.click(screen.getByRole('button', { name: 'Add from question bank' }));
  dialog = await screen.findByRole('dialog', { name: 'Add from question bank' });
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Random from a tag' }));
  await userEvent.selectOptions(within(dialog).getByLabelText('Tag'), 'algebra');
  await userEvent.clear(within(dialog).getByLabelText('How many'));
  await userEvent.type(within(dialog).getByLabelText('How many'), '2');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Draw questions' }));
  await waitFor(() => expect(questionBankApi.addToQuiz).toHaveBeenLastCalledWith('c1', 'l1', { tag: 'algebra', count: 2 }));
});
