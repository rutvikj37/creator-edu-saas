import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyRound, LogOut, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SettingsTabs } from '../../components/layout/SettingsTabs.jsx';
import { PasswordInput } from '../../components/auth/PasswordInput.jsx';
import { TwoFactorSetup } from '../../components/account/TwoFactorSetup.jsx';
import { EmailVerificationBanner } from '../../components/account/EmailVerificationBanner.jsx';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, Input, Modal, Skeleton, toast } from '../../components/ui/index.js';
import { authApi } from '../../services/api/auth.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { applyApiErrors } from '../../utils/forms.js';
import { formatDate } from '../../utils/format.js';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(10, 'Password must be at least 10 characters').max(128),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

function ChangePasswordCard() {
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    try {
      const r = await authApi.changePassword({ currentPassword, newPassword });
      reset();
      toast.success('Password changed', { description: r.otherSessionsSignedOut ? `Signed out ${r.otherSessionsSignedOut} other device(s).` : undefined });
    } catch (e) {
      applyApiErrors(e, setError, ['currentPassword', 'newPassword']);
    }
  });
  return (
    <Card>
      <CardHeader title="Password" description="Changing your password signs out your other devices." />
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="grid max-w-xl gap-4">
          <PasswordInput label="Current password" autoComplete="current-password" {...register('currentPassword')} error={errors.currentPassword?.message} />
          <div className="grid gap-4 sm:grid-cols-2">
            <PasswordInput label="New password" autoComplete="new-password" {...register('newPassword')} error={errors.newPassword?.message} />
            <PasswordInput label="Confirm new password" autoComplete="new-password" {...register('confirm')} error={errors.confirm?.message} />
          </div>
          <div><Button type="submit" leftIcon={KeyRound} loading={isSubmitting}>Update password</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}

function TwoFactorCard() {
  const auth = useAuth();
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const enabled = Boolean(auth.user?.twoFactorEnabledAt);
  const { register, handleSubmit, setError, reset, formState: { errors, isSubmitting } } = useForm({ defaultValues: { password: '', code: '' } });

  const onDisable = handleSubmit(async (values) => {
    try {
      await authApi.disable2fa(values);
      toast.success('Two-factor authentication turned off');
      setDisableOpen(false);
      reset();
      await auth.reloadMe();
    } catch (e) {
      if (e.code === 'FORBIDDEN') {
        toast.error(e.message);
        setDisableOpen(false);
      } else applyApiErrors(e, setError, ['password', 'code']);
    }
  });

  return (
    <Card>
      <CardHeader
        title="Two-factor authentication"
        description="Require a code from your authenticator app when you sign in."
        actions={enabled ? <Badge tone="success" dot>On</Badge> : <Badge>Off</Badge>}
      />
      <CardBody className="flex flex-wrap items-center justify-between gap-4">
        <p className="flex items-center gap-2 text-sm text-fg-2">
          <Smartphone className="size-4 text-muted" aria-hidden />
          {enabled ? `Enabled on ${formatDate(auth.user.twoFactorEnabledAt)}` : 'Protect your account even if your password is stolen.'}
        </p>
        {enabled ? (
          <Button variant="secondary" onClick={() => setDisableOpen(true)}>Turn off</Button>
        ) : (
          <Button leftIcon={ShieldCheck} onClick={() => setSetupOpen(true)}>Set up</Button>
        )}
      </CardBody>
      <Modal open={setupOpen} onClose={() => setSetupOpen(false)} title="Set up two-factor authentication" size="lg">
        {setupOpen && (
          <TwoFactorSetup
            onEnabled={async (result) => {
              setSetupOpen(false);
              await auth.establish(result);
            }}
          />
        )}
      </Modal>
      <Modal
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        title="Turn off two-factor authentication?"
        description="Confirm with your password and a current code."
        footer={<><Button variant="secondary" onClick={() => setDisableOpen(false)}>Cancel</Button><Button variant="danger" loading={isSubmitting} onClick={onDisable}>Turn off</Button></>}
      >
        <form onSubmit={onDisable} noValidate className="space-y-4">
          <PasswordInput label="Password" {...register('password', { required: 'Enter your password' })} error={errors.password?.message} />
          <Input label="Authenticator code" inputMode="numeric" maxLength={6} {...register('code', { pattern: { value: /^\d{6}$/, message: 'Enter the 6-digit code' } })} error={errors.code?.message} />
        </form>
      </Modal>
    </Card>
  );
}

function describeAgent(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' on ');
}

function SessionsCard() {
  const auth = useAuth();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['auth', 'sessions'], queryFn: authApi.sessions });
  const [confirmAll, setConfirmAll] = useState(false);
  const revoke = useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: () => {
      toast.success('Device signed out');
      qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (e) => toast.error(e.message),
  });
  const logoutAll = useMutation({
    mutationFn: authApi.logoutAll,
    onSuccess: () => auth.logout(),
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader title="Where you're signed in" description="Sign out devices you don't recognise."
        actions={<Button variant="secondary" size="sm" leftIcon={LogOut} onClick={() => setConfirmAll(true)}>Sign out everywhere</Button>} />
      {sessions.isError ? (
        <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
      ) : (
        <ul className="divide-y divide-line">
          {sessions.isLoading
            ? [0, 1].map((i) => <li key={i} className="p-5"><Skeleton className="h-10 w-full" /></li>)
            : sessions.data.map((s) => (
                <li key={s.id} className="flex items-center gap-4 px-5 py-4">
                  <Monitor className="size-5 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{describeAgent(s.userAgent)} {s.current && <Badge tone="primary" className="ml-1.5">This device</Badge>}</p>
                    <p className="text-muted">{s.ip ?? 'Unknown IP'} · Last active {formatDate(s.lastUsedAt, { withTime: true })}</p>
                  </div>
                  {!s.current && (
                    <Button variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>Sign out</Button>
                  )}
                </li>
              ))}
        </ul>
      )}
      <ConfirmDialog open={confirmAll} onClose={() => setConfirmAll(false)} title="Sign out of all devices?"
        description="You'll be signed out here too and need to sign in again." confirmLabel="Sign out everywhere"
        loading={logoutAll.isPending} onConfirm={() => logoutAll.mutate()} />
    </Card>
  );
}

/** Account security: password, two-factor, active sessions. Shared by every panel. */
export function SecurityPage({ breadcrumbs = [] }) {
  return (
    <>
      <PageHeader title="Account security" description="Manage how you sign in and where you're signed in." breadcrumbs={[...breadcrumbs, { label: 'Account security' }]} /><SettingsTabs />
      <EmailVerificationBanner />
      <div className="space-y-6">
        <ChangePasswordCard />
        <TwoFactorCard />
        <SessionsCard />
      </div>
    </>
  );
}
