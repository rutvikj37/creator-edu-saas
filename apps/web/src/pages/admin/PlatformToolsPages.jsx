import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CheckCircle2, Globe, GraduationCap, Mail, RefreshCw, RotateCcw, Send, ShoppingCart, Store, Trash2, TrendingUp, Users, XCircle } from 'lucide-react';
import { ListToolbar } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { BreakdownChart, TrendChart } from '../../components/charts/ChartCard.jsx';
import { DateRangeFilter, presetRange } from '../../components/common/DateRangeFilter.jsx';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, EmptyState, ErrorState, Input, Skeleton, StatCard, StatusBadge, Textarea, toast } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';
import { useListParams } from '../../hooks/useListParams.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatMoney, formatNumber } from '../../utils/format.js';

// ── Integrations ────────────────────────────────────────────
export function IntegrationsPage() {
  const q = useQuery({ queryKey: ['platform', 'integrations'], queryFn: platformApi.integrations });
  const groups = Object.entries((q.data?.items ?? []).reduce((acc, i) => ({ ...acc, [i.category]: [...(acc[i.category] ?? []), i] }), {}));
  return (
    <>
      <PageHeader title="Integrations" description="Third-party services the platform uses. Secrets are never shown — only whether each one is set." breadcrumbs={[{ label: 'Integrations' }]}
        actions={q.data && <Badge tone={q.data.summary.configured === q.data.summary.total ? 'success' : 'warning'}>{q.data.summary.configured} of {q.data.summary.total} configured</Badge>} />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : q.isLoading ? <Skeleton className="h-96" /> : (
        <div className="space-y-6">
          {groups.map(([category, items]) => (
            <section key={category}>
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">{category}</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {items.map((i) => (
                  <Card key={i.key}>
                    <CardBody className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-fg">{i.name}</p>
                          <p className="mt-0.5 text-sm text-muted">{i.description}</p>
                        </div>
                        {i.configured ? <CheckCircle2 className="size-5 shrink-0 text-green-600" aria-label="Configured" /> : <XCircle className="size-5 shrink-0 text-muted" aria-label="Not configured" />}
                      </div>
                      {i.details.length > 0 && (
                        <dl className="space-y-1 text-xs">
                          {i.details.map((d) => <div key={d.label} className="flex justify-between gap-3"><dt className="text-muted">{d.label}</dt><dd className="truncate font-mono text-fg-2" title={d.value}>{d.value}</dd></div>)}
                        </dl>
                      )}
                      {i.usage && <p className="text-xs text-fg-2">{i.usage}</p>}
                      {!i.configured && i.missing.length > 0 && (
                        <p className="rounded-md bg-surface-2 px-2 py-1.5 text-xs text-muted">
                          Set {i.missing.map((m) => <code key={m} className="mx-0.5 font-mono text-fg-2">{m}</code>)} in {i.configuredIn === 'settings' ? <Link to="/super-admin/settings" className="underline">Settings</Link> : 'the server environment'}.
                        </p>
                      )}
                    </CardBody>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

// ── Domains ─────────────────────────────────────────────────
export function DomainsAdminPage() {
  const qc = useQueryClient();
  const auth = useAuth();
  const canManage = auth.can?.('platform.tenants.manage') ?? true;
  const [params, update] = useListParams({});
  const [detach, setDetach] = useState(null);
  const q = useQuery({ queryKey: ['platform', 'domains', params], queryFn: () => platformApi.domains(params), placeholderData: (p) => p });
  const summary = useQuery({ queryKey: ['platform', 'domains', 'summary'], queryFn: platformApi.domainSummary });
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform', 'domains'] });
  const verify = useMutation({
    mutationFn: platformApi.verifyDomain,
    onSuccess: (r) => { refresh(); r.ok ? toast.success(`${r.hostname} is verified`) : toast.error(`${r.hostname}: ${r.lastCheckError ?? 'not verified yet'}`); },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({ mutationFn: platformApi.detachDomain, onSuccess: () => { setDetach(null); refresh(); toast.success('Domain detached'); }, onError: (e) => toast.error(e.message) });
  const s = summary.data;
  return (
    <>
      <PageHeader title="Domains" count={q.data?.meta?.total} description="Every academy hostname: platform subdomains and custom domains with their DNS verification." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Platform subdomains" value={formatNumber(s?.subdomains)} icon={Globe} loading={summary.isLoading} />
        <StatCard label="Custom domains" value={formatNumber(s?.custom)} hint={s && `CNAME → ${s.cnameTarget}`} icon={Globe} loading={summary.isLoading} />
        <StatCard label="Verified" value={formatNumber(s?.customVerified)} icon={CheckCircle2} loading={summary.isLoading} />
        <StatCard label="Pending or failing" value={formatNumber((s?.customPending ?? 0) + (s?.customFailed ?? 0))} icon={XCircle} loading={summary.isLoading} />
      </div>
      <Card>
        <ListToolbar search={params.q} onSearch={(v) => update({ q: v })} placeholder="Search hostname or academy" count={q.data?.meta?.total} noun="domain"
          filtered={Boolean(params.type || params.status)} onReset={() => update({ type: undefined, status: undefined })}
          filters={<>
            <FilterChip label="Type" value={params.type} onChange={(v) => update({ type: v })} options={[{ value: 'CUSTOM', label: 'Custom domains' }, { value: 'SUBDOMAIN', label: 'Platform subdomains' }]} />
            <FilterChip label="Status" value={params.status} onChange={(v) => update({ status: v })} options={['VERIFIED', 'PENDING', 'FAILED'].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }))} />
          </>} />
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta} onPageChange={(page) => update({ page }, { resetPage: false })}
          empty={<EmptyState icon={Globe} title="No domains match" description="Try a different search or filter." />}
          columns={[
            { key: 'hostname', header: 'Hostname', cell: (r) => <div><p className="font-mono text-sm text-fg">{r.hostname}</p>{r.isPrimary && <Badge tone="primary" className="mt-1">Primary</Badge>}</div> },
            { key: 'tenant', header: 'Academy', cell: (r) => <Link to={`/super-admin/tenants/${r.tenant.id}`} className="hover:underline"><p>{r.tenant.name}</p><p className="text-xs text-muted">{r.tenant.slug}</p></Link> },
            { key: 'type', header: 'Type', cell: (r) => (r.type === 'CUSTOM' ? 'Custom' : 'Subdomain') },
            { key: 'status', header: 'Status', cell: (r) => <div><StatusBadge status={r.status} />{r.lastCheckError && <p className="mt-1 max-w-56 text-xs text-red-600">{r.lastCheckError}</p>}</div> },
            { key: 'lastCheckedAt', header: 'Last checked', cell: (r) => (r.type === 'CUSTOM' ? formatDate(r.lastCheckedAt, { withTime: true }) : '—') },
            {
              key: 'actions', header: '', align: 'right',
              cell: (r) => r.type === 'CUSTOM' && canManage && (
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Re-check ${r.hostname}`} loading={verify.isPending && verify.variables === r.id} onClick={() => verify.mutate(r.id)}><RefreshCw className="size-4" /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Detach ${r.hostname}`} onClick={() => setDetach(r)}><Trash2 className="size-4" /></Button>
                </div>
              ),
            },
          ]} />
      </Card>
      <ConfirmDialog open={Boolean(detach)} onClose={() => setDetach(null)} title={`Detach ${detach?.hostname}?`} description={`${detach?.tenant.name} stops loading on this domain immediately${detach?.isPrimary ? ' and goes back to its platform subdomain' : ''}. The academy can add it again later.`}
        confirmLabel="Detach" confirmText={detach?.hostname} loading={remove.isPending} onConfirm={() => remove.mutate(detach.id)} />
    </>
  );
}

// ── Platform analytics ──────────────────────────────────────
const money = (list) => (list?.length ? list.map((m) => formatMoney(m.amount, m.currency)).join(' · ') : formatMoney(0, 'INR'));

export function PlatformAnalyticsPage() {
  const [range, setRange] = useState({ preset: '30d', ...presetRange('30d') });
  const q = useQuery({ queryKey: ['platform', 'analytics', range.from, range.to], queryFn: () => platformApi.analytics({ from: range.from, to: range.to }), placeholderData: (p) => p });
  const d = q.data;
  const loading = q.isLoading;
  const t = d?.totals;
  return (
    <>
      <PageHeader title="Platform analytics" description="Growth, learning activity and sales across every academy." breadcrumbs={[{ label: 'Analytics' }]} actions={<DateRangeFilter value={range} onChange={setRange} />} />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="New academies" value={formatNumber(t?.newAcademies)} icon={Store} loading={loading} />
            <StatCard label="New students" value={formatNumber(t?.newStudents)} icon={Users} loading={loading} />
            <StatCard label="Active learners" value={formatNumber(t?.activeLearners)} hint="Made lesson progress" icon={GraduationCap} loading={loading} />
            <StatCard label="Enrollments" value={formatNumber(t?.enrollments)} hint={t && `${formatNumber(t.completions)} courses completed`} icon={BookOpen} loading={loading} />
            <StatCard label="Academy sales (GMV)" value={t && money(t.gmv)} icon={TrendingUp} loading={loading} />
            <StatCard label="Paid orders" value={formatNumber(t?.ordersPaid)} hint={t && `of ${formatNumber(t.ordersCreated)} checkouts started`} icon={ShoppingCart} loading={loading} />
            <StatCard label="Checkout conversion" value={t ? (t.checkoutConversion === null ? '—' : `${t.checkoutConversion}%`) : undefined} icon={TrendingUp} loading={loading} />
            <StatCard label="Courses published" value={formatNumber(t?.coursesPublished)} hint={t && `${formatNumber(t.liveSessionsHeld)} live sessions held`} icon={BookOpen} loading={loading} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <TrendChart title="Enrollments" description="New course enrollments per day" data={d?.series.enrollments} loading={loading} />
            <TrendChart title="Active learners" description="Students making progress per day" data={d?.series.activeLearners} loading={loading} />
            <TrendChart title="Paid orders" description="Orders paid per day" data={d?.series.paidOrders} loading={loading} />
            <TrendChart title={`Sales (${d?.series.gmv.currency ?? 'INR'})`} description="Academy GMV per day" data={d?.series.gmv.points} dataKey="amount" loading={loading} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <BreakdownChart title="Academy activation" description="Academies created in this period, by furthest step reached" data={d?.activation.map((s) => ({ name: s.step, value: s.count }))} loading={loading} />
            <Card>
              <CardHeader title="Feature adoption" description={d && `Share of ${formatNumber(d.adoption.academies)} academies using each feature`} />
              <CardBody className="space-y-2.5">
                {loading ? <Skeleton className="h-48" /> : d.adoption.features.map((f) => (
                  <div key={f.feature}>
                    <div className="flex justify-between text-sm"><span>{f.feature}</span><span className="tabular-nums text-muted">{formatNumber(f.academies)} · {f.percent}%</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-primary-600" style={{ width: `${Math.min(100, f.percent)}%` }} /></div>
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Top academies by sales" />
              <DataTable loading={loading} rows={d?.topAcademies ?? []} rowKey="key" empty={<EmptyState title="No sales in this period" className="py-8" />}
                columns={[
                  { key: 'tenant', header: 'Academy', cell: (r) => (r.tenant ? <Link to={`/super-admin/tenants/${r.tenant.id}`} className="hover:underline">{r.tenant.name}</Link> : '—') },
                  { key: 'gmv', header: 'Sales', align: 'right', cell: (r) => formatMoney(r.gmv, r.currency) },
                  { key: 'sales', header: 'Orders', align: 'right', cell: (r) => formatNumber(r.sales) },
                  { key: 'newEnrollments', header: 'Enrollments', align: 'right', cell: (r) => formatNumber(r.newEnrollments) },
                ]} />
            </Card>
            <Card>
              <CardHeader title="Top courses by enrollments" />
              <DataTable loading={loading} rows={d?.topCourses ?? []} rowKey="courseId" empty={<EmptyState title="No enrollments in this period" className="py-8" />}
                columns={[
                  { key: 'title', header: 'Course', cell: (r) => <div><p className="text-fg">{r.title}</p><p className="text-xs text-muted">{r.academy}</p></div> },
                  { key: 'enrollments', header: 'Enrollments', align: 'right', cell: (r) => formatNumber(r.enrollments) },
                ]} />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

// ── Email templates ─────────────────────────────────────────
export function EmailTemplatesPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['platform', 'email-templates'], queryFn: platformApi.emailTemplates });
  return (
    <>
      <PageHeader title="Email templates" count={Array.isArray(q.data) ? q.data.length : undefined} description="Reword the transactional emails every academy sends. Layout, branding and links are added automatically." breadcrumbs={[{ label: 'Email templates' }]} />
      <Card>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data ?? []} rowKey="key" onRowClick={(r) => navigate(`/super-admin/templates/${r.key}`)}
          empty={<EmptyState icon={Mail} title="No editable emails" />}
          columns={[
            { key: 'name', header: 'Email', cell: (r) => <div><p className="font-medium text-fg">{r.name}</p><p className="text-xs text-muted">{r.description}</p></div> },
            { key: 'subject', header: 'Subject', cell: (r) => <span className="font-mono text-xs">{r.subject}</span> },
            { key: 'customized', header: 'Wording', cell: (r) => (r.customized ? <Badge tone="primary">Customised</Badge> : <Badge>Built-in</Badge>) },
            { key: 'updatedAt', header: 'Last edited', cell: (r) => (r.updatedAt ? formatDate(r.updatedAt) : '—') },
          ]} />
      </Card>
    </>
  );
}

export function EmailTemplateEditorPage() {
  const { key } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'email-templates', key], queryFn: () => platformApi.emailTemplate(key) });
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState([]);
  const [preview, setPreview] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { if (q.data) setDraft({ ...q.data.content, ctaLabel: q.data.content.ctaLabel ?? '' }); }, [q.data]);
  // Live preview, debounced.
  useEffect(() => {
    if (!draft) return undefined;
    const t = setTimeout(() => {
      platformApi.previewEmailTemplate(key, draft).then((r) => { setPreview(r); setErrors([]); }).catch((e) => setErrors(e.details?.map((x) => x.message) ?? [e.message]));
    }, 400);
    return () => clearTimeout(t);
  }, [draft, key]);
  const done = (msg) => (r) => { qc.setQueryData(['platform', 'email-templates', key], r); qc.invalidateQueries({ queryKey: ['platform', 'email-templates'], exact: true }); toast.success(msg); };
  const save = useMutation({ mutationFn: () => platformApi.saveEmailTemplate(key, draft), onSuccess: done('Template saved'), onError: (e) => setErrors(e.details?.map((x) => x.message) ?? [e.message]) });
  const reset = useMutation({ mutationFn: () => platformApi.resetEmailTemplate(key), onSuccess: (r) => { setConfirmReset(false); done('Back to the built-in wording')(r); } });
  const test = useMutation({ mutationFn: () => platformApi.testEmailTemplate(key, draft), onSuccess: (r) => toast.success(`Test email sent to ${r.sentTo}`), onError: (e) => toast.error(e.message) });
  const t = q.data;
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const insert = (name) => setDraft((d) => ({ ...d, body: `${d.body}{{${name}}}` }));

  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  return (
    <>
      <PageHeader title={t?.name ?? 'Email template'} description={t?.description} breadcrumbs={[{ label: 'Email templates', to: '/super-admin/templates' }, { label: t?.name ?? key }]}
        actions={t && (
          <>
            {t.customized && <Button variant="secondary" leftIcon={RotateCcw} onClick={() => setConfirmReset(true)}>Use built-in</Button>}
            <Button variant="secondary" leftIcon={Send} loading={test.isPending} onClick={() => test.mutate()} disabled={errors.length > 0}>Send me a test</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()} disabled={errors.length > 0}>Save</Button>
          </>
        )} />
      {!t || !draft ? <Skeleton className="h-96" /> : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardBody className="space-y-4">
              <Input label="Subject" value={draft.subject} onChange={set('subject')} maxLength={200} />
              <Input label="Heading" value={draft.heading} onChange={set('heading')} maxLength={200} />
              <Textarea label="Message" rows={12} value={draft.body} onChange={set('body')} className="font-mono text-sm"
                hint="Blank lines start a new paragraph. Lines starting with “- ” become a list. Wrap text in **double asterisks** for bold." />
              {t.hasButton && <Input label="Button label" value={draft.ctaLabel} onChange={set('ctaLabel')} maxLength={60} placeholder={t.defaults.ctaLabel} />}
              {errors.length > 0 && <ul role="alert" className="space-y-1 text-sm text-red-600">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
              <div>
                <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Placeholders — click to insert</p>
                <div className="flex flex-wrap gap-2">
                  {t.variables.map((v) => (
                    <button key={v.name} type="button" onClick={() => insert(v.name)} title={v.description}
                      className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-xs hover:border-primary-400">
                      {`{{${v.name}}}`}{t.required.includes(v.name) && <span className="ml-1 text-red-600">*</span>}
                    </button>
                  ))}
                </div>
                {t.required.length > 0 && <p className="mt-2 text-xs text-muted"><span className="text-red-600">*</span> Must stay in the message.</p>}
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Preview" description={preview ? `Subject: ${preview.subject}` : 'Filled with sample values'} />
            <CardBody>
              {preview ? <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[560px] w-full rounded-md border border-line bg-white" /> : <Skeleton className="h-[560px]" />}
            </CardBody>
          </Card>
        </div>
      )}
      <ConfirmDialog open={confirmReset} onClose={() => setConfirmReset(false)} title="Go back to the built-in wording?" description="Your custom subject and message for this email are removed." confirmLabel="Use built-in" loading={reset.isPending} onConfirm={() => reset.mutate()} />
    </>
  );
}
