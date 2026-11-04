import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, PartyPopper, Rocket } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { EmailVerificationBanner } from '../../components/account/EmailVerificationBanner.jsx';
import { FileUpload } from '../../components/forms/FileUpload.jsx';
import { Button, Card, CardBody, ErrorState, Input, Select, Skeleton, Textarea, toast } from '../../components/ui/index.js';
import { academyApi2 } from '../../services/api/creator.js';
import { creatorApi, platformApi } from '../../services/api/platform.js';
import { cn } from '../../utils/cn.js';
import { formatDate, formatMoney } from '../../utils/format.js';
import { BusinessFields, GstFields, academyPayload, businessPayload, useAcademyForms } from './AcademySettingsPage.jsx';

const STEPS = [
  { key: 'name', title: 'Academy name', text: 'What should students call your academy?' },
  { key: 'category', title: 'Category', text: 'Helps students discover you.' },
  { key: 'logo', title: 'Logo', text: 'Shown on your site, emails and certificates.' },
  { key: 'colors', title: 'Brand colours', text: 'Make your academy feel like yours.' },
  { key: 'description', title: 'Description', text: 'Tell students what you teach.' },
  { key: 'business', title: 'Business information', text: 'Used on invoices and receipts.' },
  { key: 'gst', title: 'GST details', text: 'Only if your business is GST registered.' },
  { key: 'plan', title: 'Plan', text: 'Your subscription and what it includes.' },
  { key: 'payment', title: 'Payment', text: 'Billing status for your plan.' },
  { key: 'publish', title: 'Publish', text: 'Go live and open registrations.' },
];

/** 10-step, resumable onboarding. Progress is derived server-side from saved data. */
export function OnboardingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ['onboarding'], queryFn: academyApi2.onboarding });
  const categories = useQuery({ queryKey: ['categories'], queryFn: platformApi.categories, staleTime: 5 * 60_000 });
  const plans = useQuery({ queryKey: ['public', 'plans'], queryFn: creatorApi.publicPlans, staleTime: 5 * 60_000 });
  const { academy, business, errors, saveAcademy, saveBusiness } = useAcademyForms();
  const [step, setStep] = useState(null);
  const [form, setForm] = useState(null);
  const [biz, setBiz] = useState(null);
  const [logo, setLogo] = useState(null);

  useEffect(() => { if (state.data && step === null) setStep(Math.min(Math.max(state.data.currentStep, 1), 10)); }, [state.data, step]);
  useEffect(() => { if (academy.data) { setForm(academy.data); setLogo(academy.data.logoFileId ? { id: academy.data.logoFileId, url: academy.data.logoUrl } : null); } }, [academy.data]);
  useEffect(() => { if (business.data) setBiz(business.data); }, [business.data]);
  const publish = useMutation({
    mutationFn: academyApi2.publish,
    onSuccess: (d) => { qc.setQueryData(['onboarding'], d); qc.invalidateQueries({ queryKey: ['workspace'] }); toast.success('Your academy is live!'); },
    onError: (e) => toast.error(e.message),
  });

  if (state.isError) return <Card><ErrorState error={state.error} onRetry={() => state.refetch()} /></Card>;
  if (!state.data || !form || !biz || step === null) return <Skeleton className="h-96" />;
  const s = state.data;
  const def = STEPS[step - 1];

  const persist = async () => {
    if (['name', 'category', 'logo', 'colors', 'description'].includes(def.key)) await saveAcademy.mutateAsync(academyPayload(form, logo, academy.data.faviconFileId ? { id: academy.data.faviconFileId } : null));
    if (['business', 'gst'].includes(def.key)) await saveBusiness.mutateAsync(businessPayload(biz));
  };
  const go = async (next) => {
    try {
      if (next > step) await persist();
      const updated = await academyApi2.saveStep(next);
      qc.setQueryData(['onboarding'], updated);
      setStep(next);
    } catch {
      /* field errors are shown inline by the mutation */
    }
  };
  const current = plans.data?.find((p) => p.name === s.plan?.name);

  if (s.status === 'ACTIVE' && s.completedAt) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardBody className="py-10 text-center">
          <PartyPopper className="mx-auto size-10 text-primary-600" />
          <h1 className="mt-4 text-xl font-semibold">Your academy is live</h1>
          <p className="mt-2 text-muted">Published on {formatDate(s.completedAt)}. Next, create your first course.</p>
          <div className="mt-6 flex justify-center gap-2">
            <Button onClick={() => navigate('/creator/courses')}>Create a course</Button>
            <Button variant="secondary" onClick={() => navigate('/creator')}>Go to dashboard</Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title="Set up your academy" description={`${s.progress}% complete — you can leave and continue any time.`} breadcrumbs={[{ label: 'Dashboard', to: '/creator' }, { label: 'Setup' }]} />
      <div className="mb-6 h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-primary-600 transition-all" style={{ width: `${s.progress}%` }} /></div>
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <ol className="space-y-1" aria-label="Setup steps">
          {STEPS.map((x, i) => {
            const done = s.steps[i]?.complete;
            return (
              <li key={x.key}>
                <button type="button" onClick={() => go(i + 1)} aria-current={step === i + 1 ? 'step' : undefined}
                  className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm', step === i + 1 ? 'bg-primary-50 font-medium text-primary-700' : 'text-fg-2 hover:bg-surface-2')}>
                  <span className={cn('grid size-6 shrink-0 place-items-center rounded-full text-xs', done ? 'bg-green-600 text-white' : 'border border-line-strong text-muted')}>{done ? <Check className="size-3.5" /> : i + 1}</span>
                  {x.title}
                </button>
              </li>
            );
          })}
        </ol>
        <Card>
          <CardBody className="space-y-6">
            <div><p className="text-xs font-medium text-muted">Step {step} of 10</p><h2 className="mt-1 text-lg font-semibold">{def.title}</h2><p className="text-sm text-muted">{def.text}</p></div>
            {def.key === 'name' && <Input label="Academy name" autoFocus value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />}
            {def.key === 'category' && <Select label="Category" placeholder="Select a category" value={form.categorySlug ?? ''} onChange={(e) => setForm({ ...form, categorySlug: e.target.value || null })} options={(categories.data ?? []).map((c) => ({ value: c.slug, label: c.name }))} error={errors.categorySlug} hint={categories.data?.length === 0 ? 'No categories have been set up yet — you can skip this step.' : undefined} />}
            {def.key === 'logo' && <FileUpload purpose="LOGO" accept="image/png,image/jpeg,image/webp" hint="PNG/JPG/WebP, max 2 MB" value={logo} onUploaded={(f) => setLogo({ id: f.id, url: f.url })} onClear={() => setLogo(null)} />}
            {def.key === 'colors' && (
              <div className="grid gap-4 sm:grid-cols-2">
                {['primaryColor', 'accentColor'].map((k) => (
                  <div key={k} className="space-y-1.5">
                    <label htmlFor={`ob-${k}`} className="text-sm font-medium text-fg-2">{k === 'primaryColor' ? 'Primary colour' : 'Accent colour'}</label>
                    <div className="flex gap-2"><input id={`ob-${k}`} type="color" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="h-9 w-12 rounded border border-line" /><Input aria-label={`${k} hex`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} error={errors[k]} /></div>
                  </div>
                ))}
              </div>
            )}
            {def.key === 'description' && (
              <div className="space-y-4">
                <Input label="Tagline" value={form.tagline ?? ''} onChange={(e) => setForm({ ...form, tagline: e.target.value })} error={errors.tagline} />
                <Textarea label="Description" rows={5} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} error={errors.description} hint="At least 20 characters" />
              </div>
            )}
            {def.key === 'business' && <BusinessFields form={biz} setForm={setBiz} errors={errors} />}
            {def.key === 'gst' && <GstFields form={biz} setForm={setBiz} errors={errors} />}
            {def.key === 'plan' && (
              <div className="space-y-4">
                {s.plan ? <Alert tone="success" title={`You're on ${s.plan.name}`}>{s.plan.status === 'TRIALING' ? `Free trial until ${formatDate(s.plan.trialEndsAt)}.` : `Status: ${s.plan.status.toLowerCase()}.`}</Alert> : <Alert tone="error">No plan assigned. Contact support.</Alert>}
                {current && <p className="text-sm text-muted">Includes up to {current.features.find((f) => f.featureKey === 'courses.max')?.limitValue ?? 'unlimited'} courses and {current.features.find((f) => f.featureKey === 'students.max')?.limitValue ?? 'unlimited'} students.</p>}
                <div className="grid gap-3 sm:grid-cols-3">
                  {(plans.data ?? []).map((p) => { const m = p.prices.find((x) => x.interval === 'MONTH'); return <div key={p.id} className={cn('rounded-lg border p-3 text-sm', p.name === s.plan?.name ? 'border-primary-600 bg-primary-50' : 'border-line')}><p className="font-semibold">{p.name}</p><p className="text-muted">{m ? `${formatMoney(m.amount, m.currency)}/mo` : p.trialDays ? `${p.trialDays}-day trial` : 'Free'}</p></div>; })}
                </div>
                <p className="text-xs text-muted">Compare plans any time in <Link className="underline" to="/creator/billing">Billing</Link>.</p>
              </div>
            )}
            {def.key === 'payment' && (
              s.steps[8].complete ? <Alert tone="success" title="No payment needed right now">Your current plan is active{s.plan?.status === 'TRIALING' ? ' during the trial' : ''}. Paid upgrades are handled in Billing once online payments are enabled.</Alert>
                : <Alert tone="error" title="Plan not active">Contact support to activate your plan.</Alert>
            )}
            {def.key === 'publish' && (
              <div className="space-y-4">
                <EmailVerificationBanner />
                {s.blockers.length ? (
                  <Alert tone="error" title="Before you can publish"><ul className="mt-1 list-disc pl-4">{s.blockers.map((b) => <li key={b}>{b}</li>)}</ul></Alert>
                ) : <Alert tone="success" title="Ready to go live">Publishing makes your academy site visible and lets students register.</Alert>}
                <Button leftIcon={Rocket} disabled={!s.canPublish} loading={publish.isPending} onClick={() => publish.mutate()}>Publish academy</Button>
              </div>
            )}
            <div className="flex justify-between border-t border-line pt-4">
              <Button variant="ghost" leftIcon={ChevronLeft} disabled={step === 1} onClick={() => go(step - 1)}>Back</Button>
              {step < 10 && <Button rightIcon={ChevronRight} loading={saveAcademy.isPending || saveBusiness.isPending} onClick={() => go(step + 1)}>Save & continue</Button>}
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
