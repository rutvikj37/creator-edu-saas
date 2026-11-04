import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, CreditCard, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import {
  Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, Input, Modal, Select, Skeleton, StatusBadge, Switch, Tabs, Textarea, toast,
} from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatMoney } from '../../utils/format.js';

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-fg">{children}</dd>
    </div>
  );
}

function UsageBar({ label, used, feature }) {
  const limit = feature?.limit;
  const enabled = feature?.enabled;
  const pct = limit === 0 ? (used > 0 ? 100 : 0) : limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-fg-2">{label}</span>
        <span className="tabular-nums text-muted">{!enabled ? 'Not included' : limit === null ? `${used} / Unlimited` : `${used} / ${limit}`}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-2">
        <div className={`h-1.5 rounded-full ${pct >= 90 ? 'bg-red-500' : 'bg-primary-600'}`} style={{ width: `${enabled && limit !== null ? pct : 0}%` }} />
      </div>
    </div>
  );
}

function ChangePlanModal({ tenant, open, onClose }) {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['platform', 'plans'], queryFn: platformApi.plans, enabled: open });
  const [planId, setPlanId] = useState('');
  const [priceId, setPriceId] = useState('');
  const plan = plans.data?.find((p) => p.id === planId);
  const m = useMutation({
    mutationFn: () => platformApi.assignPlan(tenant.id, { planId, planPriceId: priceId || undefined }),
    onSuccess: () => {
      toast.success('Plan changed');
      qc.invalidateQueries({ queryKey: ['platform', 'tenant', tenant.id] });
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Modal open={open} onClose={onClose} title="Change plan" description="Applies immediately. Paid self-serve changes happen through Billing once payments are enabled."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!planId} loading={m.isPending} onClick={() => m.mutate()}>Apply plan</Button></>}>
      <div className="space-y-4">
        <Select label="Plan" placeholder="Select a plan" value={planId} onChange={(e) => { setPlanId(e.target.value); setPriceId(''); }}
          options={(plans.data ?? []).filter((p) => p.status !== 'ARCHIVED').map((p) => ({ value: p.id, label: `${p.name}${p.status === 'DRAFT' ? ' (draft)' : ''}` }))} />
        {plan && (
          <Select label="Billing price" placeholder="Complimentary (no price)" value={priceId} onChange={(e) => setPriceId(e.target.value)}
            options={plan.prices.filter((p) => p.active).map((p) => ({ value: p.id, label: `${formatMoney(p.amount, p.currency)} / ${p.interval.toLowerCase()}` }))} />
        )}
      </div>
    </Modal>
  );
}

function LimitsCard({ tenant }) {
  const qc = useQueryClient();
  const features = useQuery({ queryKey: ['platform', 'features'], queryFn: platformApi.features });
  const initial = useMemo(() => Object.fromEntries(tenant.limitOverrides.map((o) => [o.featureKey, { enabled: o.enabled, limitValue: o.limitValue, reason: o.reason ?? '' }])), [tenant]);
  const [draft, setDraft] = useState(initial);
  const save = useMutation({
    mutationFn: () => platformApi.setLimits(tenant.id, Object.entries(draft).map(([featureKey, v]) => ({ featureKey, enabled: v.enabled, limitValue: v.limitValue === '' || v.limitValue === undefined ? null : Number(v.limitValue), reason: v.reason || undefined }))),
    onSuccess: () => { toast.success('Overrides saved'); qc.invalidateQueries({ queryKey: ['platform', 'tenant', tenant.id] }); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader title="Limit overrides" description="Override plan values for this tenant only. Empty limit = unlimited." actions={<Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Save overrides</Button>} />
      <div className="divide-y divide-line">
        {(features.data ?? []).map((f) => {
          const o = draft[f.key];
          const planValue = tenant.entitlements.features[f.key];
          return (
            <div key={f.key} className="flex flex-wrap items-center gap-4 px-5 py-3">
              <div className="min-w-48 flex-1">
                <p className="text-sm font-medium">{f.label}</p>
                <p className="text-xs text-muted">Effective: {!planValue ? 'not included' : f.kind === 'flag' ? (planValue.enabled ? 'on' : 'off') : planValue.limit ?? 'unlimited'}</p>
              </div>
              <Switch label="Override" checked={Boolean(o)} onChange={(on) => setDraft((d) => { const n = { ...d }; if (on) n[f.key] = { enabled: true, limitValue: f.kind === 'limit' ? planValue?.limit ?? '' : null, reason: '' }; else delete n[f.key]; return n; })} />
              {o && (
                <>
                  {f.kind === 'flag' ? (
                    <Switch label="Enabled" checked={o.enabled} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: { ...o, enabled: v } }))} />
                  ) : (
                    <Input aria-label={`${f.label} limit`} type="number" min={0} className="w-28" value={o.limitValue ?? ''} placeholder="Unlimited" onChange={(e) => setDraft((d) => ({ ...d, [f.key]: { ...o, limitValue: e.target.value } }))} />
                  )}
                  <Input aria-label="Reason" className="w-56" placeholder="Reason (audit)" value={o.reason} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: { ...o, reason: e.target.value } }))} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function TenantDetailPage() {
  const { id } = useParams();
  const auth = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'tenant', id], queryFn: () => platformApi.tenant(id) });
  const [tab, setTab] = useState('overview');
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform', 'tenant', id] });
  const act = (fn, msg) => ({ mutationFn: fn, onSuccess: () => { toast.success(msg); refresh(); qc.invalidateQueries({ queryKey: ['platform', 'tenants'] }); }, onError: (e) => toast.error(e.message) });
  const activate = useMutation(act(() => platformApi.activateTenant(id), 'Tenant activated'));
  const suspend = useMutation(act(() => platformApi.suspendTenant(id, reason), 'Tenant suspended'));
  const remove = useMutation(act(() => platformApi.deleteTenant(id, q.data.slug), 'Deletion scheduled'));
  const restore = useMutation(act(() => platformApi.restoreTenant(id), 'Tenant restored'));
  const canManage = auth.can('platform.tenants.manage');

  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  const t = q.data;
  const f = t.entitlements.features;

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{t.name} <StatusBadge status={t.status} /></span>}
        description={`${t.slug} · created ${formatDate(t.createdAt)}`}
        breadcrumbs={[{ label: 'Tenants', to: '/super-admin/tenants' }, { label: t.name }]}
        actions={canManage && (
          <>
            {t.status === 'PENDING_DELETION' ? (
              auth.can('platform.tenants.delete') && <Button leftIcon={RotateCcw} loading={restore.isPending} onClick={() => restore.mutate()}>Restore</Button>
            ) : (
              <>
                <Button variant="secondary" leftIcon={CreditCard} onClick={() => setPlanOpen(true)}>Change plan</Button>
                {t.status === 'SUSPENDED' || t.status === 'ONBOARDING' ? (
                  <Button variant="secondary" leftIcon={CheckCircle2} loading={activate.isPending} onClick={() => activate.mutate()}>Activate</Button>
                ) : (
                  <Button variant="secondary" leftIcon={Ban} onClick={() => setSuspendOpen(true)}>Suspend</Button>
                )}
                {auth.can('platform.tenants.delete') && <Button variant="danger" leftIcon={Trash2} onClick={() => setDeleteOpen(true)}>Delete</Button>}
              </>
            )}
          </>
        )}
      />
      {t.status === 'SUSPENDED' && <Alert tone="error" title="Suspended" className="mb-6">{t.suspendedReason}</Alert>}
      {t.status === 'PENDING_DELETION' && <Alert tone="error" title="Scheduled for deletion" className="mb-6">Data will be removed after {formatDate(t.deletionScheduledAt)}. Financial records are always retained.</Alert>}

      <Tabs className="mb-6" value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: 'Overview' },
        { value: 'subscription', label: 'Subscription' },
        { value: 'limits', label: 'Limits' },
        { value: 'domains', label: 'Domains', count: t.domains.length },
        { value: 'members', label: 'Members', count: t.members.length },
        { value: 'activity', label: 'Activity' },
      ]} />

      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Owner" />
            <CardBody>
              <dl className="divide-y divide-line">
                <Row label="Name">{t.owner.fullName}</Row>
                <Row label="Email">{t.owner.email} {t.owner.emailVerifiedAt ? <Badge tone="success">verified</Badge> : <Badge tone="warning">unverified</Badge>}</Row>
                <Row label="Phone">{t.owner.phone ?? '—'}</Row>
                <Row label="Last sign-in">{formatDate(t.owner.lastLoginAt, { withTime: true })}</Row>
                <Row label="Country">{t.country ?? '—'}</Row>
                <Row label="Currency">{t.defaultCurrency}</Row>
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Usage" description={t.subscription ? `${t.subscription.plan.name} · ${t.subscription.status.toLowerCase()}` : 'No active plan'} actions={<SlidersHorizontal className="size-4 text-muted" />} />
            <CardBody className="space-y-4">
              <UsageBar label="Students" used={t.usage.students} feature={f['students.max']} />
              <UsageBar label="Staff accounts" used={t.usage.staff} feature={f['staff.max']} />
              <UsageBar label="Custom domains" used={t.usage.customDomains} feature={f['domains.custom']} />
              <p className="text-xs text-muted">Course, storage and bandwidth usage appear as those modules record usage.</p>
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'subscription' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Current subscription" />
            <CardBody>
              {t.subscription ? (
                <dl className="divide-y divide-line">
                  <Row label="Plan">{t.subscription.plan.name}</Row>
                  <Row label="Status"><StatusBadge status={t.subscription.status} /></Row>
                  <Row label="Price">{t.subscription.planPrice ? `${formatMoney(t.subscription.planPrice.amount, t.subscription.planPrice.currency)} / ${t.subscription.planPrice.interval.toLowerCase()}` : 'Complimentary'}</Row>
                  <Row label="Started">{formatDate(t.subscription.currentPeriodStart)}</Row>
                  <Row label={t.subscription.status === 'TRIALING' ? 'Trial ends' : 'Renews / ends'}>{formatDate(t.subscription.currentPeriodEnd)}</Row>
                  <Row label="Source">{t.subscription.source}</Row>
                </dl>
              ) : <p className="text-sm text-muted">No active subscription.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <ul className="divide-y divide-line">
              {t.subscriptionHistory.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span>{s.plan.name} <span className="text-xs text-muted">· {s.source}</span></span>
                  <span className="flex items-center gap-2 text-muted"><StatusBadge status={s.status} /> {formatDate(s.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {tab === 'limits' && (canManage ? <LimitsCard key={t.updatedAt} tenant={t} /> : <Card><CardBody>You can view but not change limits.</CardBody></Card>)}

      {tab === 'domains' && (
        <Card>
          <ul className="divide-y divide-line">
            {t.domains.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span className="font-medium">{d.hostname} {d.isPrimary && <Badge tone="primary">Primary</Badge>}</span>
                <span className="flex items-center gap-2"><Badge>{d.type.toLowerCase()}</Badge><StatusBadge status={d.status} /></span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'members' && (
        <Card>
          <ul className="divide-y divide-line">
            {t.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span><span className="font-medium">{m.user.fullName}</span> <span className="text-muted">{m.user.email}</span></span>
                <span className="flex items-center gap-2"><Badge>{m.role.name}</Badge><StatusBadge status={m.status} /></span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'activity' && (
        <Card>
          {t.recentActivity.length === 0 ? <CardBody className="text-sm text-muted">No activity recorded yet.</CardBody> : (
            <ul className="divide-y divide-line">
              {t.recentActivity.map((a) => (
                <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <code className="text-xs">{a.action}</code>
                  <span className="text-muted">{formatDate(a.createdAt, { withTime: true })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Modal open={suspendOpen} onClose={() => setSuspendOpen(false)} title={`Suspend ${t.name}?`} description="The workspace becomes read-only, the academy goes offline and students are signed out."
        footer={<><Button variant="secondary" onClick={() => setSuspendOpen(false)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={suspend.isPending} onClick={() => suspend.mutate(undefined, { onSuccess: () => { setSuspendOpen(false); setReason(''); } })}>Suspend</Button></>}>
        <Textarea label="Reason (shown to the creator)" required value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      </Modal>
      <ChangePlanModal tenant={t} open={planOpen} onClose={() => setPlanOpen(false)} />
      <ConfirmDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title={`Delete ${t.name}?`} confirmText={t.slug} confirmLabel="Schedule deletion"
        description="The academy goes offline now and is permanently removed after 30 days unless restored." loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => setDeleteOpen(false) })} />
    </>
  );
}
