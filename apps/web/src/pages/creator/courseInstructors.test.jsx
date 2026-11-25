import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CourseInstructorsEditor, orderInstructorIds } from './CourseInstructorsEditor.jsx';
import { coursesApi } from '../../services/api/creator.js';

vi.mock('../../services/api/creator.js', () => ({
  coursesApi: {
    instructorCandidates: vi.fn(async () => ([
      { id: 'u1', fullName: 'Ada Owner', email: 'ada@ex.com', role: { key: 'OWNER', name: 'Owner' } },
      { id: 'u2', fullName: 'Ian Teacher', email: 'ian@ex.com', role: { key: 'INSTRUCTOR', name: 'Instructor' } },
    ])),
    setInstructors: vi.fn(async (_id, userIds) => userIds.map((id, i) => ({ id, fullName: id === 'u1' ? 'Ada Owner' : 'Ian Teacher', isPrimary: i === 0 }))),
  },
}));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ can: () => true }) }));

it('puts the primary instructor first when ordering ids', () => {
  expect(orderInstructorIds(['u2', 'u1'], 'u1')).toEqual(['u1', 'u2']);
  expect(orderInstructorIds(['u2'], 'missing')).toEqual(['u2']);
  expect(orderInstructorIds([], 'u1')).toEqual([]);
});

it('assigns staff as instructors and saves with primary first', async () => {
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <CourseInstructorsEditor
          courseId="c1"
          instructors={[{ id: 'u1', fullName: 'Ada Owner', isPrimary: true }]}
          onSaved={onSaved}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByText('Ada Owner')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Assign Ian Teacher' }));
  await userEvent.click(screen.getByRole('button', { name: 'Make primary' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save instructors' }));

  await waitFor(() => expect(coursesApi.setInstructors).toHaveBeenCalledWith('c1', ['u2', 'u1']));
  expect(onSaved).toHaveBeenCalled();
});
