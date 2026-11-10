import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { AuthLayout } from '../../components/auth/AuthLayout.jsx';
import { PasswordInput } from '../../components/auth/PasswordInput.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Input, Select } from '../../components/ui/index.js';
import { useQuery } from '@tanstack/react-query';
import { creatorApi } from '../../services/api/platform.js';
import { authApi } from '../../services/api/auth.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { applyApiErrors } from '../../utils/forms.js';
import { countryOptions } from '../../utils/countries.js';

export const signupSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  email: z.email('Enter a valid email address'),
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +919876543210').optional().or(z.literal('')),
  password: z.string().min(10, 'Password must be at least 10 characters').max(128),
  country: z.string().regex(/^[A-Z]{2}$/, 'Select a country'),
  businessName: z.string().trim().min(2, 'Enter your academy or business name').max(120),
});

const FIELDS = ['fullName', 'email', 'phone', 'password', 'country', 'businessName'];

/** Creator sign-up: creates the account and the academy workspace in one step. */
export function SignupPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const countries = useMemo(() => countryOptions(i18n.language), [i18n.language]);
  const [error, setError] = useState(null);
  const plans = useQuery({ queryKey: ['public', 'plans'], queryFn: creatorApi.publicPlans, staleTime: 5 * 60_000 });
  const trialDays = plans.data?.find((p) => p.isDefault)?.trialDays ?? 0;
  const { register, handleSubmit, setError: setFieldError, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(signupSchema),
    defaultValues: { fullName: '', email: '', phone: '', password: '', country: 'IN', businessName: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const result = await authApi.registerCreator({ ...values, phone: values.phone || undefined });
      await auth.establish(result);
      navigate('/creator', { replace: true });
    } catch (e) {
      if (e.code === 'CONFLICT') setError(e.message);
      else applyApiErrors(e, setFieldError, FIELDS);
    }
  });

  return (
    <AuthLayout
      title="Create your academy"
      subtitle={trialDays > 0 ? `Free for ${trialDays} days. No card needed — choose a plan only if you want to continue.` : 'Start selling courses in minutes. You can change everything later.'}
      footer={<>Already have an account? <Link to="/login" className="font-medium text-primary-600 hover:underline">Sign in</Link></>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Input label="Full name" autoComplete="name" required {...register('fullName')} error={errors.fullName?.message} />
        <Input label="Work email" type="email" autoComplete="email" required {...register('email')} error={errors.email?.message} />
        <Input label="Academy or business name" required hint="Used for your academy address, e.g. your-name.platform.com" {...register('businessName')} error={errors.businessName?.message} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Country" required options={countries} {...register('country')} error={errors.country?.message} />
          <Input label="Mobile (optional)" type="tel" autoComplete="tel" placeholder="+91…" {...register('phone')} error={errors.phone?.message} />
        </div>
        <PasswordInput label="Password" autoComplete="new-password" required hint="At least 10 characters. A short phrase works well." {...register('password')} error={errors.password?.message} />
        <Button type="submit" className="w-full" loading={isSubmitting}>Create account</Button>
        <p className="text-center text-xs text-muted">By continuing you agree to the Terms of Service and Privacy Policy.</p>
      </form>
    </AuthLayout>
  );
}
