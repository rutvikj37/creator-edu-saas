import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { StudentsPage, studentQuery } from './StudentsPage.jsx';
import { StaffPage } from './StaffPage.jsx';
import { creatorLearnApi } from '../../services/api/learn.js';
import { staffApi } from '../../services/api/creator.js';
import { saveBlob } from '../../utils/download.js';

vi.mock('../../services/api/learn.js', () => ({
  creatorLearnApi: { students: vi.fn(async () => ({ items: [], meta: { page: 1, pageSize: 20, total: 0 } })), studentFilterOptions: vi.fn(async () => ({ utmSources: ['instagram'], tags: ['vip'] })) },
}));
vi.mock('../../services/api/creator.js', () => ({
  coursesApi: { list: vi.fn(async () => ({ items: [] })) },
  rolesApi: { list: vi.fn(async () => []) },
  staffApi: { list: vi.fn(), invite: vi.fn(), revoke: vi.fn(), changeRole: vi.fn(), remove: vi.fn() },
}));
vi.mock('../../services/api/community.js', () => ({ membershipsApi: { plans: vi.fn(async () => [{ id: 'p'.repeat(25), name: 'Gold plan' }]) }, communityApi: () => ({ spaces: vi.fn(async () => []) }) }));
vi.mock('../../services/api/coaching.js', () => ({ coachingApi: { programs: vi.fn(async () => []) } }));
vi.mock('../../services/api/live.js', () => ({ creatorLiveApi: { classes: vi.fn(async () => []) } }));
vi.mock('../../services/api/academySettings.js', () => ({ academySettingsApi: { customFields: vi.fn(async () => []) } }));
vi.mock('../../utils/download.js', () => ({ saveBlob: vi.fn() }));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'me' }, can: () => true }) }));

const wrap = (el, path = '/') => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}>{el}</MemoryRouter></QueryClientProvider>);

afterEach(() => vi.clearAllMocks());

it('learner "More" filters go into the list query', async () => {
  wrap(<StudentsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'More' }));
  const panel = await screen.findByRole('dialog');
  await waitFor(() => expect(within(panel).getByRole('option', { name: 'Gold plan' })).toBeInTheDocument());
  await userEvent.selectOptions(within(panel).getByLabelText('Membership'), 'Gold plan');
  await userEvent.selectOptions(within(panel).getByLabelText('Verified email'), 'yes');
  await userEvent.selectOptions(within(panel).getByLabelText('Source'), 'checkout');
  await waitFor(() => expect(within(panel).getByRole('option', { name: 'instagram' })).toBeInTheDocument());
  await userEvent.selectOptions(within(panel).getByLabelText('UTM source'), 'instagram');
  await userEvent.click(within(panel).getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(creatorLearnApi.students).toHaveBeenLastCalledWith(expect.objectContaining({ membershipPlanId: 'p'.repeat(25), verifiedEmail: 'yes', source: 'checkout', utmSource: 'instagram' })));
  expect(screen.getByRole('button', { name: 'More (4)' })).toBeInTheDocument();
});

it('studentQuery keeps only filters that are set', () => {
  expect(studentQuery({ page: 1, pageSize: 20, tag: 'vip', marketingConsent: 'no' })).toEqual({ q: undefined, page: 1, pageSize: 20, courseId: undefined, tag: 'vip', marketingConsent: 'no' });
});

it('team page splits administrators and instructors, filters and exports', async () => {
  staffApi.list.mockResolvedValue({
    invitations: [], assignableRoles: [],
    members: [
      { id: 'm1', createdAt: '2026-01-01T00:00:00Z', courseCount: 0, role: { key: 'OWNER', name: 'Owner' }, user: { id: 'me', fullName: 'Owner One', email: 'owner@example.test', lastLoginAt: '2026-11-20T10:00:00Z' } },
      { id: 'm2', createdAt: '2026-02-01T00:00:00Z', courseCount: 3, role: { key: 'ADMIN', name: 'Admin' }, user: { id: 'u2', fullName: 'Teaching Admin', email: 'ta@example.test', lastLoginAt: null } },
      { id: 'm3', createdAt: '2026-03-01T00:00:00Z', courseCount: 0, role: { key: 'INSTRUCTOR', name: 'Instructor' }, user: { id: 'u3', fullName: 'Ina Instructor', email: 'ina@example.test', lastLoginAt: null } },
    ],
  });
  wrap(<StaffPage />);
  expect((await screen.findAllByText('Owner One'))[0]).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /^Administrators/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Last login' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Never signed in' }));
  expect(screen.queryAllByText('Owner One')).toHaveLength(0);
  await userEvent.click(screen.getByRole('tab', { name: /Instructors/ }));
  expect(screen.getByRole('heading', { name: /^Instructors/ })).toBeInTheDocument();
  expect(screen.getAllByText('Teaching Admin')[0]).toBeInTheDocument(); // teaches courses
  expect(screen.getAllByText('Ina Instructor')[0]).toBeInTheDocument(); // instructor role
  await userEvent.click(screen.getByRole('button', { name: 'Export' }));
  expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'instructors.csv');
  const csv = await saveBlob.mock.calls[0][0].text();
  expect(csv.split('\r\n')[0]).toBe('Name,Email,Role,Courses taught,Joined on,Last sign-in');
  expect(csv).toContain('Teaching Admin,ta@example.test,Admin,3,2026-02-01,Never');
});
