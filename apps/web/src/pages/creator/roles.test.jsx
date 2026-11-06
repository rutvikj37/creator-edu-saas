import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { StaffPage } from './StaffPage.jsx';
import { rolesApi } from '../../services/api/creator.js';

vi.mock('../../services/api/creator.js', () => ({
  staffApi: { list: vi.fn(async () => ({ members: [], invitations: [], assignableRoles: [{ key: 'INSTRUCTOR', name: 'Instructor' }, { key: 'custom_abc', name: 'Course editor', custom: true }] })), invite: vi.fn(), revoke: vi.fn(), changeRole: vi.fn(), remove: vi.fn() },
  rolesApi: {
    list: vi.fn(async () => [{ id: 'r1', key: 'INSTRUCTOR', name: 'Instructor', custom: false, permissions: ['courses.read'], members: 2 }, { id: 'r2', key: 'custom_abc', name: 'Course editor', custom: true, permissions: ['courses.manage'], members: 0 }]),
    catalog: vi.fn(async () => [{ group: 'Courses & content', items: [{ key: 'courses.read', label: 'View courses' }, { key: 'courses.manage', label: 'Edit courses' }] }, { group: 'Sales', items: [{ key: 'orders.read', label: 'View orders' }] }]),
    create: vi.fn(async () => ({ id: 'r3' })), update: vi.fn(), remove: vi.fn(),
  },
}));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'me' }, can: () => true }) }));

it('creates a custom role from chosen permissions; built-in roles cannot be edited', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StaffPage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText('Course editor')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit Instructor' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Edit Course editor' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'New role' }));
  const dialog = await screen.findByRole('dialog', { name: 'New role' });
  const create = within(dialog).getByRole('button', { name: 'Create role' });
  expect(create).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText('Role name'), 'Sales viewer');
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'View orders' }));
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'View courses' }));
  await userEvent.click(create);
  await waitFor(() => expect(rolesApi.create).toHaveBeenCalledWith({ name: 'Sales viewer', permissions: ['orders.read', 'courses.read'] }));
});
