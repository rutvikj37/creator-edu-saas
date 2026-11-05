import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BookOpen, Download, GraduationCap, IndianRupee, Receipt, Users } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, Input, Skeleton, StatCard, Tabs, toast } from '../../components/ui/index.js';
import { analyticsApi } from '../../services/api/analytics.js';
import { coursesApi } from '../../services/api/creator.js';
import { saveBlob } from '../../utils/download.js';
import { formatMoney, formatNumber } from '../../utils/format.js';

const TABS = [{ value: 'overview', label: 'Overview' }, { value: 'courses', label: 'Courses' }, { value: 'gst', label: 'GST report' }, { value: 'exports', label: 'Exports' }];
const PRESETS = [{ label: '7 days', days: 7 }, { label: '30 days', days: 30 }, { label: '90 days', days: 90 }, { label: '12 months', days: 365 }];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function presetRange(days) {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: iso(from), to: iso(to) };
}
const exportError = (e) => (e.status === 403 ? 'Your plan does not include this export. Upgrade in Billing.' : e.status === 422 ? 'Too much data for one file — choose a shorter period.' : e.message);

/** Date-range control shared by the overview, GST and export tabs (one row, above the content). */
function RangeBar({ range, onChange }) {
  const [draft, setDraft] = useState(range);
  const active = PRESETS.find((p) => { const r = presetRange(p.days); return r.from === range.from && r.to === range.to; });
  return (
    <div className="mb-6 flex flex-wrap items-end gap-2">
      <div className="flex gap-1" role="group" aria-label="Quick ranges">
        {PRESETS.map((p) => <Button key={p.days} size="sm" variant={active?.days === p.days ? 'primary' : 'secondary'} onClick={() => { const r = presetRange(p.days); setDraft(r); onChange(r); }}>{p.label}</Button>)}
      </div>
      <Input label="From" type="date" className="w-40" value={draft.from} max={draft.to} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
      <Input label="To" type="date" className="w-40" value={draft.to} min={draft.from} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
      <Button size="sm" variant="secondary" disabled={!draft.from || !draft.to || (draft.from === range.from && draft.to === range.to)} onClick={() => onChange(draft)}>Apply</Button>
    </div>
  );
}

function DailyBars({ title, data, dataKey, format }) {
  const total = data.reduce((n, r) => n + Number(r[dataKey]), 0);
  return (
    <Card>
      <CardHeader title={title} description={`Total ${format(total)}`} />
      <CardBody>
        {total === 0 ? <p className="py-10 text-center text-sm text-muted">Nothing in this period.</p> : (
          <div className="h-56" role="img" aria-label={`${title}: bar chart by day, total ${format(total)}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: 'var(--line)' }} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={(d) => d.slice(5)} minTickGap={24} />
                <YAxis width={56} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={(v) => format(v, true)} allowDecimals={false} />
                <Tooltip cursor={{ fill: 'var(--line)', opacity: 0.5 }} formatter={(v) => [format(Number(v)), title]} labelStyle={{ color: 'var(--fg)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey={(r) => Number(r[dataKey])} name={title} fill="var(--primary-600)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Overview({ range }) {
  const q = useQuery({ queryKey: ['analytics', 'overview', range], queryFn: () => analyticsApi.overview(range) });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const o = q.data;
  const cur = o?.range.currency ?? 'INR';
  const t = o?.money.totals.find((x) => x.currency === cur);
  const money = (v, short) => (short ? new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : formatMoney(v, cur));
  const count = (v) => formatNumber(v);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sales (incl. GST)" value={t ? formatMoney(t.gross, cur) : formatMoney(0, cur)} hint={t && Number(t.refunds) > 0 ? `${formatMoney(t.refunds, cur)} refunded` : undefined} icon={IndianRupee} loading={!o} />
        <StatCard label="Your earnings" value={formatMoney(t?.net ?? 0, cur)} hint="After refunds, GST, Razorpay fees and commissions" icon={Receipt} loading={!o} />
        <StatCard label="New students" value={count(o?.counts.newStudents)} icon={Users} loading={!o} />
        <StatCard label="Enrolments" value={count(o?.counts.enrollments)} hint={o ? `${count(o.counts.completions)} completions` : undefined} icon={GraduationCap} loading={!o} />
      </div>
      {!o ? <Skeleton className="h-64" /> : (
        <>
          {o.money.totals.length > 1 && <Alert tone="info">Some sales were in other currencies; the charts show {cur} only. Totals per currency are in Orders.</Alert>}
          <div className="grid gap-6 lg:grid-cols-2">
            <DailyBars title={`Sales per day, net of refunds (${cur})`} data={o.series} dataKey="revenue" format={money} />
            <DailyBars title="Enrolments per day" data={o.series} dataKey="enrollments" format={count} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Top courses by sales" />
              <DataTable rows={o.topCourses} rowKey="courseId" empty={<EmptyState icon={BookOpen} title="No paid sales in this period" className="py-8" />}
                columns={[{ key: 'title', header: 'Course' }, { key: 'sales', header: 'Sales', align: 'right' }, { key: 'revenue', header: 'Revenue', align: 'right', cell: (r) => formatMoney(r.revenue, cur) }]} />
            </Card>
            <Card>
              <CardHeader title="How students enrolled" />
              <DataTable rows={Object.entries(o.enrollmentsBySource).map(([source, n]) => ({ id: source, source, n })).sort((a, b) => b.n - a.n)} empty={<EmptyState title="No enrolments in this period" className="py-8" />}
                columns={[{ key: 'source', header: 'Source', cell: (r) => ({ PURCHASE: 'Purchase', FREE: 'Free course', MANUAL: 'Added by you', MEMBERSHIP: 'Membership', BATCH: 'Batch', BUNDLE: 'Bundle', IMPORT: 'Import' })[r.source] ?? r.source }, { key: 'n', header: 'Enrolments', align: 'right' }]} />
            </Card>
          </div>
          <details className="rounded-lg border border-line bg-surface p-4 text-sm">
            <summary className="cursor-pointer font-medium">Daily figures (table)</summary>
            <table className="mt-3 w-full text-left tabular-nums">
              <thead className="text-xs text-muted"><tr><th className="py-1">Date</th><th className="text-right">Sales</th><th className="text-right">Enrolments</th><th className="text-right">New students</th></tr></thead>
              <tbody>{o.series.map((r) => <tr key={r.date} className="border-t border-line"><td className="py-1">{r.date}</td><td className="text-right">{formatMoney(r.revenue, cur)}</td><td className="text-right">{r.enrollments}</td><td className="text-right">{r.students}</td></tr>)}</tbody>
            </table>
          </details>
          <p className="text-xs text-muted">Days are counted in your academy time zone ({o.range.timezone}). Figures come from your orders, payments and enrolments.</p>
        </>
      )}
    </div>
  );
}

function CoursesTab() {
  const q = useQuery({ queryKey: ['analytics', 'courses'], queryFn: analyticsApi.courses, retry: false });
  if (q.error?.status === 403) return <Card><EmptyState icon={BookOpen} title="Course analytics are on higher plans" description="See completion rates, progress and active learners per course. Upgrade in Billing." /></Card>;
  return (
    <Card>
      <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data ?? []} empty={<EmptyState icon={BookOpen} title="No courses yet" />}
        columns={[
          { key: 'title', header: 'Course' },
          { key: 'enrollments', header: 'Enrolled', align: 'right' },
          { key: 'activeLast30Days', header: 'Active (30 days)', align: 'right' },
          { key: 'averageProgress', header: 'Avg. progress', align: 'right', cell: (r) => `${r.averageProgress}%` },
          { key: 'completionRate', header: 'Completion', align: 'right', cell: (r) => `${r.completionRate}% (${r.completions})` },
          { key: 'sales', header: 'Sales', align: 'right' },
          { key: 'revenue', header: 'Revenue', align: 'right', cell: (r) => formatMoney(r.revenue, 'INR') },
        ]} />
    </Card>
  );
}

function GstTab({ range }) {
  const q = useQuery({ queryKey: ['analytics', 'gst', range], queryFn: () => analyticsApi.gst(range) });
  const dl = useMutation({ mutationFn: () => analyticsApi.exportCsv('gst', range), onSuccess: (b) => saveBlob(b, `gst-${range.from}-to-${range.to}.csv`), onError: (e) => toast.error(exportError(e)) });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const g = q.data;
  const m = (v, c = 'INR') => formatMoney(v, c);
  return (
    <div className="space-y-6">
      {g && !g.sellerGstin && g.rows.length > 0 && <Alert tone="warning">These invoices were issued without a GSTIN. If you are GST-registered, add your GSTIN in Settings → Business so new invoices carry it.</Alert>}
      <Card>
        <CardHeader title="Summary" description="Invoices minus credit notes (refunds) in the period, by GST rate." actions={<Button size="sm" variant="secondary" leftIcon={Download} loading={dl.isPending} onClick={() => dl.mutate()}>Download CSV</Button>} />
        {!g ? <Skeleton className="h-24" /> : (
          <DataTable rows={g.summary.map((s) => ({ ...s, id: `${s.currency}:${s.rate}` }))} empty={<EmptyState icon={Receipt} title="No invoices in this period" className="py-8" />}
            columns={[
              { key: 'rate', header: 'Rate', cell: (r) => `${r.rate}%` }, { key: 'documents', header: 'Documents', align: 'right' },
              { key: 'taxable', header: 'Taxable value', align: 'right', cell: (r) => m(r.taxable, r.currency) }, { key: 'igst', header: 'IGST', align: 'right', cell: (r) => m(r.igst, r.currency) },
              { key: 'cgst', header: 'CGST', align: 'right', cell: (r) => m(r.cgst, r.currency) }, { key: 'sgst', header: 'SGST', align: 'right', cell: (r) => m(r.sgst, r.currency) },
              { key: 'total', header: 'Total', align: 'right', cell: (r) => m(r.total, r.currency) },
            ]} />
        )}
      </Card>
      {g?.rows.length > 0 && (
        <Card>
          <CardHeader title="Documents" />
          <DataTable rows={g.rows.map((r) => ({ ...r, id: r.number }))}
            columns={[
              { key: 'number', header: 'Document', cell: (r) => <div><p className="font-mono text-xs">{r.number}</p><p className="text-xs text-muted">{r.type === 'INVOICE' ? 'Invoice' : `Credit note for ${r.invoiceNumber}`}</p></div> },
              { key: 'date', header: 'Date' },
              { key: 'customer', header: 'Customer', cell: (r) => <div><p>{r.customer}</p>{r.gstin && <p className="font-mono text-xs text-muted">{r.gstin}</p>}</div> },
              { key: 'placeOfSupply', header: 'Place of supply', cell: (r) => `${r.placeOfSupply ?? '—'} · ${r.interState ? 'Inter' : 'Intra'}` },
              { key: 'taxable', header: 'Taxable', align: 'right', cell: (r) => m(r.taxable, r.currency) },
              { key: 'tax', header: 'GST', align: 'right', cell: (r) => m(r.igst + r.cgst + r.sgst, r.currency) },
              { key: 'total', header: 'Total', align: 'right', cell: (r) => m(r.total, r.currency) },
            ]} />
        </Card>
      )}
      <p className="text-xs text-muted">Place of supply: the buyer’s GSTIN state for B2B; the state entered at checkout for B2C; your own state when the buyer gave none. Check figures with your accountant before filing GSTR-1/3B.</p>
    </div>
  );
}

function ExportsTab({ range }) {
  const courses = useQuery({ queryKey: ['creator', 'courses', 'all'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const [courseId, setCourseId] = useState('');
  const dl = useMutation({
    mutationFn: ({ kind, params, name }) => analyticsApi.exportCsv(kind, params).then((b) => saveBlob(b, name)),
    onError: (e) => toast.error(exportError(e)),
  });
  const row = (title, description, action) => (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div><p className="font-medium">{title}</p><p className="text-sm text-muted">{description}</p></div>
      {action}
    </div>
  );
  return (
    <Card>
      <CardBody className="divide-y divide-line p-0">
        {row('Orders', `Paid orders from ${range.from} to ${range.to}, with GST, refunds and invoice numbers.`, <Button size="sm" variant="secondary" leftIcon={Download} onClick={() => dl.mutate({ kind: 'orders', params: range, name: `orders-${range.from}-to-${range.to}.csv` })}>Download</Button>)}
        {row('GST report', `Invoices and credit notes from ${range.from} to ${range.to}.`, <Button size="sm" variant="secondary" leftIcon={Download} onClick={() => dl.mutate({ kind: 'gst', params: range, name: `gst-${range.from}-to-${range.to}.csv` })}>Download</Button>)}
        {row('Students', 'Everyone registered in your academy, with course counts. Higher plans.', <Button size="sm" variant="secondary" leftIcon={Download} onClick={() => dl.mutate({ kind: 'students', name: 'students.csv' })}>Download</Button>)}
        {row('Enrolments', 'Progress and access dates per student. Higher plans.', (
          <div className="flex gap-2">
            <select aria-label="Course" className="rounded-md border border-line bg-surface px-2 text-sm" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">All courses</option>
              {(courses.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <Button size="sm" variant="secondary" leftIcon={Download} onClick={() => dl.mutate({ kind: 'enrollments', params: { courseId }, name: 'enrollments.csv' })}>Download</Button>
          </div>
        ))}
      </CardBody>
      <p className="px-5 pb-4 text-xs text-muted">Files open in Excel or Google Sheets. Times are in your academy time zone.</p>
    </Card>
  );
}

export function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'overview';
  const range = params.get('from') && params.get('to') ? { from: params.get('from'), to: params.get('to') } : presetRange(30);
  const set = (patch) => setParams((p) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(patch)) n.set(k, v); return n; }, { replace: true });
  return (
    <>
      <PageHeader title="Analytics" description="Sales, learners and tax reports from your academy’s own data." breadcrumbs={[{ label: 'Growth' }, { label: 'Analytics' }]} />
      <Tabs className="mb-6" tabs={TABS} value={tab} onChange={(t) => set({ tab: t })} />
      {tab !== 'courses' && <RangeBar key={`${range.from}:${range.to}`} range={range} onChange={(r) => set(r)} />}
      {tab === 'overview' && <Overview range={range} />}
      {tab === 'courses' && <CoursesTab />}
      {tab === 'gst' && <GstTab range={range} />}
      {tab === 'exports' && <ExportsTab range={range} />}
    </>
  );
}
