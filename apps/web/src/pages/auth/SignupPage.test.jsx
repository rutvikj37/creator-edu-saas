import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { SignupPage, signupSchema } from './SignupPage.jsx';
import { authApi } from '../../services/api/auth.js';
import { ApiError } from '../../services/api/client.js';

vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ surface: 'platform', establish: vi.fn(async () => ({})) }) }));
vi.mock('../../services/api/auth.js', () => ({ authApi: { registerCreator: vi.fn() }, academyApi: { site: vi.fn() } }));
vi.mock('../../services/api/system.js', () => ({ systemApi: { info: vi.fn(async () => ({ name: 'Platform' })) } }));

function setup() {
  const router = createMemoryRouter([{ path: '/signup', element: <SignupPage /> }, { path: '*', element: <p>workspace</p> }], { initialEntries: ['/signup'] });
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>);
}

async function fillValid() {
  await userEvent.type(screen.getByLabelText(/Full name/), 'Asha Rao');
  await userEvent.type(screen.getByLabelText(/Work email/), 'asha@example.com');
  await userEvent.type(screen.getByLabelText(/Academy or business name/), 'Asha Academy');
  await userEvent.type(screen.getByLabelText(/^Password/), 'long-enough-pass');
}

describe('SignupPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('schema enforces password length and phone format', () => {
    const base = { fullName: 'Asha', email: 'a@b.co', password: 'long-enough-pass', country: 'IN', businessName: 'Acad' };
    expect(signupSchema.safeParse(base).success).toBe(true);
    expect(signupSchema.safeParse({ ...base, password: 'short' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, phone: '98765' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, phone: '' }).success).toBe(true);
  });

  it('maps server field errors onto inputs', async () => {
    authApi.registerCreator.mockRejectedValue(new ApiError({ status: 422, code: 'VALIDATION_FAILED', message: 'Invalid', details: [{ field: 'businessName', message: 'Name not allowed' }] }));
    setup();
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Name not allowed')).toBeInTheDocument();
  });

  it('shows duplicate-account errors and succeeds otherwise', async () => {
    authApi.registerCreator.mockRejectedValueOnce(new ApiError({ status: 409, code: 'CONFLICT', message: 'An account with this email already exists. Sign in instead.' }));
    authApi.registerCreator.mockResolvedValueOnce({ accessToken: 'acc' });
    setup();
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('workspace')).toBeInTheDocument();
    expect(authApi.registerCreator).toHaveBeenLastCalledWith(expect.objectContaining({ country: 'IN', phone: undefined }));
  });
});
