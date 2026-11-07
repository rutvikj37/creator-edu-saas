import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Gift, Wallet } from 'lucide-react';
import { RichTextEditor } from '../../components/forms/RichTextEditor.jsx';
import { Button, Card, ConfirmDialog, Input, toast } from '../../components/ui/index.js';
import { coursesApi } from '../../services/api/creator.js';
import { creatorApi } from '../../services/api/platform.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { cn } from '../../utils/cn.js';
import { formatMoney } from '../../utils/format.js';

/** Selling price, original price and discount % from the two price fields. */
export function coursePricing({ plan, total, discounted }) {
  if (plan === 'FREE') return { isFree: true, priceAmount: null, compareAtAmount: null, percentOff: 0 };
  const t = total === '' ? null : Number(total);
  const d = discounted === '' ? null : Number(discounted);
  const sell = d ?? t;
  const compare = d !== null && t !== null && t > d ? t : null;
  return { isFree: false, priceAmount: sell, compareAtAmount: compare, percentOff: compare ? Math.round(((compare - sell) / compare) * 100) : 0 };
}

function PlanCard({ value, current, onSelect, icon: Icon, title, body }) {
  const on = value === current;
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors', on ? 'border-primary-500 bg-primary-50/60 ring-1 ring-primary-500 dark:bg-primary-500/10' : 'border-line hover:border-line-strong')}>
      <input type="radio" name="plan" value={value} checked={on} onChange={() => onSelect(value)} className="mt-1 size-4 accent-primary-600" />
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', on ? 'bg-primary-600 text-on-primary' : 'bg-surface-2 text-fg-2')}><Icon className="size-4" aria-hidden /></span>
      <span><span className="block font-medium text-fg">{title}</span><span className="block text-sm text-muted">{body}</span></span>
    </label>
  );
}

/**
 * Full-page course creation (Graphy style): title, description and pricing up front, then
 * "Next" goes straight to the curriculum builder.
 */
export function CourseCreatePage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState(null);
  const [plan, setPlan] = useState('ONE_TIME');
  const [total, setTotal] = useState('');
  const [discounted, setDiscounted] = useState('');
  const [errors, setErrors] = useState({});
  const [confirmLeave, setConfirmLeave] = useState(false);
  const billing = useQuery({ queryKey: ['creator', 'billing'], queryFn: creatorApi.billing, enabled: auth.can('billing.manage'), retry: false });
  const commission = Number(billing.data?.entitlements?.features?.['commission.percent']?.limit ?? billing.data?.features?.['commission.percent']?.limit ?? 0);
  const pricing = coursePricing({ plan, total, discounted });
  const dirty = Boolean(title || description || total || discounted);

  useEffect(() => {
    document.title = 'Create a course · Creator Education';
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const validate = () => {
    const e = {};
    if (title.trim().length < 3) e.title = 'Enter a title of at least 3 characters';
    if (!description) e.description = 'Add a short description of what students will learn';
    if (plan === 'ONE_TIME') {
      if (total === '' || Number(total) <= 0) e.total = 'Enter the course price';
      if (discounted !== '' && Number(discounted) >= Number(total)) e.discounted = 'Discounted price must be lower than the total price';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const create = useMutation({
    mutationFn: () => coursesApi.create({ title: title.trim(), description, isFree: pricing.isFree, priceAmount: pricing.priceAmount, compareAtAmount: pricing.compareAtAmount }),
    onSuccess: (c) => { toast.success('Course created'); navigate(`/creator/courses/${c.id}?tab=curriculum`); },
    onError: (e) => {
      const map = { title: 'title', description: 'description', priceAmount: 'total', compareAtAmount: 'discounted' };
      const byField = Object.fromEntries((e.details ?? []).map((d) => [map[d.field] ?? 'form', d.message]));
      setErrors(Object.keys(byField).length ? byField : { form: e.message });
    },
  });
  const submit = () => validate() && create.mutate();
  const leave = () => (dirty ? setConfirmLeave(true) : navigate('/creator/courses'));
  const sell = pricing.priceAmount ?? 0;
  const youGet = sell * (1 - commission / 100);

  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:-mx-8">
      <div className="sticky top-14 z-20 flex items-center justify-between gap-4 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" aria-label="Back to courses" onClick={leave}><ArrowLeft className="size-4" /></Button>
          <h1 className="text-lg font-semibold tracking-tight">Create a course</h1>
        </div>
        <Button loading={create.isPending} onClick={submit}>Next</Button>
      </div>

      <form className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Card className="space-y-5 p-6">
          <Input label="Title" required autoFocus value={title} maxLength={200} placeholder="Enter course title" error={errors.title}
            onChange={(e) => { setTitle(e.target.value); setErrors((x) => ({ ...x, title: undefined })); }} />
          <RichTextEditor label="Description *" value={description} placeholder="What will students learn? Who is it for?" error={errors.description}
            onChange={(v) => { setDescription(v); setErrors((x) => ({ ...x, description: undefined })); }} />
        </Card>

        <Card className="space-y-4 p-6">
          <div>
            <h2 className="font-semibold">Set pricing</h2>
            <p className="text-sm text-muted">You can change pricing and access rules later under the course’s pricing tab.</p>
          </div>
          <div role="radiogroup" aria-label="Pricing plan" className="grid gap-3 sm:grid-cols-2">
            <PlanCard value="FREE" current={plan} onSelect={setPlan} icon={Gift} title="Free plan" body="Unrestricted access to your content, free of cost." />
            <PlanCard value="ONE_TIME" current={plan} onSelect={setPlan} icon={Wallet} title="One-time plan" body="Full course access with a single payment." />
          </div>
          {plan === 'ONE_TIME' && (
            <div className="space-y-4 rounded-xl border border-line bg-surface-2/40 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Total price (₹)" required type="number" min="1" step="0.01" inputMode="decimal" value={total} error={errors.total}
                  onChange={(e) => { setTotal(e.target.value); setErrors((x) => ({ ...x, total: undefined, discounted: undefined })); }} />
                <Input label={`Discounted price (₹)${pricing.percentOff ? ` · ${pricing.percentOff}% off` : ''}`} type="number" min="0" step="0.01" inputMode="decimal" value={discounted} error={errors.discounted}
                  hint="Optional. Students see the total price struck through."
                  onChange={(e) => { setDiscounted(e.target.value); setErrors((x) => ({ ...x, discounted: undefined })); }} />
              </div>
              {sell > 0 && (
                <p className="rounded-lg bg-surface px-3 py-2 text-sm text-fg-2 ring-1 ring-line">
                  {formatMoney(sell, 'INR')} <span className="text-muted">(student pays)</span>
                  {commission > 0 && <> − {formatMoney(sell - youGet, 'INR')} <span className="text-muted">({commission}% platform fee)</span></>}
                  {' '}= <span className="font-semibold text-fg">{formatMoney(youGet, 'INR')}</span> <span className="text-muted">you receive, before GST and payment fees</span>
                </p>
              )}
            </div>
          )}
        </Card>
        {errors.form && <p role="alert" className="text-sm text-red-600">{errors.form}</p>}
        <button type="submit" hidden />
      </form>

      <ConfirmDialog open={confirmLeave} onClose={() => setConfirmLeave(false)} title="Quit creating this course?" description="If you leave now, what you’ve entered will be lost."
        confirmLabel="Leave" onConfirm={() => navigate('/creator/courses')} />
    </div>
  );
}
