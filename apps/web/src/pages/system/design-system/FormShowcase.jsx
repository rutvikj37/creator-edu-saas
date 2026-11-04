import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail } from 'lucide-react';
import { Button, Checkbox, Input, Select, Textarea, toast } from '../../../components/ui/index.js';

export const academySchema = z.object({
  name: z.string().trim().min(3, 'Academy name must be at least 3 characters').max(80),
  email: z.email('Enter a valid email address'),
  category: z.string().min(1, 'Choose a category'),
  description: z.string().max(280, 'Keep it under 280 characters').optional(),
  terms: z.literal(true, { error: 'You must accept the terms' }),
});

/** Demonstrates the standard form pattern: zod schema + react-hook-form + Field components. */
export function FormShowcase() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(academySchema), defaultValues: { name: '', email: '', category: '', description: '' } });

  const onSubmit = async () => {
    toast.success('Form is valid', { description: 'In real screens this submits to the API.' });
    reset();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid max-w-2xl gap-4 sm:grid-cols-2">
      <Input label="Academy name" required {...register('name')} error={errors.name?.message} />
      <Input label="Contact email" type="email" leftIcon={Mail} required {...register('email')} error={errors.email?.message} />
      <Select
        label="Category"
        required
        placeholder="Select a category"
        options={[
          { value: 'tech', label: 'Technology' },
          { value: 'exam', label: 'Exam preparation' },
          { value: 'arts', label: 'Arts & design' },
        ]}
        {...register('category')}
        error={errors.category?.message}
      />
      <div className="sm:col-span-2">
        <Textarea label="Short description" hint="Shown on your academy home page." {...register('description')} error={errors.description?.message} />
      </div>
      <div className="sm:col-span-2">
        <Checkbox label="I accept the terms" {...register('terms')} />
        {errors.terms && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{errors.terms.message}</p>}
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" loading={isSubmitting}>Validate</Button>
        <Button variant="secondary" onClick={() => reset()}>Reset</Button>
      </div>
    </form>
  );
}
