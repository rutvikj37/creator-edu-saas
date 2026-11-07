import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Download, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { ListToolbar } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { saveBlob } from '../../utils/download.js';
import { Button, Card, ConfirmDialog, DataTable, EmptyState, Field, Input, Modal, Select, StatusBadge, Switch, Textarea, toast } from '../../components/ui/index.js';
import { creatorCommerceApi } from '../../services/api/commerce.js';
import { coursesApi } from '../../services/api/creator.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { applyApiErrors } from '../../utils/forms.js';
import { formatDate, formatMoney } from '../../utils/format.js';

const optNum = z.union([z.literal(''), z.coerce.number()]).transform((v) => (v === '' ? null : v));
const schema = z
  .object({
    code: z.string().trim().refine((v) => v === '' || /^[A-Za-z0-9_-]{3,40}$/.test(v), '3–40 letters, digits, - or _'),
    description: z.string().trim().max(200).optional(),
    type: z.enum(['PERCENT', 'FIXED']),
    value: z.coerce.number({ message: 'Enter a value' }).positive('Enter a value above zero'),
    maxRedemptions: optNum.refine((v) => v === null || (Number.isInteger(v) && v >= 1), 'Whole number, at least 1'),
    perUserLimit: z.coerce.number().int().min(1).max(1000),
    minOrderAmount: optNum.refine((v) => v === null || v >= 0, 'Cannot be negative'),
    maxDiscountAmount: optNum.refine((v) => v === null || v >= 1, 'Enter at least 1'),
    showAtCheckout: z.boolean(),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    courseIds: z.array(z.string()),
    isActive: z.boolean(),
  })
  .refine((v) => v.type !== 'PERCENT' || v.value <= 100, { path: ['value'], message: 'Percent must be 100 or less' })
  .refine((v) => !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt), { path: ['endsAt'], message: 'End must be after the start' });

const toLocal = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
const fromLocal = (v) => (v ? new Date(v).toISOString() : null);

/** Same alphabet as the API: no 0/O or 1/I/L, so codes are easy to read out. */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const randomCode = (n = 8) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');

export function discountLabel(c, currency) {
  if (c.type !== 'PERCENT') return `${formatMoney(c.value, currency)} off`;
  return `${Number(c.value)}% off${c.maxDiscountAmount ? `, up to ${formatMoney(c.maxDiscountAmount, currency)}` : ''}`;
}

function CouponForm({ coupon, courses, onDone }) {
  const used = coupon?.redemptionCount > 0;
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      code: coupon?.code ?? '', description: coupon?.description ?? '', type: coupon?.type ?? 'PERCENT', value: coupon ? Number(coupon.value) : '',
      maxRedemptions: coupon?.maxRedemptions ?? '', perUserLimit: coupon?.perUserLimit ?? 1, minOrderAmount: coupon?.minOrderAmount ? Number(coupon.minOrderAmount) : '',
      startsAt: toLocal(coupon?.startsAt), endsAt: toLocal(coupon?.endsAt), courseIds: coupon?.courseIds ?? [], isActive: coupon?.isActive ?? true,
      maxDiscountAmount: coupon?.maxDiscountAmount ? Number(coupon.maxDiscountAmount) : '', showAtCheckout: coupon?.showAtCheckout ?? false,
    },
  });
  const { register, formState: { errors, isSubmitting }, watch, setValue } = form;
  const type = watch('type');
  const selected = watch('courseIds');
  const submit = form.handleSubmit(async (v) => {
    const body = { ...v, code: v.code || undefined, description: v.description || null, startsAt: fromLocal(v.startsAt), endsAt: fromLocal(v.endsAt), courseIds: v.courseIds.length ? v.courseIds : null, maxDiscountAmount: v.type === 'PERCENT' ? v.maxDiscountAmount : null };
    if (used) { delete body.code; delete body.type; delete body.value; }
    try {
      if (coupon) await creatorCommerceApi.updateCoupon(coupon.id, body);
      else await creatorCommerceApi.createCoupon(body);
      toast.success(coupon ? 'Coupon updated' : 'Coupon created');
      onDone();
    } catch (e) {
      applyApiErrors(e, form.setError, ['code', 'value', 'endsAt', 'courseIds', 'maxRedemptions', 'minOrderAmount', 'maxDiscountAmount']);
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-1 rounded-lg border border-line bg-surface-2/40 p-3">
        <Switch label="Suggest during checkout" checked={watch('showAtCheckout')} onChange={(v) => setValue('showAtCheckout', v)} />
        <p className="pl-12 text-xs text-muted">Students see this offer on the checkout page and can apply it in one tap.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" hint={coupon ? undefined : 'Leave empty and we’ll generate a random code.'} error={errors.code?.message}>
          {(p) => (
            <div className="flex gap-2">
              <input {...p} placeholder="LAUNCH20" {...register('code')} disabled={used}
                className="h-10 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-sm uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60" />
              {!used && <Button variant="secondary" onClick={() => setValue('code', randomCode(), { shouldValidate: true })}>Generate</Button>}
            </div>
          )}
        </Field>
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
      {type === 'PERCENT' && <Input label="Maximum discount (₹)" type="number" step="0.01" min="1" placeholder="No limit" hint="e.g. 20% off, but at most ₹500." {...register('maxDiscountAmount')} error={errors.maxDiscountAmount?.message} disabled={used} />}
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
        <Button type="submit" loading={isSubmitting}>{coupon ? 'Save' : 'Create promo code'}</Button>
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
  const [stateF, setStateF] = useState();
  const [courseF, setCourseF] = useState();
  const [checkoutF, setCheckoutF] = useState();
  const all = q.data ?? [];
  const rows = all.filter((r) => (!stateF || r.state === stateF) && (!courseF || !r.courseIds?.length || r.courseIds.includes(courseF)) && (!checkoutF || String(Boolean(r.showAtCheckout)) === checkoutF));
  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['code', 'discount', 'applies_to', 'used', 'max_uses', 'starts', 'ends', 'status', 'shown_at_checkout'].join(','),
      ...all.map((r) => [r.code, discountLabel(r, currency), r.courseIds?.length ? `${r.courseIds.length} courses` : 'All courses', r.redemptionCount, r.maxRedemptions ?? '', r.startsAt ?? '', r.endsAt ?? '', r.state, r.showAtCheckout ? 'yes' : 'no'].map(esc).join(','))];
    saveBlob(new Blob([lines.join('\n')], { type: 'text/csv' }), 'promo-codes.csv');
  };
  return (
    <>
      <PageHeader title="Promo codes" count={q.data && !search ? all.length : undefined} description="Give your learners the best offers. Students enter these codes at checkout." breadcrumbs={[{ label: 'Coupons' }]}
        actions={<><Button variant="secondary" leftIcon={Download} onClick={exportCsv} disabled={!all.length}>Export as CSV</Button><Button leftIcon={Plus} onClick={() => setEditing('new')}>New</Button></>} />
      <Card>
        <ListToolbar search={search} onSearch={setSearch} placeholder="Search by code" count={rows.length} noun="promo code"
          filtered={Boolean(search || stateF || courseF || checkoutF)} onReset={() => { setSearch(''); setStateF(undefined); setCourseF(undefined); setCheckoutF(undefined); }}
          filters={<>
            <FilterChip label="Course" value={courseF} onChange={setCourseF} options={paid.map((c) => ({ value: c.id, label: c.title }))} panelClassName="w-72" />
            <FilterChip label="Status" value={stateF} onChange={setStateF} options={['ACTIVE', 'SCHEDULED', 'EXPIRED', 'EXHAUSTED', 'DISABLED'].map((x) => ({ value: x, label: x[0] + x.slice(1).toLowerCase() }))} />
            <FilterChip label="Checkout" value={checkoutF} onChange={setCheckoutF} options={[{ value: 'true', label: 'Suggested at checkout' }, { value: 'false', label: 'Code only' }]} />
          </>} />
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={rows}
          empty={all.length || search ? <EmptyState icon={Tag} title="No promo codes match" description="Try a different search or clear the filters." /> : <EmptyState icon={Tag} title="You have no promo codes" description="Promo codes are discount coupons students use to buy your courses at a lower price, like LAUNCH20." action={<Button size="sm" leftIcon={Plus} onClick={() => setEditing('new')}>New promo code</Button>} />}
          columns={[
            { key: 'code', header: 'Code', cell: (r) => <div><p className="flex items-center gap-2 font-mono font-medium text-fg">{r.code}{r.showAtCheckout && <span className="rounded-full bg-primary-50 px-1.5 py-0.5 font-sans text-[10px] font-medium text-primary-700 dark:bg-primary-500/15 dark:text-primary-300">At checkout</span>}</p>{r.description && <p className="text-xs text-muted">{r.description}</p>}</div> },
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
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New promo code' : `Edit ${editing?.code ?? ''}`} size="lg">
        {editing && <CouponForm coupon={editing === 'new' ? null : editing} courses={paid} onDone={() => { setEditing(null); refresh(); }} />}
      </Modal>
      <ConfirmDialog open={Boolean(toDelete)} onClose={() => setToDelete(null)} title={`Delete ${toDelete?.code}?`} description="Students can no longer use it. Past orders keep their discount." confirmLabel="Delete" loading={remove.isPending} onConfirm={() => remove.mutate(toDelete.id)} />
    </>
  );
}
