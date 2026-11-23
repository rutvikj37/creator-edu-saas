import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BarChart3, Copy, Link2, Mail, MessageCircle, Pencil, Plus, RotateCcw, ShoppingCart, Trash2, TrendingUp, Zap } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import {
  Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, Input, Modal, Select, Skeleton, StatCard, StatusBadge, Switch, Tabs, Textarea, toast,
} from '../../components/ui/index.js';
import { salesApi } from '../../services/api/commerce.js';
import { applyApiErrors } from '../../utils/forms.js';
import { formatDate, formatMoney, formatNumber } from '../../utils/format.js';

const KIND_LABELS = { course: 'Course', bundle: 'Bundle', product: 'Digital product', webinar: 'Webinar', membership: 'Membership' };
const itemKey = (kind, id) => `${kind}:${id}`;
const itemOptions = (items, kinds) => items.filter((i) => !kinds || kinds.includes(i.kind)).map((i) => ({ value: itemKey(i.kind, i.id), label: `${KIND_LABELS[i.kind]} · ${i.title} (${formatMoney(i.price, i.currency)})` }));
const toLocal = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const fromLocal = (v) => (v ? new Date(v).toISOString() : null);
const optNum = z.union([z.literal(''), z.coerce.number()]).transform((v) => (v === '' ? null : v));

function useSellable() {
  return useQuery({ queryKey: ['creator', 'sales', 'items'], queryFn: salesApi.items, staleTime: 60_000 });
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied');
  } catch {
    toast.error('Couldn’t copy — select the text and copy it manually');
  }
}

// ── Order bumps & upsells ───────────────────────────────────
const offerSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(120),
  headline: z.string().trim().min(2, 'At least 2 characters').max(160),
  description: z.string().trim().max(1000).optional(),
  item: z.string().min(1, 'Choose what to offer'),
  priceAmount: z.coerce.number({ message: 'Enter a price' }).positive('Enter a price above zero'),
  triggers: z.array(z.string()),
  windowMinutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(10080, 'At most 7 days'),
  active: z.boolean(),
});

const COPY = {
  BUMP: {
    noun: 'order bump', title: 'Order bumps', help: 'A one-click add-on shown as a checkbox on the checkout page, at a special price.',
    headline: 'Add the workbook for just ₹199', triggerHint: 'Show this bump when the cart contains any of these. Leave all unticked to show it on every checkout.',
  },
  UPSELL: {
    noun: 'upsell', title: 'Upsells after purchase', help: 'A limited-time offer shown on the order confirmation page right after a successful payment.',
    headline: 'Wait! Get the advanced course at 40% off', triggerHint: 'Offer this after any of these purchases. Leave all unticked to offer it after every purchase.',
  },
};

function OfferForm({ type, offer, items, onDone }) {
  const c = COPY[type];
  const form = useForm({
    resolver: zodResolver(offerSchema),
    defaultValues: {
      name: offer?.name ?? '', headline: offer?.headline ?? '', description: offer?.description ?? '', item: offer ? itemKey(offer.itemKind, offer.itemId) : '',
      priceAmount: offer ? Number(offer.priceAmount) : '', triggers: offer?.triggers ?? [], windowMinutes: offer?.windowMinutes ?? 30, active: offer ? offer.status === 'ACTIVE' : true,
    },
  });
  const { register, watch, setValue, formState: { errors, isSubmitting } } = form;
  const chosen = items.find((i) => itemKey(i.kind, i.id) === watch('item'));
  const triggers = watch('triggers');
  const submit = form.handleSubmit(async (v) => {
    const [itemKind, itemId] = v.item.split(':');
    const body = {
      type, name: v.name, headline: v.headline, description: v.description || null, itemKind, itemId, priceAmount: v.priceAmount,
      triggers: v.triggers.length ? v.triggers : null, windowMinutes: v.windowMinutes, status: v.active ? 'ACTIVE' : 'PAUSED',
    };
    try {
      if (offer) await salesApi.updateOffer(offer.id, body);
      else await salesApi.createOffer(body);
      toast.success(offer ? 'Offer saved' : 'Offer created');
      onDone();
    } catch (e) {
      applyApiErrors(e, form.setError, ['name', 'headline', 'priceAmount', 'triggers', 'windowMinutes']);
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Input label="Internal name" placeholder="Workbook bump" {...register('name')} error={errors.name?.message} required />
      <Select label="What to offer" placeholder="Choose a course, bundle or product" options={itemOptions(items, ['course', 'bundle', 'product'])} {...register('item')} error={errors.item?.message} required />
      <Input label="Offer price" type="number" step="0.01" min="0" {...register('priceAmount')} error={errors.priceAmount?.message} required
        hint={chosen ? `Regular price ${formatMoney(chosen.price, chosen.currency)}. The offer price can’t be higher.` : undefined} />
      <Input label="Headline buyers see" placeholder={c.headline} {...register('headline')} error={errors.headline?.message} required />
      <Textarea label="Description" rows={3} placeholder="One or two lines on why it’s worth adding." {...register('description')} error={errors.description?.message} />
      <Field label={type === 'BUMP' ? 'Show with' : 'Offer after buying'} hint={c.triggerHint} error={errors.triggers?.message}>
        {() => (
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-line p-2">
            {items.length === 0 && <p className="text-xs text-muted">Nothing on sale yet.</p>}
            {items.filter((i) => itemKey(i.kind, i.id) !== watch('item')).map((i) => {
              const k = itemKey(i.kind, i.id);
              return (
                <label key={k} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-surface-2">
                  <input type="checkbox" className="size-4 accent-primary-600" checked={triggers.includes(k)} onChange={(e) => setValue('triggers', e.target.checked ? [...triggers, k] : triggers.filter((x) => x !== k))} />
                  <span className="text-xs text-muted">{KIND_LABELS[i.kind]}</span> {i.title}
                </label>
              );
            })}
          </div>
        )}
      </Field>
      {type === 'UPSELL' && <Input label="Offer stays open for (minutes)" type="number" min="5" max="10080" {...register('windowMinutes')} error={errors.windowMinutes?.message} hint="After this the offer disappears from the order page." />}
      <Switch label="Active" checked={watch('active')} onChange={(v) => setValue('active', v)} />
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{offer ? 'Save' : `Create ${c.noun}`}</Button>
      </div>
    </form>
  );
}

export function UpsellsPage() {
  const qc = useQueryClient();
  const [type, setType] = useState('BUMP');
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const items = useSellable();
  const q = useQuery({ queryKey: ['creator', 'sales', 'offers', type], queryFn: () => salesApi.offers(type) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['creator', 'sales', 'offers'] });
  const status = useMutation({ mutationFn: ({ id, s }) => salesApi.offerStatus(id, s), onSuccess: refresh, onError: (e) => toast.error(e.message) });
  const remove = useMutation({
    mutationFn: (id) => salesApi.deleteOffer(id),
    onSuccess: (r) => { setToDelete(null); refresh(); toast.success(r.archived ? 'Offer archived — it has sales, so its history is kept' : 'Offer deleted'); },
    onError: (e) => toast.error(e.message),
  });
  const c = COPY[type];
  return (
    <>
      <PageHeader title="Upsells & order bumps" description="Raise your average order value with add-ons at checkout and one-time offers after purchase." breadcrumbs={[{ label: 'Sales' }, { label: 'Upsells & bumps' }]}
        actions={<Button leftIcon={Plus} onClick={() => setEditing('new')}>New {c.noun}</Button>} />
      <Tabs className="mb-4" value={type} onChange={setType} tabs={[{ value: 'BUMP', label: 'Order bumps' }, { value: 'UPSELL', label: 'Upsells after purchase' }]} />
      <p className="mb-4 text-sm text-muted">{c.help}</p>
      <Card>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data ?? []}
          empty={<EmptyState icon={Zap} title={`No ${c.noun}s yet`} description={c.help} action={<Button size="sm" leftIcon={Plus} onClick={() => setEditing('new')}>New {c.noun}</Button>} />}
          columns={[
            { key: 'name', header: 'Offer', cell: (r) => <div><p className="font-medium text-fg">{r.name}</p><p className="text-xs text-muted">{r.headline}</p></div> },
            { key: 'item', header: 'Item', cell: (r) => <div><p>{r.itemTitle}</p><p className="text-xs text-muted">{formatMoney(r.priceAmount, r.currency)}</p></div> },
            { key: 'triggers', header: type === 'BUMP' ? 'Shown with' : 'After buying', cell: (r) => (r.triggerTitles.length ? <span title={r.triggerTitles.join(', ')}>{r.triggerTitles.length === 1 ? r.triggerTitles[0] : `${r.triggerTitles.length} items`}</span> : <span className="text-muted">Everything</span>) },
            { key: 'accepted', header: 'Taken', align: 'right', cell: (r) => <span title={`${r.declined} declined`}>{formatNumber(r.accepted)}{type === 'UPSELL' && <span className="text-xs text-muted"> / {formatNumber(r.accepted + r.declined)}</span>}</span> },
            { key: 'revenue', header: 'Revenue', align: 'right', cell: (r) => formatMoney(r.revenue, r.currency) },
            { key: 'status', header: 'Active', cell: (r) => <Switch label={<span className="sr-only">Active</span>} checked={r.status === 'ACTIVE'} onChange={(v) => status.mutate({ id: r.id, s: v ? 'ACTIVE' : 'PAUSED' })} /> },
            {
              key: 'actions', header: '', align: 'right',
              cell: (r) => (
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.name}`} onClick={() => setToDelete(r)}><Trash2 className="size-4" /></Button>
                </div>
              ),
            },
          ]} />
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? `New ${c.noun}` : `Edit ${editing?.name ?? ''}`} size="lg">
        {editing && (items.data ? <OfferForm type={type} offer={editing === 'new' ? null : editing} items={items.data} onDone={() => { setEditing(null); refresh(); }} /> : <Skeleton className="h-80" />)}
      </Modal>
      <ConfirmDialog open={Boolean(toDelete)} onClose={() => setToDelete(null)} title={`Delete ${toDelete?.name}?`} description="Buyers stop seeing it. If it has already sold, it is archived instead so order history stays intact." confirmLabel="Delete" loading={remove.isPending} onConfirm={() => remove.mutate(toDelete.id)} />
    </>
  );
}

// ── Payment links ───────────────────────────────────────────
const linkSchema = z.object({
  title: z.string().trim().min(2, 'At least 2 characters').max(120),
  item: z.string().min(1, 'Choose what this link sells'),
  code: z.string().trim().refine((v) => v === '' || /^[A-Za-z0-9_-]{4,16}$/.test(v), '4–16 letters, digits, - or _'),
  priceAmount: optNum.refine((v) => v === null || v > 0, 'Enter a price above zero, or leave empty'),
  couponCode: z.string().trim().max(40),
  allowCoupons: z.boolean(),
  maxUses: optNum.refine((v) => v === null || (Number.isInteger(v) && v >= 1), 'Whole number, at least 1'),
  expiresAt: z.string(),
  note: z.string().trim().max(500),
  isActive: z.boolean(),
});

function LinkForm({ link, items, onDone }) {
  const form = useForm({
    resolver: zodResolver(linkSchema),
    defaultValues: {
      title: link?.title ?? '', item: link ? itemKey(link.itemKind, link.itemId) : '', code: link?.code ?? '', priceAmount: link?.priceAmount ? Number(link.priceAmount) : '',
      couponCode: link?.couponCode ?? '', allowCoupons: link?.allowCoupons ?? false, maxUses: link?.maxUses ?? '', expiresAt: toLocal(link?.expiresAt), note: link?.note ?? '', isActive: link?.isActive ?? true,
    },
  });
  const { register, watch, setValue, formState: { errors, isSubmitting } } = form;
  const chosen = items.find((i) => itemKey(i.kind, i.id) === watch('item'));
  const submit = form.handleSubmit(async (v) => {
    const [itemKind, itemId] = v.item.split(':');
    const body = {
      title: v.title, itemKind, itemId, priceAmount: v.priceAmount, couponCode: v.couponCode || null, allowCoupons: v.allowCoupons,
      maxUses: v.maxUses, expiresAt: fromLocal(v.expiresAt), note: v.note || null, isActive: v.isActive, ...(link ? {} : { code: v.code || undefined }),
    };
    try {
      const saved = link ? await salesApi.updateLink(link.id, body) : await salesApi.createLink(body);
      toast.success(link ? 'Link saved' : 'Link created — copy it and share it anywhere');
      onDone(saved);
    } catch (e) {
      applyApiErrors(e, form.setError, ['title', 'code', 'itemId', 'priceAmount', 'couponCode', 'maxUses', 'expiresAt']);
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Input label="Title" placeholder="Diwali offer — Python bootcamp" {...register('title')} error={errors.title?.message} required hint="Shown to the buyer on the payment page." />
      <Select label="Sells" placeholder="Choose an item" options={itemOptions(items)} {...register('item')} error={errors.item?.message ?? errors.itemId?.message} required />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Price" type="number" step="0.01" min="0" placeholder={chosen ? String(Number(chosen.price)) : 'Regular price'} {...register('priceAmount')} error={errors.priceAmount?.message}
          disabled={chosen?.kind === 'membership'} hint={chosen?.kind === 'membership' ? 'Memberships always use the plan price.' : 'Leave empty to charge the regular price.'} />
        <Input label="Link code" placeholder="Generated" {...register('code')} error={errors.code?.message} disabled={Boolean(link)} className="uppercase"
          hint={link ? 'The code can’t change once shared.' : 'Optional, e.g. DIWALI24.'} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Apply promo code automatically" placeholder="None" {...register('couponCode')} error={errors.couponCode?.message} className="uppercase" />
        <Input label="Maximum sales" type="number" min="1" placeholder="Unlimited" {...register('maxUses')} error={errors.maxUses?.message} />
      </div>
      <Switch label="Let buyers enter their own promo code" checked={watch('allowCoupons')} onChange={(v) => setValue('allowCoupons', v)} />
      <Input label="Expires" type="datetime-local" {...register('expiresAt')} error={errors.expiresAt?.message} hint="Leave empty to keep the link open." />
      <Textarea label="Message to the buyer" rows={2} {...register('note')} error={errors.note?.message} />
      <Switch label="Active" checked={watch('isActive')} onChange={(v) => setValue('isActive', v)} />
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={() => onDone()}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{link ? 'Save' : 'Create link'}</Button>
      </div>
    </form>
  );
}

export function PaymentLinksPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const items = useSellable();
  const q = useQuery({ queryKey: ['creator', 'sales', 'links'], queryFn: salesApi.links });
  const refresh = () => qc.invalidateQueries({ queryKey: ['creator', 'sales', 'links'] });
  const remove = useMutation({
    mutationFn: (id) => salesApi.deleteLink(id),
    onSuccess: (r) => { setToDelete(null); refresh(); toast.success(r.disabled ? 'Link switched off — it has orders, so it is kept' : 'Link deleted'); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <PageHeader title="Payment links" description="Share a direct link to buy any course, bundle, product, webinar or membership — over WhatsApp, Instagram or email." breadcrumbs={[{ label: 'Sales' }, { label: 'Payment links' }]}
        actions={<Button leftIcon={Plus} onClick={() => setEditing('new')}>New link</Button>} />
      <Card>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data ?? []}
          empty={<EmptyState icon={Link2} title="No payment links yet" description="Create a link with an optional special price, limit or expiry and share it anywhere." action={<Button size="sm" leftIcon={Plus} onClick={() => setEditing('new')}>New link</Button>} />}
          columns={[
            { key: 'title', header: 'Link', cell: (r) => <div><p className="font-medium text-fg">{r.title}</p><p className="text-xs text-muted">{r.itemTitle}</p></div> },
            {
              key: 'url', header: 'URL',
              cell: (r) => (
                <div className="flex items-center gap-1">
                  <span className="max-w-56 truncate font-mono text-xs" title={r.url}>{r.url}</span>
                  <Button variant="ghost" size="icon-sm" aria-label={`Copy link ${r.code}`} onClick={() => copy(r.url)}><Copy className="size-4" /></Button>
                </div>
              ),
            },
            { key: 'price', header: 'Price', cell: (r) => (r.priceAmount ? formatMoney(r.priceAmount, r.currency) : <span className="text-muted">Regular</span>) },
            { key: 'uses', header: 'Sales', align: 'right', cell: (r) => `${formatNumber(r.uses)}${r.maxUses ? ` / ${formatNumber(r.maxUses)}` : ''}` },
            { key: 'revenue', header: 'Revenue', align: 'right', cell: (r) => formatMoney(r.revenue, r.currency) },
            { key: 'expiresAt', header: 'Expires', cell: (r) => (r.expiresAt ? formatDate(r.expiresAt, { withTime: true }) : '—') },
            { key: 'state', header: 'Status', cell: (r) => <StatusBadge status={r.state} /> },
            {
              key: 'actions', header: '', align: 'right',
              cell: (r) => (
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${r.title}`} onClick={() => setEditing(r)}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.title}`} onClick={() => setToDelete(r)}><Trash2 className="size-4" /></Button>
                </div>
              ),
            },
          ]} />
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New payment link' : `Edit ${editing?.title ?? ''}`} size="lg">
        {editing && (items.data ? <LinkForm link={editing === 'new' ? null : editing} items={items.data} onDone={(saved) => { setEditing(null); refresh(); if (saved?.url && editing === 'new') copy(saved.url); }} /> : <Skeleton className="h-80" />)}
      </Modal>
      <ConfirmDialog open={Boolean(toDelete)} onClose={() => setToDelete(null)} title={`Delete ${toDelete?.title}?`} description="The link stops working. If anyone has ordered through it, it is switched off instead so reports stay accurate." confirmLabel="Delete" loading={remove.isPending} onConfirm={() => remove.mutate(toDelete.id)} />
    </>
  );
}

// ── Abandoned-checkout recovery ─────────────────────────────
const DELAYS = [[15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [180, '3 hours'], [360, '6 hours'], [720, '12 hours'], [1440, '1 day'], [2880, '2 days'], [4320, '3 days'], [7200, '5 days'], [10080, '7 days']];
const delayLabel = (m) => DELAYS.find(([v]) => v === m)?.[1] ?? `${m} minutes`;

function recoveryState(r) {
  if (r.recoveredAt) return <Badge tone="success" dot>Recovered</Badge>;
  if (r.recoveryStage >= 99) return <Badge dot>Finished</Badge>;
  if (r.recoveryStage > 0) return <Badge tone="info" dot>{r.recoveryStage} reminder{r.recoveryStage > 1 ? 's' : ''} sent</Badge>;
  return <Badge tone="warning" dot>Waiting</Badge>;
}

export function CartRecoveryPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['creator', 'sales', 'recovery'], queryFn: salesApi.recovery });
  const stats = useQuery({ queryKey: ['creator', 'sales', 'recovery', 'stats'], queryFn: salesApi.recoveryStats });
  const recent = useQuery({ queryKey: ['creator', 'sales', 'recovery', 'recent'], queryFn: salesApi.recoveryRecent });
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState({});
  useEffect(() => { if (q.data) setDraft({ enabled: q.data.enabled, steps: q.data.steps, couponCode: q.data.couponCode ?? '', whatsapp: q.data.whatsapp }); }, [q.data]);
  const save = useMutation({
    mutationFn: () => salesApi.saveRecovery({ ...draft, couponCode: draft.couponCode.trim() || null }),
    onSuccess: (r) => { setErrors({}); qc.setQueryData(['creator', 'sales', 'recovery'], r); toast.success('Recovery settings saved'); },
    onError: (e) => { const m = Object.fromEntries((e.details ?? []).map((d) => [d.field, d.message])); setErrors(m); if (!e.details?.length) toast.error(e.message); },
  });
  const s = stats.data;
  const setStep = (i, v) => setDraft((d) => ({ ...d, steps: d.steps.map((x, j) => (j === i ? v : x)) }));
  const rate = s && s.abandoned ? Math.round((s.recovered / s.abandoned) * 1000) / 10 : null;
  return (
    <>
      <PageHeader title="Cart recovery" description="Automatically remind buyers who started checkout but didn’t pay, by email and WhatsApp." breadcrumbs={[{ label: 'Sales' }, { label: 'Cart recovery' }]} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Abandoned checkouts" value={formatNumber(s?.abandoned)} hint="Last 30 days" icon={ShoppingCart} loading={stats.isLoading} />
        <StatCard label="Reminded" value={formatNumber(s?.reminded)} icon={Mail} loading={stats.isLoading} />
        <StatCard label="Recovered" value={formatNumber(s?.recovered)} hint={rate !== null ? `${rate}% of abandoned` : undefined} icon={RotateCcw} loading={stats.isLoading} />
        <StatCard label="Recovered revenue" value={s && (s.revenue.length ? s.revenue.map((x) => formatMoney(x.amount, x.currency)).join(' · ') : formatMoney(0, 'INR'))} icon={TrendingUp} loading={stats.isLoading} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_1fr]">
        <Card>
          <CardHeader title="Reminders" description="Sent only to signed-in buyers who haven’t paid or bought the item another way." />
          <CardBody className="space-y-4">
            {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !draft ? <Skeleton className="h-64" /> : (
              <>
                <Switch label="Send recovery reminders" checked={draft.enabled} onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))} />
                <Field label="Send after" error={errors.steps} hint="Up to three reminders, timed from when checkout started.">
                  {() => (
                    <div className="space-y-2">
                      {draft.steps.map((m, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="w-20 text-sm text-muted">Reminder {i + 1}</span>
                          <div className="flex-1">
                            <Select aria-label={`Reminder ${i + 1} delay`} value={String(m)} onChange={(e) => setStep(i, Number(e.target.value))}
                              options={DELAYS.map(([v, l]) => ({ value: String(v), label: l }))} />
                          </div>
                          {draft.steps.length > 1 && <Button variant="ghost" size="icon-sm" aria-label={`Remove reminder ${i + 1}`} onClick={() => setDraft((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }))}><Trash2 className="size-4" /></Button>}
                        </div>
                      ))}
                      {draft.steps.length < 3 && (
                        <Button variant="secondary" size="sm" leftIcon={Plus} onClick={() => setDraft((d) => ({ ...d, steps: [...d.steps, DELAYS.find(([v]) => v > (d.steps.at(-1) ?? 0))?.[0] ?? 10080] }))}>Add reminder</Button>
                      )}
                    </div>
                  )}
                </Field>
                <Input label="Promo code in the last reminder" placeholder="None" value={draft.couponCode} onChange={(e) => setDraft((d) => ({ ...d, couponCode: e.target.value.toUpperCase() }))} error={errors.couponCode}
                  hint="Optional. Pre-applied when the buyer opens the link from the final reminder." />
                <div className="space-y-1">
                  <Switch label="Also send on WhatsApp" checked={draft.whatsapp} disabled={!q.data.whatsappAvailable} onChange={(v) => setDraft((d) => ({ ...d, whatsapp: v }))} />
                  <p className="pl-12 text-xs text-muted">
                    {q.data.whatsappAvailable ? 'Sent to buyers who added a phone number to their profile.' : 'WhatsApp isn’t set up on this platform yet — ask the platform admin to connect it.'}
                  </p>
                </div>
                <div className="flex justify-end border-t border-line pt-4"><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
              </>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent abandoned checkouts" description={draft ? `Schedule: ${draft.steps.map(delayLabel).join(', ')}` : undefined} />
          <DataTable loading={recent.isLoading} error={recent.error} onRetry={() => recent.refetch()} rows={recent.data ?? []}
            empty={<EmptyState icon={MessageCircle} title="No abandoned checkouts" description="Unpaid checkouts show up here once reminders start going out." className="py-10" />}
            columns={[
              { key: 'buyer', header: 'Buyer', cell: (r) => <div><p className="text-fg">{r.buyer?.fullName ?? 'Unknown'}</p><p className="text-xs text-muted">{r.buyer?.email}</p></div> },
              { key: 'items', header: 'Items', cell: (r) => <span className="line-clamp-1" title={r.items.map((i) => i.title).join(', ')}>{r.items.map((i) => i.title).join(', ')}</span> },
              { key: 'totalAmount', header: 'Total', align: 'right', cell: (r) => formatMoney(r.totalAmount, r.currency) },
              { key: 'createdAt', header: 'Started', cell: (r) => formatDate(r.createdAt, { withTime: true }) },
              { key: 'state', header: 'Status', cell: recoveryState },
            ]} />
        </Card>
      </div>
    </>
  );
}

// ── Ad tracking ─────────────────────────────────────────────
const TRACKERS = [
  { key: 'metaPixelId', label: 'Meta (Facebook) Pixel ID', placeholder: '123456789012345', hint: 'Events Manager → Data sources → your pixel. Numbers only.' },
  { key: 'ga4Id', label: 'Google Analytics 4 measurement ID', placeholder: 'G-XXXXXXXXXX', hint: 'Admin → Data streams → Web → Measurement ID.' },
  { key: 'gtmId', label: 'Google Tag Manager container ID', placeholder: 'GTM-XXXXXXX', hint: 'Use this instead of the two above if you manage tags in GTM.' },
];

export function TrackingPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['creator', 'sales', 'tracking'], queryFn: salesApi.tracking });
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState({});
  useEffect(() => { if (q.data) setDraft({ metaPixelId: q.data.metaPixelId ?? '', ga4Id: q.data.ga4Id ?? '', gtmId: q.data.gtmId ?? '' }); }, [q.data]);
  const save = useMutation({
    mutationFn: () => salesApi.saveTracking(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim() || null]))),
    onSuccess: (r) => { setErrors({}); qc.setQueryData(['creator', 'sales', 'tracking'], r); toast.success('Tracking saved — it applies to your academy site within a minute'); },
    onError: (e) => { const m = Object.fromEntries((e.details ?? []).map((d) => [d.field, d.message])); setErrors(m); if (!e.details?.length) toast.error(e.message); },
  });
  return (
    <>
      <PageHeader title="Tracking pixels" description="Measure your ads: we load these on your academy site and send page views, checkouts and purchases." breadcrumbs={[{ label: 'Growth' }, { label: 'Tracking pixels' }]} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,560px)_1fr]">
        <Card>
          <CardBody className="space-y-4">
            {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !draft ? <Skeleton className="h-64" /> : (
              <>
                {TRACKERS.map((t) => (
                  <Input key={t.key} label={t.label} placeholder={t.placeholder} hint={t.hint} value={draft[t.key]} error={errors[t.key]} className="font-mono uppercase"
                    onChange={(e) => setDraft((d) => ({ ...d, [t.key]: e.target.value }))} />
                ))}
                <div className="flex justify-end border-t border-line pt-4"><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
              </>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Events we send" />
          <CardBody>
            <ul className="space-y-2 text-sm">
              {[['PageView', 'Every page of your academy site'], ['ViewContent', 'Course, bundle and product pages'], ['InitiateCheckout', 'When the checkout page opens'], ['Purchase', 'Once per paid order, with its value and currency']].map(([e, d]) => (
                <li key={e} className="flex gap-3"><BarChart3 className="mt-0.5 size-4 shrink-0 text-primary-600" /><span><span className="font-mono text-fg">{e}</span> <span className="text-muted">— {d}</span></span></li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted">GA4 receives the matching recommended events (page_view, view_item, begin_checkout, purchase). Visitors whose browser sends “Do Not Track” are not tracked.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
