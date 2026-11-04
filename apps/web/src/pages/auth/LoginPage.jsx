import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail } from 'lucide-react';
import { AuthLayout } from '../../components/auth/AuthLayout.jsx';
import { PasswordInput } from '../../components/auth/PasswordInput.jsx';
import { GoogleButton } from '../../components/auth/GoogleButton.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Input } from '../../components/ui/index.js';
import { authApi } from '../../services/api/auth.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { landingPath } from '../../routes/guards.jsx';

const credentialsSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

const URL_ERRORS = {
  google_no_account: 'No account uses that Google email here. Sign up first, then you can use Google to sign in.',
  google_cancelled: 'Google sign-in was cancelled.',
};

/** Safe post-login redirect: only same-site relative paths. */
function safeNext(next) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mfaToken, setMfaToken] = useState(null);
  const [error, setError] = useState(URL_ERRORS[params.get('error')] ?? null);

  const creds = useForm({ resolver: zodResolver(credentialsSchema), defaultValues: { email: '', password: '' } });
  const code = useForm({ resolver: zodResolver(codeSchema), defaultValues: { code: '' } });

  const finish = async (result) => {
    const me = await auth.establish(result);
    navigate(safeNext(params.get('next')) ?? landingPath(me, auth.surface), { replace: true });
  };

  const onCredentials = creds.handleSubmit(async (values) => {
    setError(null);
    try {
      const result = await authApi.login(values);
      if (result.mfaRequired) setMfaToken(result.mfaToken);
      else await finish(result);
    } catch (e) {
      setError(e.message);
    }
  });

  const onCode = code.handleSubmit(async ({ code: c }) => {
    setError(null);
    try {
      await finish(await authApi.loginMfa({ mfaToken, code: c }));
    } catch (e) {
      if (e.code === 'INVALID_TOKEN' && /expired/i.test(e.message)) setMfaToken(null);
      setError(e.message);
    }
  });

  if (mfaToken) {
    return (
      <AuthLayout title="Two-factor authentication" subtitle="Enter the 6-digit code from your authenticator app.">
        <form onSubmit={onCode} noValidate className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Input label="Authentication code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6}
            {...code.register('code')} error={code.formState.errors.code?.message} />
          <Button type="submit" className="w-full" loading={code.formState.isSubmitting}>Verify</Button>
          <Button variant="link" className="w-full" onClick={() => { setMfaToken(null); setError(null); }}>Use a different account</Button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle={auth.surface === 'academy' ? 'Welcome back. Sign in to continue learning.' : 'Welcome back. Sign in to manage your academy.'}
      footer={
        <>
          New here?{' '}
          <Link to={auth.surface === 'academy' ? '/register' : '/signup'} className="font-medium text-primary-600 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <GoogleButton />
      <form onSubmit={onCredentials} noValidate className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Input label="Email" type="email" autoComplete="email" leftIcon={Mail} autoFocus {...creds.register('email')} error={creds.formState.errors.email?.message} />
        <div>
          <PasswordInput {...creds.register('password')} error={creds.formState.errors.password?.message} />
          <div className="mt-1.5 text-right">
            <Link to="/forgot-password" className="text-xs font-medium text-primary-600 hover:underline">Forgot password?</Link>
          </div>
        </div>
        <Button type="submit" className="w-full" loading={creds.formState.isSubmitting}>Sign in</Button>
      </form>
    </AuthLayout>
  );
}
