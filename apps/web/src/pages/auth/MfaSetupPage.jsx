import { Navigate, useNavigate } from 'react-router';
import { AuthLayout } from '../../components/auth/AuthLayout.jsx';
import { TwoFactorSetup } from '../../components/account/TwoFactorSetup.jsx';
import { Button } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { landingPath } from '../../routes/guards.jsx';

/** Mandatory enrolment for administrators before they can use the panel. */
export function MfaSetupPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  if (auth.me && !auth.me.mfaSetupRequired) return <Navigate to={landingPath(auth.me, auth.surface)} replace />;
  return (
    <AuthLayout
      title="Secure your admin account"
      subtitle="Administrators must use two-factor authentication. This takes about a minute."
      footer={<Button variant="link" onClick={() => auth.logout()}>Sign out</Button>}
    >
      <TwoFactorSetup
        onEnabled={async (result) => {
          const me = await auth.establish(result);
          navigate(landingPath(me, auth.surface), { replace: true });
        }}
      />
    </AuthLayout>
  );
}
