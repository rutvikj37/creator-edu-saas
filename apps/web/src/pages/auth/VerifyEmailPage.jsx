import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AuthLayout } from '../../components/auth/AuthLayout.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Spinner } from '../../components/ui/index.js';
import { authApi } from '../../services/api/auth.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { landingPath } from '../../routes/guards.jsx';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const auth = useAuth();
  const [state, setState] = useState({ status: 'pending' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode double-effect: the token is single-use
    started.current = true;
    const token = params.get('token');
    if (!token) return setState({ status: 'error', message: 'This verification link is incomplete.' });
    authApi
      .verifyEmail(token)
      .then(() => {
        setState({ status: 'done' });
        if (auth.status === 'authenticated') auth.reloadMe();
      })
      .catch((e) => setState({ status: 'error', message: e.message }));
  }, [params, auth]);

  const next = auth.status === 'authenticated' ? landingPath(auth.me, auth.surface) : '/login';
  return (
    <AuthLayout title="Email verification">
      {state.status === 'pending' && <div className="flex justify-center py-6"><Spinner label="Verifying" /></div>}
      {state.status === 'done' && (
        <Alert tone="success" title="Email verified" action={<Link to={next} className="text-sm font-semibold underline">Continue</Link>}>
          Thanks — your email address is confirmed.
        </Alert>
      )}
      {state.status === 'error' && (
        <Alert tone="error" title="Couldn't verify" action={<Link to={next} className="text-sm font-semibold underline whitespace-nowrap">Continue</Link>}>
          {state.message} You can request a new link from your account.
        </Alert>
      )}
    </AuthLayout>
  );
}
