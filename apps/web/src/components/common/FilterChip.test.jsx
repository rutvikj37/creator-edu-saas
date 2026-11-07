import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { FilterChip } from './FilterChip.jsx';
import { studentQuery } from '../../pages/creator/StudentsPage.jsx';

const options = [{ value: 'PAID', label: 'Paid' }, { value: 'FAILED', label: 'Failed' }];

it('picks a choice, shows it in the pill and clears it', async () => {
  const onChange = vi.fn();
  const { rerender } = render(<FilterChip label="Status" value={undefined} options={options} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Status' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Failed' }));
  expect(onChange).toHaveBeenCalledWith('FAILED');
  rerender(<FilterChip label="Status" value="FAILED" options={options} onChange={onChange} />);
  expect(screen.getByRole('button', { name: 'Status: Failed' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Clear Status filter' }));
  expect(onChange).toHaveBeenLastCalledWith(undefined);
});

it('turns learner filter chips into API parameters', () => {
  expect(studentQuery({ q: 'a', page: 2, pageSize: 20 })).toEqual({ q: 'a', page: 2, pageSize: 20, courseId: undefined });
  expect(studentQuery({ active: 'never' })).toMatchObject({ neverSignedIn: 'true' });
  const q = studentQuery({ joined: '7d', active: '30d', courseId: 'c1' });
  expect(q.joinedFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(q.joinedTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(q.activeFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(q.courseId).toBe('c1');
});
