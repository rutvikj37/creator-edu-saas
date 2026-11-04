import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AuthLayout } from '../../components/auth/AuthLayout.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { PasswordInput } from '../../components/auth/PasswordInput.jsx';
import { Button, Input, Skeleton, toast } from '../../components/ui/index.js';
import { staffApi } from '../../services/api/creator.js';
import { useAuth } from '../../context/AuthContext.jsx';

/** Accept a staff invitation: sign in (existing account) or create an account. */
export function InvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const auth = useAuth();
  const navigate = useNavigate();
  const info = useQuery({ queryKey: ['invite', token], queryFn: () => staffApi.lookupInvite(token), enabled: Boolean(token), retry: false });
  const [form, setForm] = useState({ fullName: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await staffApi.acceptInvite(token);
      await auth.switchTenant(r.tenantId);
      toast.success(`Welcome to ${info.data.academy}`);
      navigate('/creator', { replace: true });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const register = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.establish(await staffApi.registerInvite({ token, ...form }));
      navigate('/creator', { replace: true });
    } catch (e) { setError(e.details?.[0]?.message ?? e.message); } finally { setBusy(false); }
  };

  return (
    <AuthLayout title="Join the team" subtitle={info.data ? `${info.data.academy} invited ${info.data.email} as ${info.data.role}.` : undefined}>
      {!token || info.isError ? <Alert tone="error">This invitation is invalid or has expired. Ask for a new one.</Alert> : info.isLoading ? <Skeleton className="h-32" /> : (
        <div className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          {auth.status === 'authenticated' ? (
            auth.user.email === info.data.email ? <Button className="w-full" loading={busy} onClick={accept}>Accept invitation</Button> : (
              <Alert tone="error" title="Different account">You're signed in as {auth.user.email}. Sign out and sign in as {info.data.email} to accept. <Button variant="link" onClick={() => auth.logout()}>Sign out</Button></Alert>
            )
          ) : info.data.hasAccount ? (
            <Link to={`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`} className="flex h-9 w-full items-center justify-center rounded-md bg-primary-600 text-sm font-medium text-on-primary">Sign in to accept</Link>
          ) : (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); register(); }}>
              <Input label="Email" value={info.data.email} disabled />
              <Input label="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              <PasswordInput label="Password" autoComplete="new-password" hint="At least 10 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <Button type="submit" className="w-full" loading={busy} disabled={form.fullName.trim().length < 2 || form.password.length < 10}>Create account & join</Button>
            </form>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
