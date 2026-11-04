import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthLayout } from '../../components/auth/AuthLayout.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Spinner } from '../../components/ui/index.js';
import { authApi } from '../../services/api/auth.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { landingPath } from '../../routes/guards.jsx';

/** Completes Google sign-in by exchanging the one-time hand-off code for a session on this host. */
export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = params.get('handoff');
    if (!code) return setError('Sign-in could not be completed.');
    authApi
      .googleHandoff(code)
      .then(async (result) => {
        if (result.mfaRequired) return setError('This account uses two-factor authentication. Sign in with your password and authenticator code.');
        const me = await auth.establish(result);
        navigate(landingPath(me, auth.surface), { replace: true });
      })
      .catch((e) => setError(e.message));
  }, [params, auth, navigate]);

  return (
    <AuthLayout title="Signing you in">
      {error ? (
        <Alert tone="error" action={<Link to="/login" className="text-sm font-semibold underline">Back</Link>}>{error}</Alert>
      ) : (
        <div className="flex justify-center py-6"><Spinner label="Signing in" /></div>
      )}
    </AuthLayout>
  );
}
