import { render, screen, fireEvent } from '@testing-library/react';
import { AdminTemplatesPage } from './AdminTemplatesPage.jsx';

describe('AdminTemplatesPage', () => {
  it('renders templates list with search and categories', () => {
    render(<AdminTemplatesPage />);

    expect(screen.getByText('Agency Welcome & Temporary Password')).toBeInTheDocument();
    expect(screen.getByText('Creator Password Reset Request')).toBeInTheDocument();

    // Filter by category
    fireEvent.click(screen.getByRole('button', { name: 'Billing' }));
    expect(screen.getByText('Subscription Activation Confirmation')).toBeInTheDocument();
    expect(screen.queryByText('Creator Password Reset Request')).not.toBeInTheDocument();

    // Open template editor modal
    const editBtns = screen.getAllByRole('button', { name: 'Preview & Edit' });
    fireEvent.click(editBtns[0]);
    expect(screen.getByText(/Edit Subscription Activation Confirmation/i)).toBeInTheDocument();
  });
});
