import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CreatorDashboardPage } from './CreatorDashboardPage.jsx';
import { academyApi2 } from '../../services/api/creator.js';

const series = Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, signups: i % 3, paidUsers: i % 5 === 0 ? 1 : 0, revenue: i % 5 === 0 ? '499.00' : '0.00' }));
const base = {
  courses: { total: 2, published: 1, draft: 1 }, students: { total: 40, newLast30Days: 12 }, staff: 2,
  usage: { courses: { used: 2, limit: 3 }, students: { used: 40, limit: 100 }, storageBytes: { used: 0, limit: null } },
  plan: { name: 'Free Trial', status: 'TRIALING' }, activity: [{ id: 'a1', action: 'student.import', actor: 'Asha', createdAt: '2026-11-01T10:00:00Z' }],
  last30: { currency: 'INR', asOf: new Date().toISOString(), signups: { value: 12, previous: 4, change: 200 }, paidUsers: { value: 6, previous: 8, change: -25 }, revenue: { value: '2994.00', previous: '0.00', change: null }, series },
  setup: [{ key: 'publish_academy', done: true }, { key: 'connect_payments', done: false }, { key: 'publish_course', done: true }, { key: 'add_students', done: true }, { key: 'schedule_live', done: false }, { key: 'start_community', done: false }],
};
vi.mock('../../services/api/creator.js', () => ({ academyApi2: { dashboard: vi.fn() } }));
vi.mock('../../components/account/EmailVerificationBanner.jsx', () => ({ EmailVerificationBanner: () => null }));
const ALL = ['academy.manage', 'integrations.manage', 'courses.manage', 'students.manage', 'live.manage', 'community.manage', 'analytics.read', 'billing.manage', 'staff.manage'];
let perms = new Set(ALL);
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { fullName: 'Asha Rao' }, activeTenant: { name: 'Asha Academy' }, can: (p) => perms.has(p) }) }));

const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><CreatorDashboardPage /></MemoryRouter></QueryClientProvider>);

beforeEach(() => { perms = new Set(ALL); academyApi2.dashboard.mockResolvedValue(base); });

it('shows 30-day stats with change versus the previous period', async () => {
  renderPage();
  expect(screen.getByText('Welcome back, Asha')).toBeInTheDocument();
  expect(await screen.findByText('₹2,994.00')).toBeInTheDocument();
  const signups = screen.getByText('Sign-ups').closest('.flex-col');
  expect(within(signups).getByText('12')).toBeInTheDocument();
  expect(within(signups).getByText('200%')).toBeInTheDocument();
  expect(within(signups).getByText(/Up/)).toBeInTheDocument();
  const paying = screen.getByText('Paying students').closest('.flex-col');
  expect(within(paying).getByText('25%')).toBeInTheDocument();
  expect(within(paying).getByText(/Down/)).toBeInTheDocument();
  expect(screen.getByText('₹2,994.00')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Sign-ups, daily for the last 30 days' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /View reports/ })).toHaveAttribute('href', '/creator/analytics');
});

it('leads with the first unfinished setup step and tracks launch progress', async () => {
  renderPage();
  expect(await screen.findByText('Next step')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Get paid for your courses' })).toBeInTheDocument();
  expect(screen.getByText('3 of 6 done')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'Launch progress' })).toHaveAttribute('aria-valuenow', '50');
  expect(screen.getAllByRole('link', { name: /Connect payments/ })[0]).toHaveAttribute('href', '/creator/payments');
  expect(screen.getByText('imported students')).toBeInTheDocument();
});

it('hides sales cards when the API withholds them, and the checklist once everything is done', async () => {
  academyApi2.dashboard.mockResolvedValue({ ...base, last30: { ...base.last30, paidUsers: null, revenue: null }, setup: base.setup.map((s) => ({ ...s, done: true })) });
  renderPage();
  expect(await screen.findByText('Recent activity')).toBeInTheDocument();
  await screen.findByText('imported students');
  expect(screen.queryByText('Paying students')).toBeNull();
  expect(screen.queryByText('Revenue')).toBeNull();
  expect(screen.queryByText('Next step')).toBeNull();
  expect(screen.queryByText('Finish your launch')).toBeNull();
});

it('only offers steps and actions the member is allowed to do', async () => {
  perms = new Set(['courses.manage']);
  academyApi2.dashboard.mockResolvedValue({ ...base, setup: base.setup.map((s) => (s.key === 'publish_course' ? { ...s, done: false } : s)) });
  renderPage();
  expect(await screen.findByText('Finish your launch')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Publish your first course' })).toBeInTheDocument();
  expect(screen.queryByText('Get paid for your courses')).toBeNull();
  expect(screen.queryByRole('link', { name: /View reports/ })).toBeNull();
  expect(screen.queryByText('Invite your team')).toBeNull();
});
