import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { StudentsPage } from './StudentsPage.jsx';
import { creatorLearnApi } from '../../services/api/learn.js';

vi.mock('../../services/api/learn.js', () => ({
  creatorLearnApi: {
    students: vi.fn(async () => ({ items: [], meta: { page: 1, pageSize: 20, total: 0 } })),
    student: vi.fn(),
    addStudent: vi.fn(async () => ({ id: 'u1', invited: true, enrolled: 1 })),
    importStudents: vi.fn(async () => ({ total: 2, created: 1, existing: 0, failed: [{ row: 3, email: 'bad', reason: 'Invalid email address' }] })),
  },
}));
vi.mock('../../services/api/creator.js', () => ({
  coursesApi: { list: vi.fn(async () => ({ items: [{ id: 'c1', title: 'Algebra', status: 'PUBLISHED' }, { id: 'c2', title: 'Geometry', status: 'DRAFT' }], meta: {} })) },
}));
let canManage = true;
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'me' }, can: () => canManage }) }));

const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><StudentsPage /></MemoryRouter></QueryClientProvider>);

beforeEach(() => { canManage = true; vi.clearAllMocks(); });

it('adds a student with a course', async () => {
  renderPage();
  await userEvent.click(screen.getAllByRole('button', { name: 'Add student' })[0]);
  const dialog = await screen.findByRole('dialog', { name: 'Add student' });
  const submit = within(dialog).getByRole('button', { name: 'Add student' });
  expect(submit).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText(/Full name/), 'Asha Rao');
  await userEvent.type(within(dialog).getByRole('textbox', { name: /^Email/ }), 'asha@example.com');
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Mobile/ }), '98765 43210');
  await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Algebra' }));
  await userEvent.click(submit);
  await waitFor(() => expect(creatorLearnApi.addStudent).toHaveBeenCalledWith({ fullName: 'Asha Rao', email: 'asha@example.com', phone: '+919876543210', courseIds: ['c1'], sendInvite: true }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add student' })).toBeNull());
});

it('shows field errors from the server', async () => {
  creatorLearnApi.addStudent.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { details: [{ field: 'email', message: 'Already a student' }] }));
  renderPage();
  await userEvent.click(screen.getAllByRole('button', { name: 'Add student' })[0]);
  const dialog = await screen.findByRole('dialog', { name: 'Add student' });
  await userEvent.type(within(dialog).getByLabelText(/Full name/), 'A');
  await userEvent.type(within(dialog).getByRole('textbox', { name: /^Email/ }), 'a@b.co');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add student' }));
  expect(await within(dialog).findByText('Already a student')).toBeInTheDocument();
});

it('imports a CSV, previews it and shows skipped rows', async () => {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
  const dialog = await screen.findByRole('dialog', { name: 'Import students' });
  const file = new File(['Name,Email,Mobile\nAsha,asha@example.com,98765 43210\nBad,bad,\n'], 'students.csv', { type: 'text/csv' });
  await userEvent.upload(within(dialog).getByLabelText('CSV file'), file);
  expect(await within(dialog).findByText('asha@example.com')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Import 2 students' }));
  await waitFor(() => expect(creatorLearnApi.importStudents).toHaveBeenCalledWith({
    rows: [{ fullName: 'Asha', email: 'asha@example.com', phone: '98765 43210' }, { fullName: 'Bad', email: 'bad', phone: '' }], courseIds: [], sendInvite: true,
  }));
  expect(await within(dialog).findByText('Invalid email address')).toBeInTheDocument();
  expect(within(dialog).getByText('Skipped rows')).toBeInTheDocument();
});

it('rejects a CSV without an email column', async () => {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
  const dialog = await screen.findByRole('dialog', { name: 'Import students' });
  await userEvent.upload(within(dialog).getByLabelText('CSV file'), new File(['name,phone\nA,1\n'], 'x.csv', { type: 'text/csv' }));
  expect(await within(dialog).findByText(/No "email" column/)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Import' })).toBeDisabled();
});

it('hides add and import without the students.manage permission', async () => {
  canManage = false;
  renderPage();
  expect(await screen.findByText('No students yet')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add student' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Import CSV' })).toBeNull();
});
