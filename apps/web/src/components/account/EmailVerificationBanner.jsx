import { useState } from 'react';
import { MailWarning } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Button, Input, toast } from '../ui/index.js';
import { authApi } from '../../services/api/auth.js';
import { useAuth } from '../../context/AuthContext.jsx';

/** Prompts unverified users to confirm their email by code or by re-sending the link. */
export function EmailVerificationBanner() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, setError, reset, formState: { errors, isSubmitting } } = useForm({ defaultValues: { code: '' } });
  if (!auth.user || auth.user.emailVerifiedAt) return null;

  const resend = async () => {
    setBusy(true);
    try {
      await authApi.resendVerification();
      toast.success('Verification email sent', { description: `Check ${auth.user.email}` });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = handleSubmit(async ({ code }) => {
    if (!/^\d{6}$/.test(code)) return setError('code', { message: 'Enter the 6-digit code' });
    try {
      await authApi.verifyEmailCode(code);
      reset();
      toast.success('Email verified');
      await auth.reloadMe();
    } catch (e) {
      setError('code', { message: e.message });
    }
  });

  return (
    <div className="mb-6 flex flex-col gap-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 lg:flex-row lg:items-center dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <MailWarning className="size-5 shrink-0" aria-hidden />
      <div className="flex-1 text-sm">
        <p className="font-medium">Confirm your email address</p>
        <p className="opacity-90">We sent a link and a 6-digit code to {auth.user.email}.</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex items-start gap-2">
        <Input aria-label="Verification code" placeholder="6-digit code" inputMode="numeric" maxLength={6} className="w-32 bg-surface" {...register('code')} error={errors.code?.message} />
        <Button type="submit" size="md" loading={isSubmitting}>Verify</Button>
        <Button variant="ghost" onClick={resend} loading={busy}>Resend</Button>
      </form>
    </div>
  );
}
