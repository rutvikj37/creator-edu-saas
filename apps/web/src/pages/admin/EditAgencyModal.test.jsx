import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { EditAgencyModal } from './EditAgencyModal.jsx';
import { platformApi } from '../../services/api/platform.js';

vi.mock('../../services/api/platform.js', () => ({
  platformApi: {
    updateTenant: vi.fn(),
  },
}));

const mockTenant = {
  id: 't-123',
  name: 'Acme School',
  slug: 'acme-school',
  country: 'IN',
  timezone: 'Asia/Kolkata',
  owner: {
    fullName: 'Jane Doe',
    phone: '+91 9876543210',
  },
};

describe('EditAgencyModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders existing tenant data and updates successfully', async () => {
    platformApi.updateTenant.mockResolvedValue({ id: 't-123', name: 'Updated Academy' });
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(
      <EditAgencyModal
        open={true}
        tenant={mockTenant}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    expect(screen.getByDisplayValue('Acme School')).toBeInTheDocument();
    expect(screen.getByDisplayValue('acme-school')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Jane Doe')).toBeInTheDocument();

    // Change name
    const nameInput = screen.getByLabelText(/Agency name \*/i);
    fireEvent.change(nameInput, { target: { value: 'Updated Academy' } });

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(platformApi.updateTenant).toHaveBeenCalledWith('t-123', expect.objectContaining({
        name: 'Updated Academy',
        slug: 'acme-school',
      }));
    });

    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
