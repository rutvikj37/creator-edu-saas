import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CoursesPage } from './CoursesPage.jsx';

const items = [
  { id: 'c1', title: 'Algebra', status: 'PUBLISHED', sectionCount: 2, lessonCount: 9, studentCount: 31, isFree: false, priceAmount: '499.00', currency: 'INR', updatedAt: new Date().toISOString() },
  { id: 'c2', title: 'Geometry', status: 'DRAFT', sectionCount: 1, lessonCount: 0, studentCount: 0, isFree: true, updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() },
];
vi.mock('../../services/api/creator.js', () => ({ coursesApi: { list: vi.fn(async () => ({ items, meta: { page: 1, pageSize: 12, total: 2 } })), create: vi.fn() } }));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ can: () => true }) }));

const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><CoursesPage /></MemoryRouter></QueryClientProvider>);

beforeEach(() => localStorage.clear());

it('shows course cards with count, enrolment, status and editor shortcuts', async () => {
  renderPage();
  expect(await screen.findByRole('link', { name: 'Algebra' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /Courses/ })).toHaveTextContent('2');
  expect(screen.getByText('31')).toBeInTheDocument();
  expect(screen.getByText('₹499.00')).toBeInTheDocument();
  expect(screen.getByText('Updated 3 days ago')).toBeInTheDocument();
  expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
  expect(screen.getByRole('link', { name: 'Curriculum: Algebra' })).toHaveAttribute('href', '/creator/courses/c1?tab=curriculum');
  expect(screen.getByRole('link', { name: 'Students: Geometry' })).toHaveAttribute('href', '/creator/courses/c2?tab=students');
});

it('switches to a remembered list view', async () => {
  renderPage();
  await screen.findByRole('link', { name: 'Algebra' });
  await userEvent.click(screen.getByRole('radio', { name: 'List view' }));
  const table = screen.getAllByRole('table')[0];
  expect(within(table).getByText('Enrolled')).toBeInTheDocument();
  expect(within(table).getByText('Algebra')).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('ce.courses.view'))).toBe('list');
});
