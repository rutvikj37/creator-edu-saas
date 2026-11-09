import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Calendar, CalendarRange, Check, ChevronDown, Crown, Info, Pencil, Percent, Plus, Search, Trash2, Wallet } from 'lucide-react';
import { FileUpload } from '../../components/forms/FileUpload.jsx';
import { Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Modal, SegmentedControl, Select, Skeleton, Switch, Textarea, toast } from '../../components/ui/index.js';
import { membershipsApi } from '../../services/api/community.js';
import { coursesApi } from '../../services/api/creator.js';
import { cn } from '../../utils/cn.js';
import { formatMoney } from '../../utils/format.js';

const STEPS = ['Enter Details', 'Add Products', 'Pricing'];

/** Full-page, three-step membership builder (create and edit). */
export function MembershipBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const existing = useQuery({ queryKey: ['memberships', 'plan', id], queryFn: () => membershipsApi.get(id), enabled: Boolean(id) });
  const courses = useQuery({ queryKey: ['creator', 'courses', 'all'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const stats = useQuery({ queryKey: ['memberships', 'stats'], queryFn: membershipsApi.stats });
  const [advanced, setAdvanced] = useState(false);
  const [other, setOther] = useState(true);
  const [step, setStep] = useState(0);
  const [planId, setPlanId] = useState(id ?? null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [faqEdit, setFaqEdit] = useState(null); // { index, question, answer }
  const [picker, setPicker] = useState(false);
  const [leave, setLeave] = useState(false);
  const [f, setF] = useState({ name: '', description: '', cover: null, faqs: [], courseIds: [], planName: '', interval: 'MONTH', price: '', sale: '', status: 'DRAFT', buttonText: '', lifetime: false, taxExclusive: null, passFee: false });
  useEffect(() => {
    const p = existing.data;
    if (!p) return;
    setF({ name: p.name, description: p.description ?? '', cover: p.coverFileId ? { id: p.coverFileId, url: p.coverUrl } : null, faqs: p.faqs ?? [], courseIds: p.courseIds, planName: p.planName ?? '', interval: p.interval,
      price: p.compareAtAmount ? Number(p.compareAtAmount) : Number(p.priceAmount) || '', sale: p.compareAtAmount ? Number(p.priceAmount) : '', status: p.status,
      buttonText: p.buttonText ?? '', lifetime: p.lifetime, taxExclusive: p.taxExclusive, passFee: Boolean(p.passTransactionFee) });
  }, [existing.data]);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const all = courses.data?.items ?? [];
  const chosen = f.courseIds.map((cid) => all.find((c) => c.id === cid)).filter(Boolean);
  const price = Number(f.price) || 0;
  const sale = f.sale === '' ? null : Number(f.sale);
  const charge = sale !== null && sale < price ? sale : price;
  const pricing = stats.data?.pricing ?? { gstRegistered: false, taxRate: 0, pricesIncludeTax: true, commissionPercent: 0 };
  const exclusive = f.taxExclusive ?? !pricing.pricesIncludeTax;
  const rate = pricing.gstRegistered ? pricing.taxRate : 0;
  const fee = f.passFee ? Math.round((rate && exclusive ? charge * (1 + rate / 100) : charge) * 2.36) / 100 : 0;
  const effective = (rate && exclusive ? charge * (1 + rate / 100) : charge) + fee;
  const net = rate && !exclusive ? charge / (1 + rate / 100) : charge;
  const receive = net * (1 - (pricing.commissionPercent ?? 0) / 100);

  const validate = () => {
    const e = {};
    if (step === 0 && !f.name.trim()) e.name = 'Name your membership';
    if (step === 1 && !f.courseIds.length) e.courseIds = 'Add at least one course';
    if (step === 2) {
      if (!(charge >= 1)) e.price = 'Enter a price of at least 1';
      if (sale !== null && sale >= price) e.sale = 'The sale price must be lower than the price';
    }
    setErrors(e);
    return !Object.keys(e).length;
  };
  const body = (publish) => {
    if (step === 0) return { name: f.name.trim(), description: f.description.trim() || null, coverFileId: f.cover?.id ?? null, faqs: f.faqs };
    if (step === 1) return { courseIds: f.courseIds };
    return {
      planName: f.planName.trim() || null, interval: f.interval, priceAmount: charge, compareAtAmount: sale !== null && sale < price ? price : null,
      buttonText: f.buttonText.trim() || null, lifetime: f.lifetime, taxExclusive: f.taxExclusive, passTransactionFee: f.passFee, ...(publish ? { status: 'ACTIVE' } : {}),
    };
  };
  const save = async (publish = false) => {
    if (!validate()) return false;
    setBusy(true);
    try {
      const p = planId ? await membershipsApi.update(planId, body(publish)) : await membershipsApi.create(body(publish));
      setPlanId(p.id);
      if (publish) { toast.success('Membership published'); navigate('/creator/memberships'); }
      return true;
    } catch (e) {
      const map = Object.fromEntries((e.details ?? []).map((x) => [x.field === 'priceAmount' ? 'price' : x.field === 'compareAtAmount' ? 'sale' : x.field, x.message]));
      setErrors(map);
      toast.error(e.details?.[0]?.message ?? e.message);
      return false;
    } finally { setBusy(false); }
  };
  const next = async () => { if (await save()) setStep((s) => s + 1); };

  if (id && existing.isLoading) return <Skeleton className="h-96" />;
  return (
    <div className="-mt-2">
      <div className="sticky top-0 z-10 -mx-4 mb-6 flex items-center gap-3 border-b border-line bg-surface-2/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Button variant="ghost" aria-label="Back" onClick={() => (step > 0 ? setStep(step - 1) : setLeave(true))}><ArrowLeft className="size-4" /></Button>
        <ol className="mx-auto flex items-center gap-2 text-sm" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              {i > 0 && <span className="hidden h-px w-8 bg-line sm:block" aria-hidden />}
              <button type="button" disabled={i > step} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined} className={cn('flex items-center gap-1.5 font-medium', i === step ? 'text-fg' : i < step ? 'text-fg-2' : 'text-muted')}>
                <span className={cn('grid size-4 place-items-center rounded-full border', i < step ? 'border-primary-600 bg-primary-600 text-on-primary' : i === step ? 'border-primary-600' : 'border-line-strong')}>{i < step && <Check className="size-3" aria-hidden />}</span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            </li>
          ))}
        </ol>
        {step < 2 ? <Button loading={busy} onClick={next}>Continue</Button>
          : <><Button variant="ghost" disabled={busy} onClick={async () => { if (await save()) { toast.success(f.status === 'ACTIVE' ? 'Saved' : 'Saved as a draft'); navigate('/creator/memberships'); } }}>Skip</Button><Button loading={busy} onClick={() => save(true)}>Publish</Button></>}
      </div>

      {step === 0 && (
        <>
          <div className="mb-6 text-center"><h1 className="text-3xl font-semibold tracking-tight">Membership details</h1><p className="mt-1 text-sm text-muted">This is what your audience will see on your website landing page.</p></div>
          <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
            <div className="space-y-6">
              <Card className="space-y-2 p-5">
                <div className="flex items-end justify-between"><div><p className="font-semibold">Membership name</p><p className="text-sm text-muted">This name will be shown to your audience.</p></div><span className="text-xs text-muted">{f.name.length}/100</span></div>
                <Input aria-label="Membership name" maxLength={100} placeholder="My Membership" value={f.name} error={errors.name} onChange={(e) => set({ name: e.target.value })} />
              </Card>
              <Card className="space-y-2 p-5">
                <div className="flex items-end justify-between"><div><p className="font-semibold">Description</p><p className="text-sm text-muted">This will be shown to your audience.</p></div><span className="text-xs text-muted">{f.description.length}/1000</span></div>
                <Textarea aria-label="Description" rows={5} maxLength={1000} placeholder="Welcome to my membership community" value={f.description} onChange={(e) => set({ description: e.target.value })} />
              </Card>
              <Card className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-semibold">Frequently asked questions</p><p className="text-sm text-muted">Answer what people ask before they join.</p></div>
                  <Button variant="secondary" leftIcon={Plus} onClick={() => setFaqEdit({ index: -1, question: '', answer: '' })}>Add</Button>
                </div>
                {!f.faqs.length && <p className="text-sm text-muted italic">No FAQs yet.</p>}
                {f.faqs.map((q, i) => (
                  <div key={i} className="rounded-xl border border-line p-4">
                    <div className="flex items-start gap-2">
                      <p className="flex-1 font-semibold">{q.question}</p>
                      <Button size="sm" variant="ghost" aria-label={`Edit question ${i + 1}`} onClick={() => setFaqEdit({ index: i, ...q })}><Pencil className="size-4 text-primary-600" /></Button>
                      <Button size="sm" variant="ghost" aria-label={`Delete question ${i + 1}`} onClick={() => set({ faqs: f.faqs.filter((_, j) => j !== i) })}><Trash2 className="size-4 text-red-600" /></Button>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-sm text-fg-2">{q.answer}</p>
                  </div>
                ))}
              </Card>
            </div>
            <Card className="h-fit space-y-3 p-5">
              <div className="flex items-start justify-between"><div><p className="font-semibold">Upload cover image</p><p className="text-xs text-muted">Landscape 4:3 works best, e.g. 1600×1200.</p></div>{f.cover && <Pencil className="size-4 text-primary-600" aria-hidden />}</div>
              <div className="aspect-[4/3] overflow-hidden rounded-lg bg-gradient-to-br from-amber-200 to-amber-500">
                {f.cover?.url ? <img src={f.cover.url} alt="Cover preview" className="size-full object-cover" /> : <div className="grid size-full place-items-center"><span className="grid size-16 place-items-center rounded-full bg-white/40 text-amber-700"><Crown className="size-7" aria-hidden /></span></div>}
              </div>
              <FileUpload purpose="IMAGE" accept="image/png,image/jpeg,image/webp" label={f.cover ? 'Replace cover' : 'Upload cover'} preview="none" onUploaded={(file) => set({ cover: { id: file.id, url: file.url } })} />
              {f.cover && <Button size="sm" variant="ghost" onClick={() => set({ cover: null })}>Remove cover</Button>}
            </Card>
          </div>
        </>
      )}

      {step === 1 && (
        <Card className="grid min-h-[60vh] md:grid-cols-[12rem_1fr]">
          <nav aria-label="Product types" className="border-b border-line p-4 md:border-r md:border-b-0">
            <p className="mb-2 text-sm text-muted">Products</p>
            <span className="block rounded-lg bg-primary-50 px-3 py-2 text-sm font-medium text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">Courses</span>
          </nav>
          <div className="p-4">
            {!chosen.length ? (
              <EmptyState icon={Search} title="No courses added" description="Add courses to your membership" className="h-full" action={<Button onClick={() => setPicker(true)}>Add Course</Button>} />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between"><p className="font-semibold">{chosen.length} course{chosen.length === 1 ? '' : 's'} included</p><Button size="sm" variant="secondary" leftIcon={Plus} onClick={() => setPicker(true)}>Add Course</Button></div>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {chosen.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 p-3">
                      <Thumb c={c} />
                      <div className="min-w-0 flex-1"><p className="truncate font-medium">{c.title}</p><p className="text-xs text-muted">{c.status === 'PUBLISHED' ? `${c.lessonCount ?? 0} lessons` : 'Not published yet — members get it once you publish'}</p></div>
                      <Button size="sm" variant="ghost" aria-label={`Remove ${c.title}`} onClick={() => set({ courseIds: f.courseIds.filter((x) => x !== c.id) })}><Trash2 className="size-4" /></Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {errors.courseIds && <p className="mt-2 text-sm text-red-600">{errors.courseIds}</p>}
          </div>
        </Card>
      )}

      {step === 2 && (
        <>
          <div className="mb-6 text-center"><h1 className="text-3xl font-semibold tracking-tight">Setup Pricing</h1><p className="mt-1 text-sm text-muted">Add a pricing to begin with. You can change it later.</p></div>
          <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
            <div className="space-y-6">
              <Card className="space-y-3 p-5">
                <div><p className="text-xl font-semibold">Plan name</p><p className="text-sm text-muted">This name will be shown to your audience</p></div>
                <Input aria-label="Plan name" placeholder="Enter plan name" maxLength={100} value={f.planName} onChange={(e) => set({ planName: e.target.value })} />
              </Card>
              <Card className="space-y-4 p-5">
                <div><p className="font-semibold">Choose a type of pricing plan</p><p className="text-sm text-muted">Choose how you want your audience to pay</p></div>
                <div className="flex items-center gap-3 rounded-lg border border-line p-3">
                  <span className="grid size-10 place-items-center rounded-lg bg-surface-2"><Wallet className="size-5" aria-hidden /></span>
                  <div><p className="font-medium">One-time payment</p><p className="text-sm text-muted">Charge a single fee with a time-bound or lifetime access</p></div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <MoneyInput label="Price" value={f.price} error={errors.price} onChange={(v) => set({ price: v })} />
                  <MoneyInput label="Sale price" value={f.sale} error={errors.sale} hint="Optional. Lower than the price; shown with the price struck through." onChange={(v) => set({ sale: v })} />
                </div>
                <div>
                  <p className="mb-1.5 text-sm font-medium text-fg">Transaction fees</p>
                  <div className="flex items-center gap-3 rounded-lg border border-line p-3">
                    <span className="grid size-10 place-items-center rounded-lg bg-surface-2"><Wallet className="size-5" aria-hidden /></span>
                    <div className="flex-1"><label htmlFor="pass-fee" className="font-medium">Charge transaction fee</label><p className="text-sm text-muted">When on, members pay Razorpay’s 2.36% charge. When off, you cover it.</p></div>
                    <Switch id="pass-fee" checked={f.passFee} onChange={(v) => set({ passFee: v })} />
                  </div>
                </div>
                <div className="grid gap-4 rounded-lg bg-surface-2/60 p-4 sm:grid-cols-2">
                  <div><p className="text-sm font-medium">Effective price</p><p className="text-xl font-semibold" title="What the member pays, including GST">{formatMoney(effective, 'INR')}</p><p className="text-xs text-muted">{rate ? `${exclusive ? 'Price + ' : 'Includes '}${rate}% GST` : 'No GST charged'}{fee ? ` + ${formatMoney(fee, 'INR')} transaction fee` : ''}</p></div>
                  <div><p className="text-sm font-medium">You will receive</p><p className="text-xl font-semibold">{formatMoney(receive, 'INR')}</p><p className="text-xs text-muted">After {rate ? 'GST' : ''}{rate && pricing.commissionPercent ? ' and ' : ''}{pricing.commissionPercent ? `${pricing.commissionPercent}% platform commission` : rate ? '' : 'no deductions'}, {f.passFee ? 'Razorpay’s charge is paid by the member' : 'before Razorpay fees'}</p></div>
                </div>
                <button type="button" aria-expanded={advanced} onClick={() => setAdvanced((x) => !x)} className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 dark:text-primary-300">Advanced settings<ChevronDown className={cn('size-4 transition-transform', advanced && 'rotate-180')} aria-hidden /></button>
                {advanced && (
                  <div className="space-y-4">
                    <Input label="Customize button text" maxLength={40} placeholder="Get Access Now" value={f.buttonText} onChange={(e) => set({ buttonText: e.target.value })} />
                    <div>
                      <p className="mb-1.5 text-sm font-medium text-fg">Expiry settings</p>
                      <div className="flex flex-col gap-3 rounded-lg border border-line p-3 sm:flex-row sm:items-center">
                        <span className="grid size-10 place-items-center rounded-lg bg-surface-2"><CalendarRange className="size-5" aria-hidden /></span>
                        <div className="flex-1"><p className="font-medium">Plan duration</p><p className="text-sm text-muted">Valid for a time period or keep unlimited</p></div>
                        <SegmentedControl size="sm" label="Plan duration" value={f.lifetime ? 'unlimited' : 'limited'} onChange={(v) => set({ lifetime: v === 'unlimited' })} options={[{ value: 'limited', label: 'Limited' }, { value: 'unlimited', label: 'Unlimited' }]} />
                      </div>
                      {!f.lifetime && <Select className="mt-3" label="Access period per payment" value={f.interval} onChange={(e) => set({ interval: e.target.value })} options={[{ value: 'MONTH', label: '1 month — members renew by paying again' }, { value: 'YEAR', label: '1 year — members renew by paying again' }]} />}
                      <p className="mt-2 text-xs text-muted">{f.lifetime ? 'One payment gives access for as long as the membership exists. No renewals.' : 'We email members 7 days before their access ends so they can renew. There is no automatic card charge.'}</p>
                    </div>
                  </div>
                )}
              </Card>
              <Card className="space-y-4 p-5">
                <button type="button" aria-expanded={other} onClick={() => setOther((x) => !x)} className="flex w-full items-start justify-between text-left">
                  <span><span className="block font-semibold">Other settings</span><span className="text-sm text-muted">You can modify these later as well</span></span>
                  <ChevronDown className={cn('size-4 text-muted transition-transform', other && 'rotate-180')} aria-hidden />
                </button>
                {other && (
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-fg">Tax display settings</p>
                    <div className="flex items-center gap-3 rounded-lg border border-line p-3">
                      <span className="grid size-10 place-items-center rounded-lg bg-surface-2"><Percent className="size-5" aria-hidden /></span>
                      <div className="flex-1"><label htmlFor="tax-display" className="font-medium">Show taxes separately</label><p className="text-sm text-muted">When on, members see the price without GST and GST is added at checkout</p></div>
                      <Switch id="tax-display" checked={exclusive} disabled={!pricing.gstRegistered} onChange={(v) => set({ taxExclusive: v })} />
                    </div>
                    {!pricing.gstRegistered && <p className="mt-2 flex items-center gap-1 text-xs text-muted"><Info className="size-3.5" aria-hidden />You aren’t charging GST yet. Turn it on under Settings → Business to use this.</p>}
                  </div>
                )}
              </Card>
            </div>
            <div className="h-fit rounded-2xl bg-gradient-to-br from-rose-200 via-rose-300 to-amber-200 p-8">
              <p className="mb-4 text-center font-semibold text-rose-900/80">Preview</p>
              <div className="overflow-hidden rounded-xl bg-white text-slate-900 shadow-lg">
                <div className="h-20 bg-gradient-to-r from-sky-300 to-indigo-500">{f.cover?.url && <img src={f.cover.url} alt="" className="size-full object-cover" />}</div>
                <div className="space-y-2 p-5">
                  <p className="font-semibold">{f.planName || 'Plan name'}</p>
                  <p className="text-2xl font-semibold">{formatMoney(charge, 'INR')}{sale !== null && sale < price && <span className="ml-2 text-sm font-normal text-slate-500 line-through">{formatMoney(price, 'INR')}</span>}</p>
                  <p className="text-sm text-slate-500">One time purchase</p>
                  {rate > 0 && exclusive && <p className="text-sm text-slate-700">+ taxes</p>}
                  <p className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-sm"><Calendar className="size-4" aria-hidden />{f.lifetime ? 'Lifetime access' : f.interval === 'YEAR' ? '1 year access' : '1 month access'}</p>
                  <div className="mt-2 rounded-full bg-indigo-600 py-2.5 text-center text-sm font-semibold text-white">{f.buttonText.trim() || 'Get Access Now'}</div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <FaqModal value={faqEdit} onClose={() => setFaqEdit(null)} onSave={(q) => { set({ faqs: q.index === -1 ? [...f.faqs, { question: q.question, answer: q.answer }] : f.faqs.map((x, j) => (j === q.index ? { question: q.question, answer: q.answer } : x)) }); setFaqEdit(null); }} />
      <CoursePicker open={picker} courses={all} loading={courses.isLoading} selected={f.courseIds} onClose={() => setPicker(false)} onAdd={(ids) => { set({ courseIds: [...new Set([...f.courseIds, ...ids])] }); setErrors({}); setPicker(false); }} />
      <ConfirmDialog open={leave} onClose={() => setLeave(false)} title="Leave the membership builder?" description={planId ? 'Your saved steps are kept as a draft.' : 'What you’ve entered on this page will be lost.'} confirmLabel="Leave" onConfirm={() => navigate('/creator/memberships')} />
    </div>
  );
}

function MoneyInput({ label, value, onChange, error, hint }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-fg">{label}</p>
      <div className="flex overflow-hidden rounded-md border border-line focus-within:ring-2 focus-within:ring-primary-500">
        <span className="grid w-10 place-items-center border-r border-line bg-surface-2 text-sm text-muted" aria-hidden>₹</span>
        <input type="number" min={0} step="0.01" placeholder="0" aria-label={label} aria-invalid={Boolean(error)} value={value} onChange={(e) => onChange(e.target.value)} className="h-10 min-w-0 flex-1 bg-surface px-3 text-sm focus:outline-none" />
      </div>
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Thumb({ c }) {
  return <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-2">{c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" className="size-full object-cover" /> : <BookOpen className="size-5 text-muted" aria-hidden />}</span>;
}

function FaqModal({ value, onClose, onSave }) {
  const [q, setQ] = useState(value);
  useEffect(() => setQ(value), [value]);
  return (
    <Modal open={Boolean(value)} onClose={onClose} title={value?.index === -1 ? 'Add a question' : 'Edit question'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!q?.question.trim() || !q?.answer.trim()} onClick={() => onSave({ ...q, question: q.question.trim(), answer: q.answer.trim() })}>Save</Button></>}>
      {q && <div className="space-y-4">
        <Input label="Question" maxLength={300} value={q.question} onChange={(e) => setQ({ ...q, question: e.target.value })} />
        <Textarea label="Answer" rows={4} maxLength={2000} value={q.answer} onChange={(e) => setQ({ ...q, answer: e.target.value })} />
      </div>}
    </Modal>
  );
}

function CoursePicker({ open, courses, loading, selected, onClose, onAdd }) {
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState([]);
  useEffect(() => { if (open) { setPicked([]); setTerm(''); } }, [open]);
  const available = useMemo(() => courses.filter((c) => !selected.includes(c.id) && c.title.toLowerCase().includes(term.trim().toLowerCase())), [courses, selected, term]);
  const allOn = available.length > 0 && available.every((c) => picked.includes(c.id));
  return (
    <Modal open={open} onClose={onClose} title="Add Products" size="lg" footer={<Button disabled={!picked.length} onClick={() => onAdd(picked)}>Add{picked.length ? ` (${picked.length})` : ''}</Button>}>
      <div className="space-y-3">
        <label className="flex h-10 items-center gap-2 rounded-md border border-line px-3"><Search className="size-4 text-muted" aria-hidden /><input aria-label="Search courses" placeholder="Search" value={term} onChange={(e) => setTerm(e.target.value)} className="flex-1 bg-transparent text-sm focus:outline-none" /></label>
        {loading ? <Skeleton className="h-40" /> : !available.length ? <EmptyState icon={BookOpen} title={courses.length ? 'No more courses to add' : 'No courses yet'} description={courses.length ? undefined : 'Create a course first.'} /> : <>
          <Checkbox label="Select All" checked={allOn} onChange={() => setPicked(allOn ? [] : available.map((c) => c.id))} />
          <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto">
            {available.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5">
                <input type="checkbox" aria-label={c.title} checked={picked.includes(c.id)} onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))} className="size-4 rounded border-line" />
                <Thumb c={c} />
                <div className="min-w-0"><p className="truncate font-medium">{c.title}</p><p className="text-xs text-muted">{c.status === 'PUBLISHED' ? 'Published' : 'Draft'}</p></div>
              </li>
            ))}
          </ul>
        </>}
      </div>
    </Modal>
  );
}
