import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button, Card, CardBody, CardHeader, Checkbox, ErrorState, Input, Select, Skeleton, Switch, Textarea, toast } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { applyApiErrors } from '../../utils/forms.js';

export const planSchema = z.object({
  code: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'Lowercase letters, digits and hyphens'),
  name: z.string().trim().min(2, 'Enter a name').max(100),
  description: z.string().max(500).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
  isPublic: z.boolean(),
  isDefault: z.boolean(),
  trialDays: z.coerce.number().int().min(0).max(365),
  sortOrder: z.coerce.number().int().min(0).max(1000),
  prices: z.array(z.object({ interval: z.enum(['MONTH', 'YEAR']), currency: z.string().regex(/^[A-Z]{3}$/, '3-letter code'), amount: z.coerce.number().min(0, 'Must be ≥ 0') })),
});

const blank = { code: '', name: '', description: '', status: 'DRAFT', isPublic: true, isDefault: false, trialDays: 0, sortOrder: 0, prices: [] };

export function PlanEditorPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const features = useQuery({ queryKey: ['platform', 'features'], queryFn: platformApi.features });
  const plan = useQuery({ queryKey: ['platform', 'plan', id], queryFn: () => platformApi.plan(id), enabled: !isNew });
  const [featureState, setFeatureState] = useState({});
  const form = useForm({ resolver: zodResolver(planSchema), defaultValues: blank });
  const prices = useFieldArray({ control: form.control, name: 'prices' });

  useEffect(() => {
    if (plan.data) {
      const p = plan.data;
      form.reset({ ...blank, ...p, description: p.description ?? '', prices: p.prices.filter((x) => x.active).map((x) => ({ interval: x.interval, currency: x.currency, amount: Number(x.amount) })) });
      setFeatureState(Object.fromEntries(p.features.map((f) => [f.featureKey, { enabled: f.enabled, limitValue: f.limitValue ?? '' }])));
    }
  }, [plan.data, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    const body = {
      ...values,
      features: Object.entries(featureState).filter(([, v]) => v.enabled !== undefined).map(([featureKey, v]) => ({ featureKey, enabled: v.enabled, limitValue: v.limitValue === '' || v.limitValue === undefined ? null : Number(v.limitValue) })),
    };
    try {
      const saved = isNew ? await platformApi.createPlan(body) : await platformApi.updatePlan(id, body);
      toast.success(isNew ? 'Plan created' : 'Plan saved');
      qc.invalidateQueries({ queryKey: ['platform', 'plans'] });
      if (isNew) navigate(`/super-admin/plans/${saved.id}`, { replace: true });
    } catch (e) {
      if (e.code === 'CONFLICT') form.setError('code', { message: 'This code is already used by another plan' });
      else applyApiErrors(e, form.setError, ['code', 'name', 'description', 'trialDays', 'sortOrder', 'prices']);
    }
  });

  if (plan.isError) return <Card><ErrorState error={plan.error} onRetry={() => plan.refetch()} /></Card>;
  if (!isNew && plan.isLoading) return <Skeleton className="h-96" />;
  const { register, formState: { errors, isSubmitting }, watch, setValue } = form;

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader title={isNew ? 'New plan' : `Edit ${plan.data?.name}`} breadcrumbs={[{ label: 'Plans', to: '/super-admin/plans' }, { label: isNew ? 'New' : plan.data?.name }]}
        actions={<Button type="submit" loading={isSubmitting}>{isNew ? 'Create plan' : 'Save changes'}</Button>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Input label="Name" required {...register('name')} error={errors.name?.message} />
              <Input label="Code" required hint="Stable identifier, e.g. growth" {...register('code')} error={errors.code?.message} />
              <div className="sm:col-span-2"><Textarea label="Description" rows={2} {...register('description')} error={errors.description?.message} /></div>
              <Input label="Trial days" type="number" min={0} {...register('trialDays')} error={errors.trialDays?.message} />
              <Input label="Sort order" type="number" min={0} {...register('sortOrder')} error={errors.sortOrder?.message} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Features" description="Leave a limit empty for unlimited. Unchecked features are not included." />
            <div className="divide-y divide-line">
              {(features.data ?? []).map((f) => {
                const s = featureState[f.key];
                return (
                  <div key={f.key} className="flex flex-wrap items-center gap-4 px-5 py-3">
                    <Checkbox label={f.label} description={f.key} checked={Boolean(s?.enabled)} onChange={(e) => setFeatureState((st) => ({ ...st, [f.key]: { enabled: e.target.checked, limitValue: s?.limitValue ?? '' } }))} className="flex-1" />
                    {f.kind === 'limit' && s?.enabled && (
                      <Input aria-label={`${f.label} limit`} type="number" min={0} placeholder="Unlimited" className="w-32" value={s.limitValue} onChange={(e) => setFeatureState((st) => ({ ...st, [f.key]: { ...s, limitValue: e.target.value } }))} />
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Availability" />
            <CardBody className="space-y-4">
              <Select label="Status" options={[{ value: 'DRAFT', label: 'Draft' }, { value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }]} {...register('status')} />
              <Switch label="Shown on pricing page" checked={watch('isPublic')} onChange={(v) => setValue('isPublic', v, { shouldDirty: true })} />
              <Switch label="Default for new academies" checked={watch('isDefault')} onChange={(v) => setValue('isDefault', v, { shouldDirty: true })} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Prices" actions={<Button size="sm" variant="secondary" leftIcon={Plus} onClick={() => prices.append({ interval: 'MONTH', currency: 'INR', amount: 0 })}>Add</Button>} />
            <CardBody className="space-y-3">
              {prices.fields.length === 0 && <p className="text-sm text-muted">No prices: the plan is free or complimentary.</p>}
              {prices.fields.map((field, i) => (
                <div key={field.id} className="flex items-start gap-2">
                  <Select aria-label="Interval" options={[{ value: 'MONTH', label: 'Monthly' }, { value: 'YEAR', label: 'Yearly' }]} {...register(`prices.${i}.interval`)} className="w-28" />
                  <Input aria-label="Currency" className="w-20 uppercase" maxLength={3} {...register(`prices.${i}.currency`)} error={errors.prices?.[i]?.currency?.message} />
                  <Input aria-label="Amount" type="number" step="0.01" min={0} {...register(`prices.${i}.amount`)} error={errors.prices?.[i]?.amount?.message} />
                  <Button variant="ghost" size="icon" aria-label="Remove price" onClick={() => prices.remove(i)}><Trash2 className="size-4" /></Button>
                </div>
              ))}
              {errors.prices?.message && <p className="text-xs text-red-600">{errors.prices.message}</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </form>
  );
}
