import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthLayout } from '../../components/auth/AuthLayout.jsx';
import { PasswordInput } from '../../components/auth/PasswordInput.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button } from '../../components/ui/index.js';
import { authApi } from '../../services/api/auth.js';
import { applyApiErrors } from '../../utils/forms.js';

const schema = z
  .object({
    password: z.string().min(10, 'Password must be at least 10 characters').max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [done, setDone] = useState(false);
  const [error, setError] = useState(token ? null : 'This reset link is incomplete. Request a new one.');
  const { register, handleSubmit, setError: setFieldError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await authApi.resetPassword({ token, password });
      setDone(true);
    } catch (e) {
      if (e.code === 'INVALID_TOKEN') setError(e.message);
      else applyApiErrors(e, setFieldError, ['password']);
    }
  });

  return (
    <AuthLayout title="Choose a new password" footer={<Link to="/login" className="font-medium text-primary-600 hover:underline">Back to sign in</Link>}>
      {done ? (
        <Alert tone="success" title="Password updated" action={<Link to="/login" className="text-sm font-semibold underline">Sign in</Link>}>
          For your security, all devices were signed out.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && (
            <Alert tone="error" action={<Link to="/forgot-password" className="text-sm font-semibold underline whitespace-nowrap">New link</Link>}>
              {error}
            </Alert>
          )}
          <PasswordInput label="New password" autoComplete="new-password" autoFocus {...register('password')} error={errors.password?.message} />
          <PasswordInput label="Confirm new password" autoComplete="new-password" {...register('confirm')} error={errors.confirm?.message} />
          <Button type="submit" className="w-full" loading={isSubmitting} disabled={!token}>Update password</Button>
        </form>
      )}
    </AuthLayout>
  );
}
