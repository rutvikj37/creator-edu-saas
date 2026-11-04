import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Button, ConfirmDialog, DataTable, Input, StatusBadge } from './index.js';

describe('Button', () => {
  it('is disabled and busy while loading', () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Input', () => {
  it('links the error message for screen readers', () => {
    render(<Input label="Email" error="Enter a valid email" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id);
  });
});

describe('StatusBadge', () => {
  it('humanises enum values', () => {
    render(<StatusBadge status="PAYMENT_INITIATED" />);
    expect(screen.getByText('Payment initiated')).toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('requires the confirmation text before enabling the action', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Delete tenant?" confirmText="acme" confirmLabel="Delete" onConfirm={onConfirm} onClose={() => {}} />);
    const del = screen.getByRole('button', { name: 'Delete', hidden: true });
    expect(del).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Type "acme"/), 'acme');
    expect(del).toBeEnabled();
    await userEvent.click(del);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe('DataTable', () => {
  const columns = [{ key: 'name', header: 'Name', sortable: true }];

  it('shows the empty state when there are no rows', () => {
    render(<DataTable columns={columns} rows={[]} empty={<p>No students yet</p>} />);
    expect(screen.getByText('No students yet')).toBeInTheDocument();
  });

  it('cycles sort ascending → descending → none', async () => {
    const onSortChange = vi.fn();
    const { rerender } = render(<DataTable columns={columns} rows={[{ id: 1, name: 'A' }]} onSortChange={onSortChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onSortChange).toHaveBeenLastCalledWith('name');
    rerender(<DataTable columns={columns} rows={[{ id: 1, name: 'A' }]} sort="name" onSortChange={onSortChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onSortChange).toHaveBeenLastCalledWith('-name');
    rerender(<DataTable columns={columns} rows={[{ id: 1, name: 'A' }]} sort="-name" onSortChange={onSortChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onSortChange).toHaveBeenLastCalledWith(undefined);
  });
});
