import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormShowcase, academySchema } from './FormShowcase.jsx';

describe('form validation pattern', () => {
  it('shows inline errors for invalid input', async () => {
    render(<FormShowcase />);
    await userEvent.type(screen.getByLabelText(/Academy name/), 'ab');
    await userEvent.type(screen.getByLabelText(/Contact email/), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Validate' }));
    expect(await screen.findByText('Academy name must be at least 3 characters')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Choose a category')).toBeInTheDocument();
    expect(screen.getByText('You must accept the terms')).toBeInTheDocument();
  });

  it('schema accepts a valid payload', () => {
    expect(academySchema.safeParse({ name: 'Acme Academy', email: 'a@b.co', category: 'tech', terms: true }).success).toBe(true);
  });
});
