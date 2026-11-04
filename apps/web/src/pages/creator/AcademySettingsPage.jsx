import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { FileUpload } from '../../components/forms/FileUpload.jsx';
import { Button, Card, CardBody, CardHeader, ErrorState, Input, Select, Skeleton, Switch, Tabs, Textarea, toast } from '../../components/ui/index.js';
import { academyApi2 } from '../../services/api/creator.js';
import { platformApi } from '../../services/api/platform.js';
import { countryOptions } from '../../utils/countries.js';

export function useAcademyForms() {
  const qc = useQueryClient();
  const academy = useQuery({ queryKey: ['academy'], queryFn: academyApi2.get });
  const business = useQuery({ queryKey: ['academy', 'business'], queryFn: academyApi2.business });
  const [errors, setErrors] = useState({});
  const onError = (e) => { setErrors(Object.fromEntries((e.details ?? []).map((d) => [d.field, d.message]))); toast.error(e.details?.length ? 'Please fix the highlighted fields' : e.message); };
  const saveAcademy = useMutation({ mutationFn: academyApi2.update, onSuccess: (d) => { setErrors({}); qc.setQueryData(['academy'], d); qc.invalidateQueries({ queryKey: ['onboarding'] }); qc.invalidateQueries({ queryKey: ['workspace'] }); }, onError });
  const saveBusiness = useMutation({ mutationFn: academyApi2.updateBusiness, onSuccess: (d) => { setErrors({}); qc.setQueryData(['academy', 'business'], d); qc.invalidateQueries({ queryKey: ['onboarding'] }); }, onError });
  return { academy, business, errors, saveAcademy, saveBusiness };
}

export function ProfileFields({ form, setForm, errors, categories }) {
  return (
    <div className="grid gap-4">
      <Input label="Academy name" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
      <Input label="Tagline" value={form.tagline ?? ''} onChange={(e) => setForm({ ...form, tagline: e.target.value })} error={errors.tagline} hint="One line shown under your academy name" />
      <Textarea label="About your academy" rows={5} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} error={errors.description} hint="At least 20 characters" />
      <Select label="Category" placeholder="Select a category" value={form.categorySlug ?? ''} onChange={(e) => setForm({ ...form, categorySlug: e.target.value || null })} options={(categories ?? []).map((c) => ({ value: c.slug, label: c.name }))} error={errors.categorySlug} />
      <Input label="Support email" type="email" value={form.supportEmail ?? ''} onChange={(e) => setForm({ ...form, supportEmail: e.target.value || null })} error={errors.supportEmail} />
    </div>
  );
}

export function BrandingFields({ form, setForm, errors, fonts, logo, setLogo, favicon, setFavicon }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-5">
        <FileUpload purpose="LOGO" accept="image/png,image/jpeg,image/webp" label="Logo" hint="PNG/JPG/WebP, max 2 MB" value={logo} onUploaded={(f) => setLogo({ id: f.id, url: f.url })} onClear={() => setLogo(null)} />
        <FileUpload purpose="FAVICON" accept="image/png,image/x-icon" label="Favicon" hint="Square PNG or ICO, max 512 KB" value={favicon} onUploaded={(f) => setFavicon({ id: f.id, url: f.url })} onClear={() => setFavicon(null)} />
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {['primaryColor', 'accentColor'].map((k) => (
            <div key={k} className="space-y-1.5">
              <label htmlFor={k} className="text-sm font-medium text-fg-2">{k === 'primaryColor' ? 'Primary colour' : 'Accent colour'}</label>
              <div className="flex items-center gap-2">
                <input id={k} type="color" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-line bg-surface" />
                <Input aria-label={`${k} hex`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} error={errors[k]} />
              </div>
            </div>
          ))}
        </div>
        <Select label="Heading font" value={form.fontHeading} onChange={(e) => setForm({ ...form, fontHeading: e.target.value })} options={(fonts ?? []).map((f) => ({ value: f, label: f }))} />
        <Select label="Body font" value={form.fontBody} onChange={(e) => setForm({ ...form, fontBody: e.target.value })} options={(fonts ?? []).map((f) => ({ value: f, label: f }))} />
        <div className="rounded-lg border border-line p-4" style={{ fontFamily: form.fontBody }}>
          <p className="text-xs text-muted">Preview</p>
          <p className="mt-1 text-lg font-semibold" style={{ fontFamily: form.fontHeading, color: form.primaryColor }}>{form.name || 'Your academy'}</p>
          <button type="button" className="mt-3 rounded-md px-3 py-1.5 text-sm font-medium text-white" style={{ background: form.primaryColor }}>Enrol now</button>
          <span className="ml-2 rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: form.accentColor }}>Bestseller</span>
        </div>
      </div>
    </div>
  );
}

export function BusinessFields({ form, setForm, errors }) {
  const countries = countryOptions();
  const f = (k, label, extra = {}) => <Input label={label} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} error={errors[k]} {...extra} />;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">{f('legalName', 'Legal business name')}</div>
      <div className="sm:col-span-2">{f('addressLine1', 'Address line 1')}</div>
      <div className="sm:col-span-2">{f('addressLine2', 'Address line 2 (optional)')}</div>
      {f('city', 'City')}
      {f('state', 'State / province')}
      {f('postalCode', 'Postal code')}
      <Select label="Country" placeholder="Select" value={form.country ?? ''} onChange={(e) => setForm({ ...form, country: e.target.value })} options={countries} />
      {f('pan', 'PAN (India, optional)', { placeholder: 'AAAAA9999A' })}
      {f('invoicePrefix', 'Invoice prefix', { hint: 'e.g. INV → INV-0001' })}
    </div>
  );
}

export function GstFields({ form, setForm, errors }) {
  return (
    <div className="space-y-4">
      <Switch label="My business is GST registered" checked={Boolean(form.gstRegistered)} onChange={(v) => setForm({ ...form, gstRegistered: v })} />
      {form.gstRegistered && <Input label="GSTIN" placeholder="22AAAAA0000A1Z5" value={form.gstin ?? ''} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} error={errors.gstin} />}
      <p className="text-xs text-muted">GST details appear on invoices issued to your students.</p>
    </div>
  );
}

export const academyPayload = (form, logo, favicon) => ({
  name: form.name, tagline: form.tagline ?? '', description: form.description ?? '', categorySlug: form.categorySlug || null, supportEmail: form.supportEmail || null,
  primaryColor: form.primaryColor, accentColor: form.accentColor, fontHeading: form.fontHeading, fontBody: form.fontBody,
  logoFileId: logo?.id ?? null, faviconFileId: favicon?.id ?? null,
});
export const businessPayload = (b) => {
  const out = {};
  for (const k of ['legalName', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country', 'gstRegistered', 'gstin', 'pan', 'invoicePrefix']) if (b[k] !== null && b[k] !== undefined) out[k] = b[k];
  return out;
};

export function AcademySettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'profile';
  const { academy, business, errors, saveAcademy, saveBusiness } = useAcademyForms();
  const categories = useQuery({ queryKey: ['categories'], queryFn: platformApi.categories, staleTime: 5 * 60_000 });
  const [form, setForm] = useState(null);
  const [biz, setBiz] = useState(null);
  const [logo, setLogo] = useState(null);
  const [favicon, setFavicon] = useState(null);
  useEffect(() => {
    if (academy.data) {
      setForm(academy.data);
      setLogo(academy.data.logoFileId ? { id: academy.data.logoFileId, url: academy.data.logoUrl } : null);
      setFavicon(academy.data.faviconFileId ? { id: academy.data.faviconFileId, url: academy.data.faviconUrl } : null);
    }
  }, [academy.data]);
  useEffect(() => { if (business.data) setBiz(business.data); }, [business.data]);

  if (academy.isError) return <Card><ErrorState error={academy.error} onRetry={() => academy.refetch()} /></Card>;
  if (!form || !biz) return <Skeleton className="h-96" />;
  const saveA = () => saveAcademy.mutate(academyPayload(form, logo, favicon), { onSuccess: () => toast.success('Academy saved') });
  const saveB = () => saveBusiness.mutate(businessPayload(biz), { onSuccess: () => toast.success('Business details saved') });

  return (
    <>
      <PageHeader title="My academy" description="Profile, branding and business details." breadcrumbs={[{ label: 'My academy' }]} />
      <Tabs className="mb-6" value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={[{ value: 'profile', label: 'Profile' }, { value: 'branding', label: 'Branding' }, { value: 'business', label: 'Business & tax' }]} />
      <Card className="max-w-4xl">
        {tab === 'profile' && <><CardHeader title="Profile" /><CardBody><ProfileFields form={form} setForm={setForm} errors={errors} categories={categories.data} /><Button className="mt-6" loading={saveAcademy.isPending} onClick={saveA}>Save profile</Button></CardBody></>}
        {tab === 'branding' && <><CardHeader title="Branding" description="Used on your academy website and emails." /><CardBody><BrandingFields form={form} setForm={setForm} errors={errors} fonts={form.fontChoices} logo={logo} setLogo={setLogo} favicon={favicon} setFavicon={setFavicon} /><Button className="mt-6" loading={saveAcademy.isPending} onClick={saveA}>Save branding</Button></CardBody></>}
        {tab === 'business' && <><CardHeader title="Business & tax" /><CardBody className="space-y-8"><BusinessFields form={biz} setForm={setBiz} errors={errors} /><GstFields form={biz} setForm={setBiz} errors={errors} /><Button loading={saveBusiness.isPending} onClick={saveB}>Save business details</Button></CardBody></>}
      </Card>
    </>
  );
}
