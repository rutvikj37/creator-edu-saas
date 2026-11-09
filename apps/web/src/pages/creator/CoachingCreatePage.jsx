import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Calendar, Check, ChevronDown, Clock, ImageIcon, Paperclip, Pencil, Plus, Trash2, Wallet, X } from 'lucide-react';
import { RichTextEditor } from '../../components/forms/RichTextEditor.jsx';
import { FileUpload } from '../../components/forms/FileUpload.jsx';
import { Button, Card, ConfirmDialog, Input, Select, Skeleton, Textarea, toast } from '../../components/ui/index.js';
import { coachingApi } from '../../services/api/coaching.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { cn } from '../../utils/cn.js';
import { formatMoney } from '../../utils/format.js';

const STEPS = [{ key: 'landing', label: 'Landing page' }, { key: 'details', label: 'Program details' }, { key: 'pricing', label: 'Pricing plan' }];
const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
const docText = (d) => (d ? JSON.stringify(d).match(/"text":"((?:[^"\\]|\\.)*)"/g)?.map((m) => m.slice(8, -1)).join(' ') ?? '' : '');
const newSession = (n) => ({ key: Math.random().toString(36).slice(2), title: `Session ${n}`, durationMin: 30, unit: 'min', agenda: null, notes: '', attachments: [], open: true });

/** Full-page, three-step coaching program builder (create and edit). */
export function CoachingCreatePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const existing = useQuery({ queryKey: ['coaching', 'program', id], queryFn: () => coachingApi.program(id), enabled: Boolean(id) });
  const team = useQuery({ queryKey: ['coaching', 'team'], queryFn: coachingApi.team });
  const [step, setStep] = useState(0);
  const [programId, setProgramId] = useState(id ?? null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [leave, setLeave] = useState(false);
  const [f, setF] = useState({ title: '', description: null, cover: null, faqs: [], coaches: [], sessions: [newSession(1)], planName: '', price: '', sale: '' });

  useEffect(() => {
    const p = existing.data;
    if (!p) return;
    setF({
      title: p.title, description: p.description, cover: p.coverFileId ? { id: p.coverFileId, url: p.coverUrl } : null, faqs: p.faqs ?? [],
      coaches: p.coaches.map((c) => ({ userId: c.userId, weight: c.weight })),
      sessions: p.sessions.length ? p.sessions.map((s) => ({ key: s.id, id: s.id, title: s.title, durationMin: s.durationMin % 60 === 0 && s.durationMin >= 60 ? s.durationMin / 60 : s.durationMin, unit: s.durationMin % 60 === 0 && s.durationMin >= 60 ? 'hr' : 'min', agenda: s.agenda, notes: s.notes ?? '', attachments: s.attachments, open: false })) : [newSession(1)],
      planName: p.planName ?? '', price: p.compareAtAmount ? Number(p.compareAtAmount) : Number(p.priceAmount) || '', sale: p.compareAtAmount ? Number(p.priceAmount) : '',
    });
  }, [existing.data]);
  useEffect(() => {
    if (!id && auth.user?.id && !f.coaches.length) setF((x) => ({ ...x, coaches: [{ userId: auth.user.id, weight: 1 }] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.id]);

  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const price = Number(f.price) || 0;
  const sale = f.sale === '' ? null : Number(f.sale);
  const charge = sale !== null && sale < price ? sale : price;

  const validate = () => {
    const e = {};
    if (step === 0) {
      if (!f.title.trim()) e.title = 'Name your coaching program';
      if (docText(f.description).length > 1000) e.description = 'Keep the description under 1000 characters';
      if (f.faqs.some((q) => !q.question.trim() || !q.answer.trim())) e.faqs = 'Every question needs an answer';
    }
    if (step === 1) {
      if (!f.coaches.length) e.coaches = 'Add at least one coach';
      if (f.sessions.some((s) => !s.title.trim())) e.sessions = 'Give every session a name';
      if (f.sessions.some((s) => !docText(s.agenda).trim())) e.sessions = 'Write an agenda for every session';
      if (f.sessions.some((s) => { const m = s.unit === 'hr' ? s.durationMin * 60 : s.durationMin; return !(m >= 15 && m <= 480); })) e.sessions = 'Sessions last 15 minutes to 8 hours';
    }
    if (step === 2 && sale !== null && sale >= price) e.sale = 'The sale price must be lower than the price';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const payload = () => {
    if (step === 0) return { title: f.title.trim(), description: docText(f.description).trim() ? f.description : null, coverFileId: f.cover?.id ?? null, faqs: f.faqs.map((q) => ({ question: q.question.trim(), answer: q.answer.trim() })) };
    if (step === 1) return {
      coaches: f.coaches,
      sessions: f.sessions.map((s) => ({ ...(s.id ? { id: s.id } : {}), title: s.title.trim(), durationMin: s.unit === 'hr' ? s.durationMin * 60 : Number(s.durationMin), agenda: s.agenda ?? emptyDoc, notes: s.notes.trim() || null, attachmentIds: s.attachments.map((a) => a.id) })),
    };
    return { planName: f.planName.trim() || null, priceAmount: charge, compareAtAmount: sale !== null && sale < price ? price : null };
  };

  const save = async (publish = false) => {
    if (!validate()) return false;
    setBusy(true);
    try {
      const body = payload();
      const p = programId ? await coachingApi.update(programId, body) : await coachingApi.create(body);
      setProgramId(p.id);
      if (step === 1) setF((x) => ({ ...x, sessions: p.sessions.map((s, i) => ({ ...x.sessions[i], id: s.id, key: x.sessions[i]?.key ?? s.id })) }));
      if (publish) {
        await coachingApi.setStatus(p.id, 'PUBLISHED');
        toast.success('Coaching program published');
        navigate('/creator/coaching?tab=programs');
      }
      return true;
    } catch (e) {
      const d = e.details ?? [];
      const map = {};
      for (const x of d) map[{ title: 'title', description: 'description', faqs: 'faqs', coaches: 'coaches', sessions: 'sessions', priceAmount: 'price', compareAtAmount: 'sale', coverFileId: 'cover' }[x.field] ?? 'form'] = x.message;
      setErrors(map);
      toast.error(d[0]?.message ?? e.message);
      if (d.some((x) => x.field === 'coaches' || x.field === 'sessions')) setStep(1);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const next = async () => { if (await save()) setStep((s) => s + 1); };
  const skip = async () => { if (await save()) { toast.success('Saved as a draft'); navigate('/creator/coaching?tab=programs'); } };

  if (id && existing.isLoading) return <Skeleton className="h-96" />;
  const members = team.data ?? [];

  return (
    <div className="-mt-2">
      <div className="sticky top-0 z-10 -mx-4 mb-6 flex items-center gap-3 border-b border-line bg-surface-2/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Button variant="ghost" aria-label="Back" onClick={() => (step > 0 ? setStep(step - 1) : setLeave(true))}><ArrowLeft className="size-4" /></Button>
        <ol className="mx-auto flex items-center gap-2 text-sm" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              {i > 0 && <span className="hidden h-px w-8 bg-line sm:block" aria-hidden />}
              <button type="button" disabled={i > step} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}
                className={cn('flex items-center gap-1.5 font-medium', i === step ? 'text-fg' : i < step ? 'text-fg-2' : 'text-muted')}>
                <span className={cn('grid size-4 place-items-center rounded-full border', i < step ? 'border-primary-600 bg-primary-600 text-on-primary' : i === step ? 'border-primary-600' : 'border-line-strong')}>{i < step && <Check className="size-3" aria-hidden />}</span>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            </li>
          ))}
        </ol>
        {step < 2 ? <Button loading={busy} onClick={next}>Continue</Button> : <><Button variant="ghost" disabled={busy} onClick={skip}>Skip</Button><Button loading={busy} onClick={() => save(true)}>Publish</Button></>}
      </div>

      {step === 0 && (
        <>
          <div className="mb-6 text-center"><h1 className="text-3xl font-semibold tracking-tight">Add coaching details</h1><p className="mt-1 text-sm text-muted">This is what your audience will see on your coaching landing page.</p></div>
          <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
            <div className="space-y-6">
              <Card className="space-y-2 p-5">
                <div className="flex items-end justify-between"><div><p className="font-semibold">Program name <span className="text-red-600">*</span></p><p className="text-sm text-muted">This name will be shown to your audience.</p></div><span className="text-xs text-muted">{f.title.length}/100</span></div>
                <Input aria-label="Program name" placeholder="Name your coaching program" maxLength={100} value={f.title} error={errors.title} onChange={(e) => set({ title: e.target.value })} />
              </Card>
              <Card className="space-y-2 p-5">
                <p className="text-sm text-muted">Describe what the coaching is about.</p>
                <div className="flex justify-between"><p className="font-semibold">Description</p><span className="text-xs text-muted">{docText(f.description).length}/1000</span></div>
                <RichTextEditor value={f.description} onChange={(v) => set({ description: v })} placeholder="Who is it for? What will they get out of it?" error={errors.description} />
              </Card>
              <Card className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-semibold">Frequently asked questions</p><p className="text-sm text-muted">Help potential learners get answers before they book.</p></div>
                  <Button variant="secondary" leftIcon={Plus} onClick={() => set({ faqs: [...f.faqs, { question: '', answer: '' }] })}>Add</Button>
                </div>
                {!f.faqs.length && <p className="text-sm text-muted italic">No FAQs yet.</p>}
                {f.faqs.map((q, i) => (
                  <div key={i} className="space-y-2 rounded-lg border border-line p-3">
                    <div className="flex gap-2"><Input className="flex-1" aria-label={`Question ${i + 1}`} placeholder="Question" maxLength={300} value={q.question} onChange={(e) => set({ faqs: f.faqs.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)) })} />
                      <Button variant="ghost" aria-label={`Remove question ${i + 1}`} onClick={() => set({ faqs: f.faqs.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button></div>
                    <Textarea aria-label={`Answer ${i + 1}`} rows={2} placeholder="Answer" maxLength={2000} value={q.answer} onChange={(e) => set({ faqs: f.faqs.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)) })} />
                  </div>
                ))}
                {errors.faqs && <p className="text-sm text-red-600">{errors.faqs}</p>}
              </Card>
            </div>
            <Card className="h-fit space-y-3 p-5">
              <div className="flex items-start justify-between"><div><p className="font-semibold">Upload cover image</p><p className="text-xs text-muted">Landscape 4:3 works best, e.g. 1600×1200.</p></div>{f.cover && <Pencil className="size-4 text-primary-600" aria-hidden />}</div>
              <div className="aspect-[4/3] overflow-hidden rounded-lg bg-gradient-to-br from-sky-300 to-primary-600">
                {f.cover?.url ? <img src={f.cover.url} alt="Cover preview" className="size-full object-cover" /> : <div className="grid size-full place-items-center"><span className="grid size-16 place-items-center rounded-full bg-white/30 text-white"><ImageIcon className="size-7" aria-hidden /></span></div>}
              </div>
              <FileUpload purpose="IMAGE" accept="image/png,image/jpeg,image/webp" label={f.cover ? 'Replace cover' : 'Upload cover'} preview="none" onUploaded={(file) => set({ cover: { id: file.id, url: file.url } })} />
              {f.cover && <Button size="sm" variant="ghost" onClick={() => set({ cover: null })}>Remove cover</Button>}
            </Card>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div className="mb-6 text-center"><h1 className="text-3xl font-semibold tracking-tight">Program details</h1><p className="mx-auto mt-1 max-w-xl text-sm text-muted">Set up sessions for your coaching program. You can edit, add or remove sessions later.</p></div>
          <div className="space-y-6">
            <Card>
              <div className="border-b border-line p-5"><p className="font-semibold">Coaches</p>
                <p className="text-sm text-muted">Assign one or more coaches — at least one is required. When several coaches are free, bookings are shared between them. <strong className="text-fg-2">The × number is each coach’s weight: a coach at 2× is booked twice as often as one at 1×.</strong></p></div>
              <div className="space-y-3 p-5">
                <p className="text-xs font-medium text-muted">Select coaches</p>
                {f.coaches.map((c, i) => {
                  const m = members.find((x) => x.userId === c.userId);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <Select aria-label={`Coach ${i + 1}`} className="flex-1" value={c.userId} onChange={(e) => set({ coaches: f.coaches.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)) })}
                        options={members.filter((x) => x.userId === c.userId || !f.coaches.some((y) => y.userId === x.userId)).map((x) => ({ value: x.userId, label: `${x.name} · ${x.email}${x.hasHours ? '' : ' (no hours set)'}` }))} />
                      <select aria-label={`Weight for coach ${i + 1}`} value={c.weight} onChange={(e) => set({ coaches: f.coaches.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)) })} className="h-10 rounded-md border border-line bg-surface px-2 text-sm text-fg">{Array.from({ length: 10 }, (_, n) => <option key={n + 1} value={n + 1}>{n + 1}×</option>)}</select>
                      <Button variant="ghost" aria-label={`Remove coach ${i + 1}`} disabled={f.coaches.length === 1} onClick={() => set({ coaches: f.coaches.filter((_, j) => j !== i) })}><X className="size-4" /></Button>
                      {m && !m.hasHours && <span className="sr-only">This coach has not set weekly hours yet</span>}
                    </div>
                  );
                })}
                {members.some((m) => !f.coaches.some((c) => c.userId === m.userId)) && (
                  <Button size="sm" variant="secondary" leftIcon={Plus} onClick={() => { const free = members.find((m) => !f.coaches.some((c) => c.userId === m.userId)); if (free) set({ coaches: [...f.coaches, { userId: free.userId, weight: 1 }] }); }}>Add coach</Button>
                )}
                {f.coaches.some((c) => !members.find((m) => m.userId === c.userId)?.hasHours) && members.length > 0 && <p className="text-sm text-amber-700 dark:text-amber-300">Coaches without weekly hours can’t be booked. Set hours in Coaching settings.</p>}
                {errors.coaches && <p className="text-sm text-red-600">{errors.coaches}</p>}
              </div>
            </Card>
            <Card>
              <div className="border-b border-line p-5"><p className="font-semibold">Sessions</p><p className="text-sm text-muted">Customise each session — name, duration, agenda, notes, attachments.</p></div>
              <div className="space-y-4 p-5">
                {f.sessions.map((s, i) => {
                  const up = (patch) => set({ sessions: f.sessions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                  return (
                    <div key={s.key} className="rounded-xl border border-line">
                      <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={s.open} onClick={() => up({ open: !s.open })}>
                        <span className="grid size-7 place-items-center rounded-full bg-primary-50 text-xs font-semibold text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">{i + 1}</span>
                        <span className="flex-1"><span className="block font-medium text-fg">{s.title || `Session ${i + 1}`}</span><span className="text-xs text-muted">{s.durationMin} {s.unit}</span></span>
                        <ChevronDown className={cn('size-4 text-muted transition-transform', s.open && 'rotate-180')} aria-hidden />
                      </button>
                      {s.open && (
                        <div className="space-y-4 border-t border-line p-4">
                          <div className="grid gap-4 sm:grid-cols-2">
                            <Input label="Session name *" maxLength={100} value={s.title} onChange={(e) => up({ title: e.target.value })} />
                            <div>
                              <p className="mb-1.5 flex items-center gap-1 text-sm font-medium text-fg"><Clock className="size-3.5" aria-hidden />Duration *</p>
                              <div className="flex"><input type="number" min={1} aria-label={`Session ${i + 1} duration`} value={s.durationMin} onChange={(e) => up({ durationMin: Number(e.target.value) })} className="h-10 w-24 rounded-l-md border border-line bg-surface px-3 text-sm" />
                                <select aria-label={`Session ${i + 1} duration unit`} value={s.unit} onChange={(e) => up({ unit: e.target.value })} className="h-10 flex-1 rounded-r-md border border-l-0 border-line bg-surface px-3 text-sm"><option value="min">Minutes</option><option value="hr">Hours</option></select></div>
                            </div>
                          </div>
                          <RichTextEditor label="Agenda *" value={s.agenda} minHeight={120} onChange={(v) => up({ agenda: v })} placeholder="What you’ll cover in this session" />
                          <Textarea label="Notes (optional)" rows={2} maxLength={1000} placeholder="What your audience should prepare or bring to this session" value={s.notes} onChange={(e) => up({ notes: e.target.value })} />
                          <div className="space-y-2">
                            <p className="flex items-center gap-1 text-sm font-medium"><Paperclip className="size-3.5" aria-hidden />Attachments</p>
                            {s.attachments.map((a) => <div key={a.id} className="flex items-center gap-2 text-sm"><span className="flex-1 truncate">{a.fileName}</span><Button size="sm" variant="ghost" aria-label={`Remove ${a.fileName}`} onClick={() => up({ attachments: s.attachments.filter((x) => x.id !== a.id) })}><X className="size-4" /></Button></div>)}
                            {s.attachments.length < 10 && <FileUpload purpose="LESSON_FILE" label="Add attachment" hint="Shared with the learner once they book this session." preview="none" onUploaded={(file) => up({ attachments: [...s.attachments, { id: file.id, fileName: file.fileName }] })} />}
                          </div>
                          {f.sessions.length > 1 && <Button size="sm" variant="ghost" leftIcon={Trash2} className="text-red-600" onClick={() => set({ sessions: f.sessions.filter((_, j) => j !== i) })}>Remove session</Button>}
                        </div>
                      )}
                    </div>
                  );
                })}
                {errors.sessions && <p className="text-sm text-red-600">{errors.sessions}</p>}
                <Button variant="secondary" leftIcon={Plus} disabled={f.sessions.length >= 50} onClick={() => set({ sessions: [...f.sessions.map((x) => ({ ...x, open: false })), newSession(f.sessions.length + 1)] })}>Add session</Button>
              </div>
            </Card>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="mb-6 text-center"><h1 className="text-3xl font-semibold tracking-tight">Set up pricing</h1><p className="mt-1 text-sm text-muted">Add a pricing plan to begin with. Leave the price empty for a free program.</p></div>
          <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
            <div className="space-y-6">
              <Card className="space-y-3 p-5">
                <div><p className="text-xl font-semibold">Plan name</p><p className="text-sm text-muted">This name will be shown to your audience</p></div>
                <Input aria-label="Plan name" placeholder="Enter plan name" maxLength={100} value={f.planName} onChange={(e) => set({ planName: e.target.value })} />
              </Card>
              <Card className="space-y-4 p-5">
                <div><p className="font-semibold">Type of pricing plan</p><p className="text-sm text-muted">Choose how you want your audience to pay</p></div>
                <div className="flex items-center gap-3 rounded-lg border border-line p-3"><span className="grid size-10 place-items-center rounded-lg bg-surface-2"><Wallet className="size-5" aria-hidden /></span><div><p className="font-medium">One-time payment</p><p className="text-sm text-muted">Charge a single fee for all sessions in the program</p></div></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Price" type="number" min={0} step="0.01" placeholder="0" value={f.price} error={errors.price} onChange={(e) => set({ price: e.target.value })} />
                  <Input label="Sale price" type="number" min={0} step="0.01" placeholder="Optional" value={f.sale} error={errors.sale} hint="Lower than the price; learners see the price struck through." onChange={(e) => set({ sale: e.target.value })} />
                </div>
                <div className="grid gap-4 rounded-lg bg-surface-2/60 p-4 sm:grid-cols-2">
                  <div><p className="text-sm font-medium">Learners pay</p><p className="text-xl font-semibold">{charge ? formatMoney(charge, 'INR') : 'Free'}</p></div>
                  <div><p className="text-sm font-medium">Discount</p><p className="text-xl font-semibold">{sale !== null && sale < price ? `${Math.round(((price - sale) / price) * 100)}% off` : '—'}</p></div>
                </div>
                <p className="text-xs text-muted">Payments go to your own Razorpay account. GST and your plan’s commission are applied at checkout as for your other products.</p>
              </Card>
            </div>
            <div className="h-fit rounded-2xl bg-gradient-to-br from-rose-200 via-rose-300 to-amber-200 p-8">
              <p className="mb-4 text-center font-semibold text-rose-900/80">Preview</p>
              <div className="overflow-hidden rounded-xl bg-white text-slate-900 shadow-lg">
                <div className="h-20 bg-gradient-to-r from-sky-300 to-indigo-500">{f.cover?.url && <img src={f.cover.url} alt="" className="size-full object-cover" />}</div>
                <div className="space-y-2 p-5">
                  <p className="font-semibold">{f.planName || 'Plan name'}</p>
                  <p className="text-2xl font-semibold">{charge ? formatMoney(charge, 'INR') : 'Free'}{sale !== null && sale < price && <span className="ml-2 text-sm font-normal text-slate-500 line-through">{formatMoney(price, 'INR')}</span>}</p>
                  <p className="text-sm text-slate-500">One-time purchase</p>
                  <p className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-sm"><Calendar className="size-4" aria-hidden />{f.sessions.length} session{f.sessions.length === 1 ? '' : 's'}</p>
                  <div className="mt-2 rounded-full bg-indigo-600 py-2.5 text-center text-sm font-semibold text-white">{charge ? 'Get access now' : 'Get it free'}</div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      <ConfirmDialog open={leave} onClose={() => setLeave(false)} title="Leave the program builder?" description={programId ? 'Your saved steps are kept as a draft.' : 'What you’ve entered on this page will be lost.'} confirmLabel="Leave" onConfirm={() => navigate('/creator/coaching?tab=programs')} />
    </div>
  );
}
