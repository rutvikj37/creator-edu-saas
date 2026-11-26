import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, KeyRound, ListPlus, Mail, MonitorSmartphone, Pencil, Plus, Send, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { PageHeader } from '../../../components/layout/PageHeader.jsx';
import { SettingsTabs } from '../../../components/layout/SettingsTabs.jsx';
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, Input, Modal, Select, Skeleton, Switch, Textarea, toast } from '../../../components/ui/index.js';
import { academySettingsApi } from '../../../services/api/academySettings.js';
import { Row, Section } from './SecurityPage.jsx';

/** Loads one preferences section and saves each change straight away (like Security). */
function usePreferences(section) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'prefs', section], queryFn: () => academySettingsApi.preferences(section) });
  const [s, setS] = useState(null);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: (patch) => academySettingsApi.savePreferences(section, patch),
    onSuccess: (d) => { qc.setQueryData(['settings', 'prefs', section], d); setS(d); toast.success('Saved'); },
    onError: (e) => { toast.error(e.details?.[0]?.message ?? e.message); if (q.data) setS(q.data); },
  });
  const put = (patch) => { setS((x) => ({ ...x, ...patch })); save.mutate(patch); };
  return { q, s, setS, put, save };
}

function Shell({ title, description, q, children }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <SettingsTabs />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : children}
    </>
  );
}

// ── Communications ──────────────────────────────────────────

/** A text setting that saves when you leave the field (or press Save). */
function TextSetting({ id, value, placeholder, type = 'text', onSave, saving }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const dirty = v.trim() !== (value ?? '');
  return (
    <div className="flex gap-2">
      <Input id={id} type={type} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} className="flex-1" />
      <Button variant="secondary" disabled={!dirty} loading={saving && dirty} onClick={() => onSave(v.trim())}>Save</Button>
    </div>
  );
}

export function CommunicationsPage() {
  const { q, s, put, save } = usePreferences('communications');
  const [alert, setAlert] = useState('');
  if (!s && !q.isError) return <Shell title="Communications" description="Configure how your academy emails learners." q={q}><Skeleton className="h-96" /></Shell>;
  const addAlert = () => {
    const email = alert.trim().toLowerCase();
    if (!email) return;
    put({ purchaseAlertEmails: [...new Set([...(s.purchaseAlertEmails ?? []), email])] });
    setAlert('');
  };
  return (
    <Shell title="Communications" description="Configure how your academy emails learners." q={q}>
      {s && (
        <Card className="p-4 sm:p-6">
          <Section icon={Mail} title="Email configuration" />
          <Row label="Sender’s name" hint="Learners see this name on every email from your academy. Leave blank to use your academy name." htmlFor="sender">
            <TextSetting id="sender" value={s.senderName} placeholder="e.g. Speak with Harshitha" saving={save.isPending} onSave={(v) => put({ senderName: v })} />
          </Row>
          <Row label="Reply inbox" hint="When a learner replies to one of your emails, the reply goes here." htmlFor="reply">
            <TextSetting id="reply" type="email" value={s.replyTo} placeholder="you@example.com" saving={save.isPending} onSave={(v) => put({ replyTo: v })} />
          </Row>
          <Row label="Notification for every successful purchase" hint="These addresses get an email each time a learner buys something. Up to 5." htmlFor="alert">
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input id="alert" type="email" value={alert} placeholder="sales@example.com" onChange={(e) => setAlert(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAlert(); } }} className="flex-1" />
                <Button variant="secondary" leftIcon={Plus} disabled={!alert.trim() || (s.purchaseAlertEmails ?? []).length >= 5} onClick={addAlert}>Add email</Button>
              </div>
              {(s.purchaseAlertEmails ?? []).length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {s.purchaseAlertEmails.map((e) => (
                    <li key={e} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-1 pr-1 pl-3 text-sm">
                      {e}
                      <button type="button" aria-label={`Remove ${e}`} className="grid size-5 place-items-center rounded-full text-muted hover:bg-surface hover:text-fg" onClick={() => put({ purchaseAlertEmails: s.purchaseAlertEmails.filter((x) => x !== e) })}>×</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Row>
          <Section icon={Send} title="Manage your email communications" />
          <p className="px-1 py-3 text-sm text-muted sm:px-4">Turn off emails you don’t want learners to get. Sign-in, verification, password and login-detail emails always go out.</p>
          <div className="overflow-x-auto px-1 sm:px-4">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase"><th className="py-2 font-medium">Email</th><th className="py-2 text-right font-medium">Status</th></tr></thead>
              <tbody className="divide-y divide-line">
                {(s.emailTypes ?? []).map((t) => {
                  const on = s.emails?.[t.tag] !== false;
                  return (
                    <tr key={t.tag}>
                      <td className="py-3 pr-4"><p className="font-medium text-fg">{t.name}</p><p className="text-xs text-muted">{t.description}</p></td>
                      <td className="py-3 text-right"><div className="inline-flex"><Switch hideLabel label={on ? `${t.name}: on` : `${t.name}: off`} checked={on} onChange={(v) => put({ emails: { ...(s.emails ?? {}), [t.tag]: v } })} /></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Shell>
  );
}

// ── User experience ─────────────────────────────────────────

export function UserExperiencePage() {
  const { q, s, put } = usePreferences('experience');
  return (
    <Shell title="User experience" description="Manage how learners use your academy." q={q}>
      {!s ? <Skeleton className="h-96" /> : (
        <Card className="p-4 sm:p-6">
          <Section icon={ShieldCheck} title="Verify new accounts" />
          <Row label="Verify email address" hint="Learners must confirm their email before they can open course content. They get a verification email when they sign up and can request a new one from their account.">
            <Switch hideLabel label="Require email verification" checked={s.requireEmailVerification} onChange={(v) => put({ requireEmailVerification: v })} />
          </Row>
          <Section icon={MonitorSmartphone} title="Website permissions" />
          <Row label="Email me about new reviews" hint="Owners and admins get an email each time a learner posts a review.">
            <Switch hideLabel label="New review emails" checked={s.reviewNotifications} onChange={(v) => put({ reviewNotifications: v })} />
          </Row>
          <Row label="Cookie notice" hint="Show a short cookie notice on your academy website until the visitor accepts it.">
            <Switch hideLabel label="Show cookie notice" checked={s.cookieBanner} onChange={(v) => put({ cookieBanner: v })} />
          </Row>
          <Row label="Default form for logged-out visitors" hint="When a visitor needs an account (for example to enrol), show this form first." htmlFor="defaultForm">
            <Select id="defaultForm" value={s.defaultForm} onChange={(e) => put({ defaultForm: e.target.value })} options={[{ value: 'signup', label: 'Sign up form' }, { value: 'login', label: 'Log in form' }]} />
          </Row>
        </Card>
      )}
    </Shell>
  );
}

// ── Signup & login ──────────────────────────────────────────

export function SignupLoginPage() {
  const { q, s, put } = usePreferences('signup');
  return (
    <Shell title="Signup and login" description="Set up the onboarding experience for your learners." q={q}>
      {!s ? <Skeleton className="h-64" /> : (
        <Card className="p-4 sm:p-6">
          <Section icon={UserPlus} title="Google" />
          <Row label="Allow learners to sign up and log in with Google" hint="Shows “Continue with Google” on your academy’s sign-in and sign-up pages.">
            <Switch hideLabel label="Google sign-in" checked={s.googleEnabled} onChange={(v) => put({ googleEnabled: v })} />
          </Row>
          <Section icon={KeyRound} title="Password policy" />
          <Row label="Enable secure password policy" hint="Learners must use at least 8 characters with an uppercase letter, a lowercase letter and a number. Applies to new passwords.">
            <Switch hideLabel label="Secure password policy" checked={s.securePasswordPolicy} onChange={(v) => put({ securePasswordPolicy: v })} />
          </Row>
        </Card>
      )}
    </Shell>
  );
}

// ── Custom fields ───────────────────────────────────────────

const TYPES = [{ value: 'TEXT', label: 'Text' }, { value: 'NUMBER', label: 'Number' }, { value: 'DATE', label: 'Date' }, { value: 'SELECT', label: 'Dropdown' }, { value: 'CHECKBOX', label: 'Checkbox (yes / no)' }];
const blank = { label: '', type: 'TEXT', options: '', required: false, editable: true, showInSignup: true, askBeforeCourse: false };

function FieldModal({ field, onClose }) {
  const qc = useQueryClient();
  const [f, setF] = useState(blank);
  const [error, setError] = useState(null);
  useEffect(() => { if (field) setF(field === 'new' ? blank : { ...field, options: (field.options ?? []).join('\n') }); setError(null); }, [field]);
  const body = () => ({ label: f.label, ...(field === 'new' ? { type: f.type } : {}), ...(f.type === 'SELECT' ? { options: f.options.split('\n').map((o) => o.trim()).filter(Boolean) } : {}), required: f.required, editable: f.editable, showInSignup: f.showInSignup, askBeforeCourse: f.askBeforeCourse });
  const save = useMutation({
    mutationFn: () => (field === 'new' ? academySettingsApi.createCustomField(body()) : academySettingsApi.updateCustomField(field.id, body())),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['creator', 'settings', 'custom-fields'] }); toast.success('Field saved'); onClose(); },
    onError: (e) => setError(e.details?.[0]?.message ?? e.message),
  });
  return (
    <Modal open={Boolean(field)} onClose={onClose} title={field === 'new' ? 'Add custom field' : 'Edit custom field'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!f.label.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <Input label="Field title" value={f.label} maxLength={80} onChange={(e) => setF({ ...f, label: e.target.value })} required />
        <Select label="Field type" value={f.type} disabled={field !== 'new'} hint={field !== 'new' ? 'The type can’t change after the field is created.' : undefined} onChange={(e) => setF({ ...f, type: e.target.value })} options={TYPES} />
        {f.type === 'SELECT' && <Textarea label="Choices" hint="One per line, at least two." rows={4} value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} />}
        <Checkbox label="Mark as required" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} />
        <Checkbox label="Allow learners to edit their answer after submitting" checked={f.editable} onChange={(e) => setF({ ...f, editable: e.target.checked })} />
        <Checkbox label="Insert field in the sign-up form" checked={f.showInSignup} onChange={(e) => setF({ ...f, showInSignup: e.target.checked })} />
        <Checkbox label="Ask before a learner opens a course for the first time" checked={f.askBeforeCourse} onChange={(e) => setF({ ...f, askBeforeCourse: e.target.checked })} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

export function CustomFieldsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['creator', 'settings', 'custom-fields'], queryFn: academySettingsApi.customFields });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['creator', 'settings', 'custom-fields'] });
  const remove = useMutation({ mutationFn: (id) => academySettingsApi.deleteCustomField(id), onSuccess: () => { toast.success('Field deleted'); setDeleting(null); refresh(); }, onError: (e) => toast.error(e.message) });
  const reorder = useMutation({ mutationFn: (ids) => academySettingsApi.reorderCustomFields(ids), onSuccess: (d) => qc.setQueryData(['creator', 'settings', 'custom-fields'], d), onError: (e) => toast.error(e.message) });
  const fields = q.data ?? [];
  const move = (i, by) => { const ids = fields.map((f) => f.id); [ids[i], ids[i + by]] = [ids[i + by], ids[i]]; reorder.mutate(ids); };
  return (
    <Shell title="Custom fields" description="Collect additional details from your learners." q={q}>
      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-line p-4">
          <p className="text-sm text-muted">{fields.length} of 20 fields</p>
          <Button leftIcon={ListPlus} disabled={fields.length >= 20} onClick={() => setEditing('new')}>Add custom field</Button>
        </div>
        {q.isLoading ? <Skeleton className="m-4 h-24" /> : fields.length === 0 ? (
          <EmptyState icon={ListPlus} title="No custom fields yet" description="Ask learners for things like their city, roll number or company — on sign-up, or before they open a course." action={<Button leftIcon={Plus} onClick={() => setEditing('new')}>Add custom field</Button>} />
        ) : (
          <ul className="divide-y divide-line">
            {fields.map((f, i) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg">{f.label}{f.required && <span className="text-red-600"> *</span>}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
                    <Badge>{TYPES.find((t) => t.value === f.type)?.label}</Badge>
                    {f.showInSignup && <Badge tone="info">Sign-up form</Badge>}
                    {f.askBeforeCourse && <Badge tone="info">Before first course</Badge>}
                    {!f.editable && <Badge tone="warning">Can’t be edited later</Badge>}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Move ${f.label} up`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Move ${f.label} down`} disabled={i === fields.length - 1 || reorder.isPending} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${f.label}`} onClick={() => setEditing(f)}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${f.label}`} onClick={() => setDeleting(f)}><Trash2 className="size-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <FieldModal field={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting.id)} loading={remove.isPending}
        title={`Delete “${deleting?.label}”?`} description="Learners’ answers to this field are deleted too. This can’t be undone." confirmLabel="Delete field" />
    </Shell>
  );
}

