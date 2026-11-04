import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail } from 'lucide-react';
import { AuthLayout } from '../../components/auth/AuthLayout.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Input } from '../../components/ui/index.js';
import { authApi } from '../../services/api/auth.js';

const schema = z.object({ email: z.email('Enter a valid email address') });

export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState(null);
  const [error, setError] = useState(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await authApi.forgotPassword(email);
      setSentTo(email);
    } catch (e) {
      setError(e.message);
    }
  });

  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new password."
      footer={<Link to="/login" className="font-medium text-primary-600 hover:underline">Back to sign in</Link>}>
      {sentTo ? (
        <Alert tone="success" title="Check your inbox">
          If an account exists for {sentTo}, a reset link is on its way. The link expires in 30 minutes.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Input label="Email" type="email" autoComplete="email" leftIcon={Mail} autoFocus {...register('email')} error={errors.email?.message} />
          <Button type="submit" className="w-full" loading={isSubmitting}>Send reset link</Button>
        </form>
      )}
    </AuthLayout>
  );
}
