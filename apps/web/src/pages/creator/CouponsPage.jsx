import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import { Button, Card, ConfirmDialog, DataTable, EmptyState, Field, Input, Modal, Select, StatusBadge, Switch, Textarea, toast } from '../../components/ui/index.js';
import { creatorCommerceApi } from '../../services/api/commerce.js';
import { coursesApi } from '../../services/api/creator.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { applyApiErrors } from '../../utils/forms.js';
import { formatDate, formatMoney } from '../../utils/format.js';

const optNum = z.union([z.literal(''), z.coerce.number()]).transform((v) => (v === '' ? null : v));
const schema = z
  .object({
    code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,40}$/, '3–40 letters, digits, - or _'),
    description: z.string().trim().max(200).optional(),
    type: z.enum(['PERCENT', 'FIXED']),
    value: z.coerce.number({ message: 'Enter a value' }).positive('Enter a value above zero'),
    maxRedemptions: optNum.refine((v) => v === null || (Number.isInteger(v) && v >= 1), 'Whole number, at least 1'),
    perUserLimit: z.coerce.number().int().min(1).max(1000),
    minOrderAmount: optNum.refine((v) => v === null || v >= 0, 'Cannot be negative'),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    courseIds: z.array(z.string()),
    isActive: z.boolean(),
  })
  .refine((v) => v.type !== 'PERCENT' || v.value <= 100, { path: ['value'], message: 'Percent must be 100 or less' })
  .refine((v) => !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt), { path: ['endsAt'], message: 'End must be after the start' });

const toLocal = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
const fromLocal = (v) => (v ? new Date(v).toISOString() : null);

function discountLabel(c, currency) {
  return c.type === 'PERCENT' ? `${Number(c.value)}% off` : `${formatMoney(c.value, currency)} off`;
}

function CouponForm({ coupon, courses, onDone }) {
  const used = coupon?.redemptionCount > 0;
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      code: coupon?.code ?? '', description: coupon?.description ?? '', type: coupon?.type ?? 'PERCENT', value: coupon ? Number(coupon.value) : '',
      maxRedemptions: coupon?.maxRedemptions ?? '', perUserLimit: coupon?.perUserLimit ?? 1, minOrderAmount: coupon?.minOrderAmount ? Number(coupon.minOrderAmount) : '',
      startsAt: toLocal(coupon?.startsAt), endsAt: toLocal(coupon?.endsAt), courseIds: coupon?.courseIds ?? [], isActive: coupon?.isActive ?? true,
    },
  });
  const { register, formState: { errors, isSubmitting }, watch, setValue } = form;
  const type = watch('type');
  const selected = watch('courseIds');
  const submit = form.handleSubmit(async (v) => {
    const body = { ...v, description: v.description || null, startsAt: fromLocal(v.startsAt), endsAt: fromLocal(v.endsAt), courseIds: v.courseIds.length ? v.courseIds : null };
    if (used) { delete body.code; delete body.type; delete body.value; }
    try {
      if (coupon) await creatorCommerceApi.updateCoupon(coupon.id, body);
      else await creatorCommerceApi.createCoupon(body);
      toast.success(coupon ? 'Coupon updated' : 'Coupon created');
      onDone();
    } catch (e) {
      applyApiErrors(e, form.setError, ['code', 'value', 'endsAt', 'courseIds', 'maxRedemptions', 'minOrderAmount']);
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Code" placeholder="LAUNCH20" className="uppercase" {...register('code')} disabled={used} error={errors.code?.message} required />
        <div className="grid grid-cols-2 gap-2">
          <Select label="Discount" options={[{ value: 'PERCENT', label: 'Percent' }, { value: 'FIXED', label: 'Fixed amount' }]} {...register('type')} disabled={used} />
          <Input label={type === 'PERCENT' ? 'Percent' : 'Amount'} type="number" step="0.01" min="0" {...register('value')} disabled={used} error={errors.value?.message} required />
        </div>
      </div>
      {used && <p className="text-xs text-muted">This coupon has been used, so its code and discount are locked. Create a new coupon to change them.</p>}
      <Textarea label="Internal note" rows={2} {...register('description')} error={errors.description?.message} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Total uses" type="number" min="1" placeholder="Unlimited" {...register('maxRedemptions')} error={errors.maxRedemptions?.message} />
        <Input label="Uses per student" type="number" min="1" {...register('perUserLimit')} error={errors.perUserLimit?.message} />
        <Input label="Minimum price" type="number" step="0.01" min="0" placeholder="None" {...register('minOrderAmount')} error={errors.minOrderAmount?.message} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Starts" type="datetime-local" {...register('startsAt')} error={errors.startsAt?.message} />
        <Input label="Ends" type="datetime-local" {...register('endsAt')} error={errors.endsAt?.message} />
      </div>
      <Field label="Applies to" hint="Leave all unticked to apply to every paid course." error={errors.courseIds?.message}>
        {() => (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-line p-2">
            {courses.length === 0 && <p className="text-xs text-muted">No paid courses yet.</p>}
            {courses.map((c) => (
              <label key={c.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-surface-2">
                <input type="checkbox" className="size-4 accent-primary-600" checked={selected.includes(c.id)} onChange={(e) => setValue('courseIds', e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))} />
                {c.title}
              </label>
            ))}
          </div>
        )}
      </Field>
      <Switch label="Active" checked={watch('isActive')} onChange={(v) => setValue('isActive', v)} />
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{coupon ? 'Save' : 'Create coupon'}</Button>
      </div>
    </form>
  );
}

export function CouponsPage() {
  const qc = useQueryClient();
  const auth = useAuth();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const q = useQuery({ queryKey: ['creator', 'coupons', search], queryFn: () => creatorCommerceApi.coupons(search), placeholderData: (p) => p });
  const courses = useQuery({ queryKey: ['creator', 'courses', 'paid'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const paid = (courses.data?.items ?? []).filter((c) => !c.isFree);
  const currency = auth.activeTenant?.defaultCurrency ?? 'INR';
  const refresh = () => qc.invalidateQueries({ queryKey: ['creator', 'coupons'] });
  const remove = useMutation({ mutationFn: (id) => creatorCommerceApi.deleteCoupon(id), onSuccess: () => { setToDelete(null); refresh(); toast.success('Coupon deleted'); }, onError: (e) => toast.error(e.message) });
  return (
    <>
      <PageHeader title="Coupons" description="Discount codes students enter at checkout." breadcrumbs={[{ label: 'Sales' }, { label: 'Coupons' }]} actions={<Button leftIcon={Plus} onClick={() => setEditing('new')}>New coupon</Button>} />
      <Card>
        <div className="border-b border-line p-4"><SearchInput className="md:w-80" value={search} onChange={setSearch} placeholder="Search code" /></div>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data ?? []}
          empty={<EmptyState icon={Tag} title="No coupons yet" description="Create a code like LAUNCH20 to run a promotion." action={<Button size="sm" leftIcon={Plus} onClick={() => setEditing('new')}>New coupon</Button>} />}
          columns={[
            { key: 'code', header: 'Code', cell: (r) => <div><p className="font-mono font-medium text-fg">{r.code}</p>{r.description && <p className="text-xs text-muted">{r.description}</p>}</div> },
            { key: 'value', header: 'Discount', cell: (r) => discountLabel(r, currency) },
            { key: 'scope', header: 'Applies to', cell: (r) => (r.courseIds?.length ? `${r.courseIds.length} course${r.courseIds.length > 1 ? 's' : ''}` : 'All courses') },
            { key: 'redemptionCount', header: 'Used', cell: (r) => `${r.redemptionCount}${r.maxRedemptions ? ` / ${r.maxRedemptions}` : ''}` },
            { key: 'endsAt', header: 'Ends', cell: (r) => formatDate(r.endsAt) },
            { key: 'state', header: 'Status', cell: (r) => <StatusBadge status={r.state} /> },
            {
              key: 'actions', header: '', align: 'right',
              cell: (r) => (
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${r.code}`} onClick={() => setEditing(r)}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.code}`} onClick={() => setToDelete(r)}><Trash2 className="size-4" /></Button>
                </div>
              ),
            },
          ]} />
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New coupon' : `Edit ${editing?.code ?? ''}`} size="lg">
        {editing && <CouponForm coupon={editing === 'new' ? null : editing} courses={paid} onDone={() => { setEditing(null); refresh(); }} />}
      </Modal>
      <ConfirmDialog open={Boolean(toDelete)} onClose={() => setToDelete(null)} title={`Delete ${toDelete?.code}?`} description="Students can no longer use it. Past orders keep their discount." confirmLabel="Delete" loading={remove.isPending} onConfirm={() => remove.mutate(toDelete.id)} />
    </>
  );
}
