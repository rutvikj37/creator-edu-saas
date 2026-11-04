import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { AuthLayout } from '../../components/auth/AuthLayout.jsx';
import { PasswordInput } from '../../components/auth/PasswordInput.jsx';
import { GoogleButton } from '../../components/auth/GoogleButton.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Input, Skeleton } from '../../components/ui/index.js';
import { academyApi, authApi } from '../../services/api/auth.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { applyApiErrors } from '../../utils/forms.js';

const schema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  email: z.email('Enter a valid email address'),
  password: z.string().min(10, 'Password must be at least 10 characters').max(128),
});

export function StudentRegisterPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000 });
  const [error, setError] = useState(null);
  const { register, handleSubmit, setError: setFieldError, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await auth.establish(await authApi.registerStudent(values));
      navigate('/learn', { replace: true });
    } catch (e) {
      if (e.code === 'CONFLICT' || e.code === 'FORBIDDEN') setError(e.message);
      else applyApiErrors(e, setFieldError, ['fullName', 'email', 'password']);
    }
  });

  return (
    <AuthLayout
      title="Create your account"
      subtitle={site.data ? `Join ${site.data.name} to start learning.` : undefined}
      footer={<>Already registered? <Link to="/login" className="font-medium text-primary-600 hover:underline">Sign in</Link></>}
    >
      {site.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : site.data && !site.data.acceptingRegistrations ? (
        <Alert tone="info" title="Registrations are not open yet">This academy hasn't launched. Please check back soon.</Alert>
      ) : (
        <>
          <GoogleButton />
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {error && <Alert tone="error">{error}</Alert>}
            <Input label="Full name" autoComplete="name" required {...register('fullName')} error={errors.fullName?.message} />
            <Input label="Email" type="email" autoComplete="email" required {...register('email')} error={errors.email?.message} />
            <PasswordInput label="Password" autoComplete="new-password" required hint="At least 10 characters." {...register('password')} error={errors.password?.message} />
            <Button type="submit" className="w-full" loading={isSubmitting}>Create account</Button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
