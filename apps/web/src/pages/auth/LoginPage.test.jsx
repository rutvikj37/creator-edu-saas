import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { LoginPage } from './LoginPage.jsx';
import { authApi } from '../../services/api/auth.js';

const establish = vi.fn(async () => ({ platformRoles: [], activeTenantId: 't1', mfaSetupRequired: false }));
const authState = { surface: 'platform', establish };
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => authState }));
vi.mock('../../services/api/auth.js', () => ({
  authApi: { login: vi.fn(), loginMfa: vi.fn(), providers: vi.fn(async () => ({ google: false })) },
  academyApi: { site: vi.fn() },
}));
vi.mock('../../services/api/system.js', () => ({ systemApi: { info: vi.fn(async () => ({ name: 'Platform' })) } }));

function setup(path = '/login') {
  const router = createMemoryRouter([{ path: '/login', element: <LoginPage /> }, { path: '*', element: <p>landed</p> }], { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.surface = 'platform';
    authState.establish = establish;
  });

  it('hides forgot-password on the Super Admin host', () => {
    authState.surface = 'admin';
    setup();
    expect(screen.getByRole('heading', { name: 'Super Admin' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Forgot password?' })).not.toBeInTheDocument();
  });

  it('shows forgot-password on the agency host', () => {
    setup();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toBeInTheDocument();
  });

  it('validates input before calling the API', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it('shows the server error message', async () => {
    authApi.login.mockRejectedValue(Object.assign(new Error('Incorrect email or password.'), { code: 'INVALID_CREDENTIALS' }));
    setup();
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
  });

  it('asks for a two-factor code, then lands on the safe return path', async () => {
    authApi.login.mockResolvedValue({ mfaRequired: true, mfaToken: 'mfa-tok' });
    authApi.loginMfa.mockResolvedValue({ accessToken: 'acc' });
    const router = setup('/login?next=%2Fcreator%2Fdomains');
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.type(await screen.findByLabelText('Authentication code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('landed')).toBeInTheDocument();
    expect(authApi.loginMfa).toHaveBeenCalledWith({ mfaToken: 'mfa-tok', code: '123456' });
    expect(establish).toHaveBeenCalledWith({ accessToken: 'acc' });
    expect(router.state.location.pathname).toBe('/creator/domains');
  });

  it('ignores open-redirect attempts in ?next', async () => {
    authApi.login.mockResolvedValue({ accessToken: 'acc' });
    const router = setup('/login?next=%2F%2Fevil.example');
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('landed');
    expect(router.state.location.pathname).toBe('/creator');
  });
});
