import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { duration, ReportsPage } from './ReportsPage.jsx';
import { analyticsApi } from '../../services/api/analytics.js';

vi.mock('../../services/api/analytics.js', () => ({ analyticsApi: { reports: vi.fn(), exportsList: vi.fn(async () => ({ items: [{ id: 'e1', kind: 'SALES', fileName: 'orders.csv', sizeBytes: 3174, user: 'Asha', createdAt: '2026-11-07T13:22:00Z' }], meta: { page: 1, pageSize: 10, total: 1 } })), exportDownload: vi.fn() } }));
vi.mock('recharts', async (orig) => ({ ...(await orig()), ResponsiveContainer: ({ children }) => <div style={{ width: 400, height: 200 }}>{children}</div> }));

const totals = { revenue: '999.00', transactions: 5, successfulTransactions: 3, transactionAmount: '999.00', signups: 2, enrollments: 3, activeUsers: 1, paidUsers: 1, timeSpentSeconds: 750, webSeconds: 600, mobileSeconds: 150, completions: 1, certificates: 1, quizAttempts: 4, assignmentSubmissions: 0, comments: 2, liveClasses: 2, avgDailyClasses: 0.3, avgDailyTests: 0.6 };
const data = (days) => ({ range: { days, currency: 'INR' }, asOf: new Date().toISOString(), totals, change: { signups: 100, enrollments: 100 }, series: [{ date: '2026-11-09', revenue: 999, transactions: 5, successful: 3, signups: 2, enrollments: 3, activeUsers: 1, paidUsers: 1, webSeconds: 600, mobileSeconds: 150 }], topCourses: [{ courseId: 'c1', title: 'GST Basics', seconds: 750, learners: 1 }], classesByCourse: [{ courseId: 'c1', title: 'GST Basics', count: 2 }], testsByCourse: [] });

function wrap() {
  const router = createMemoryRouter([{ path: '/creator/reports', element: <ReportsPage /> }], { initialEntries: ['/creator/reports'] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

it('formats learning time', () => {
  expect(duration(0)).toBe('0 Secs');
  expect(duration(45)).toBe('45 Secs');
  expect(duration(750)).toBe('12 min 30 sec');
  expect(duration(3720)).toBe('1 hr 2 min');
});

it('reports: overview totals with change, period switch, sales, usage and activity tabs', async () => {
  analyticsApi.reports.mockImplementation(async (days) => data(days));
  const router = wrap();
  expect(await screen.findByText('Total revenue')).toBeInTheDocument();
  expect(analyticsApi.reports).toHaveBeenCalledWith(7);
  expect(screen.getAllByText('100%').length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('radio', { name: '30 days' }));
  await waitFor(() => expect(analyticsApi.reports).toHaveBeenLastCalledWith(30));
  expect(router.state.location.search).toContain('days=30');
  await userEvent.click(screen.getByRole('tab', { name: 'Sales' }));
  expect((await screen.findAllByText('Successful transactions')).length).toBeGreaterThan(0);
  expect(screen.getByText('Transaction amount')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Bandwidth & Usage' }));
  expect(await screen.findByText('GST Basics')).toBeInTheDocument();
  expect(screen.getByText('10 min 0 sec · 80%')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'School Activity' }));
  expect(await screen.findByText('Quiz attempts')).toBeInTheDocument();
  expect(screen.getByText('Average daily classes')).toBeInTheDocument();
  expect(screen.getByText('Class split across courses')).toBeInTheDocument();
  expect((await screen.findAllByText('Sales report')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('3.1 kB').length).toBeGreaterThan(0);
});
