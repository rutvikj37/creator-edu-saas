import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { LayoutGrid, List } from 'lucide-react';
import { Pagination, SegmentedControl, pageWindow } from './Navigation.jsx';
import { EmptyState } from './Feedback.jsx';
import { PageHeader } from '../layout/PageHeader.jsx';

describe('pageWindow', () => {
  it('shows first, last and neighbours with gaps', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(10, 10)).toEqual([1, null, 9, 10]);
  });
});

describe('Pagination', () => {
  it('jumps to a page and changes rows per page', async () => {
    const onPage = vi.fn();
    const onSize = vi.fn();
    render(<Pagination page={2} pageSize={20} total={95} onPageChange={onPage} onPageSizeChange={onSize} />);
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'Page 5' }));
    expect(onPage).toHaveBeenCalledWith(5);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '50');
    expect(onSize).toHaveBeenCalledWith(50);
  });
  it('hides the size picker when the page cannot change it', () => {
    render(<Pagination page={1} pageSize={20} total={5} onPageChange={() => {}} />);
    expect(screen.queryByRole('combobox', { name: 'Rows per page' })).toBeNull();
  });
});

describe('SegmentedControl', () => {
  it('is a radio group with icon-only options named for screen readers', async () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="View" value="grid" onChange={onChange} options={[{ value: 'grid', icon: LayoutGrid, ariaLabel: 'Grid view' }, { value: 'list', icon: List, ariaLabel: 'List view' }]} />);
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Grid view' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'List view' }));
    expect(onChange).toHaveBeenCalledWith('list');
  });
});

describe('PageHeader', () => {
  it('shows a count and hides section-only breadcrumbs', () => {
    render(<MemoryRouter><PageHeader title="Coupons" count={1234} breadcrumbs={[{ label: 'Sales' }, { label: 'Coupons' }]} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /Coupons/ })).toHaveTextContent('1,234');
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
  });
  it('keeps breadcrumbs that link back to a parent page', () => {
    render(<MemoryRouter><PageHeader title="Algebra" breadcrumbs={[{ label: 'Courses', to: '/creator/courses' }, { label: 'Algebra' }]} /></MemoryRouter>);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/creator/courses');
  });
});

it('EmptyState shows the title, help and action', () => {
  render(<EmptyState title="Nothing here yet" description="Add your first item." action={<button type="button">Add</button>} />);
  expect(screen.getByRole('heading', { name: 'Nothing here yet' })).toBeInTheDocument();
  expect(screen.getByText('Add your first item.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
});
