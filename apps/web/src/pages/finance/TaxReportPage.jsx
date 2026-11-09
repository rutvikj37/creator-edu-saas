import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Percent, Receipt, Wallet } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { DateRangeFilter, presetRange } from '../../components/common/DateRangeFilter.jsx';
import { Button, Card, CardHeader, DataTable, EmptyState, ErrorState, StatCard } from '../../components/ui/index.js';
import { financeApi } from '../../services/api/commerce.js';
import { saveBlob } from '../../utils/download.js';
import { formatDate, formatMoney, formatNumber } from '../../utils/format.js';

const KIND_LABELS = { PLAN: 'Plan purchase', RENEWAL: 'Renewal', COMMISSION: 'Commission' };
const sum = (list, key) => (list?.length ? list.map((t) => formatMoney(t[key], t.currency)).join(' · ') : formatMoney(0, 'INR'));
const rateLabel = (r) => (r === null || r === undefined ? 'No GST' : `${r}%`);

/** GST on what the platform invoiced academies (plans, renewals, commission), for filing returns. */
export function TaxReportPage() {
  const [range, setRange] = useState({ preset: 'month', ...presetRange('month') });
  const q = useQuery({ queryKey: ['platform', 'finance', 'tax', range.from, range.to], queryFn: () => financeApi.tax({ from: range.from, to: range.to }), placeholderData: (p) => p });
  const d = q.data;
  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['invoice_number', 'paid_on', 'academy', 'type', 'currency', 'gst_rate', 'taxable_value', 'gst', 'total', 'paid_via'].join(','),
      ...d.invoices.map((i) => [i.number, i.paidAt?.slice(0, 10), i.tenant?.name, KIND_LABELS[i.kind] ?? i.kind, i.currency, i.taxRate ?? '', i.taxable.toFixed(2), i.tax.toFixed(2), i.total.toFixed(2), i.paidVia].map(esc).join(',')),
    ];
    saveBlob(new Blob([lines.join('\n')], { type: 'text/csv' }), `gst-register-${range.from}-to-${range.to}.csv`);
  };
  return (
    <>
      <PageHeader title="Tax reports" description="GST on paid platform invoices — plans, renewals and commission charged to academies." breadcrumbs={[{ label: 'Finance' }, { label: 'Tax reports' }]}
        actions={<><DateRangeFilter value={range} onChange={setRange} /><Button variant="secondary" leftIcon={Download} onClick={exportCsv} disabled={!d?.invoices.length}>Export CSV</Button></>} />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Taxable value" value={d && sum(d.totals, 'taxable')} icon={Wallet} loading={q.isLoading} />
            <StatCard label="GST collected" value={d && sum(d.totals, 'tax')} icon={Percent} loading={q.isLoading} />
            <StatCard label="Invoice total" value={d && sum(d.totals, 'total')} icon={Receipt} loading={q.isLoading} />
            <StatCard label="Paid invoices" value={formatNumber(d?.invoices.length)} icon={FileText} loading={q.isLoading} />
          </div>
          {d?.truncated && <p className="text-sm text-amber-700">Showing the first 5,000 invoices. Narrow the date range for a complete register.</p>}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="By month" />
              <DataTable loading={q.isLoading} rows={(d?.months ?? []).map((m) => ({ ...m, key: `${m.month}${m.currency}` }))} rowKey="key" empty={<EmptyState title="No paid invoices in this period" className="py-8" />}
                columns={[
                  { key: 'month', header: 'Month', cell: (r) => new Date(`${r.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) },
                  { key: 'invoices', header: 'Invoices', align: 'right', cell: (r) => formatNumber(r.invoices) },
                  { key: 'taxable', header: 'Taxable', align: 'right', cell: (r) => formatMoney(r.taxable, r.currency) },
                  { key: 'tax', header: 'GST', align: 'right', cell: (r) => formatMoney(r.tax, r.currency) },
                ]} />
            </Card>
            <Card>
              <CardHeader title="By GST rate and type" />
              <DataTable loading={q.isLoading} rows={[...(d?.rates ?? []).map((r) => ({ ...r, label: rateLabel(r.rate), key: `r${r.rate}${r.currency}` })), ...(d?.kinds ?? []).map((k) => ({ ...k, label: KIND_LABELS[k.kind] ?? k.kind, key: `k${k.kind}${k.currency}` }))]}
                rowKey="key" empty={<EmptyState title="Nothing to show" className="py-8" />}
                columns={[
                  { key: 'label', header: 'Group', cell: (r) => r.label },
                  { key: 'invoices', header: 'Invoices', align: 'right', cell: (r) => formatNumber(r.invoices) },
                  { key: 'taxable', header: 'Taxable', align: 'right', cell: (r) => formatMoney(r.taxable, r.currency) },
                  { key: 'tax', header: 'GST', align: 'right', cell: (r) => formatMoney(r.tax, r.currency) },
                ]} />
            </Card>
          </div>
          <Card>
            <CardHeader title="Invoice register" description="Every paid invoice in the period, newest first." />
            <DataTable loading={q.isLoading} rows={d?.invoices ?? []} empty={<EmptyState icon={FileText} title="No paid invoices in this period" />}
              columns={[
                { key: 'number', header: 'Invoice', cell: (r) => <span className="font-mono text-xs">{r.number ?? '—'}</span> },
                { key: 'paidAt', header: 'Paid', cell: (r) => formatDate(r.paidAt) },
                { key: 'tenant', header: 'Academy', cell: (r) => r.tenant?.name ?? '—' },
                { key: 'kind', header: 'Type', cell: (r) => KIND_LABELS[r.kind] ?? r.kind },
                { key: 'taxRate', header: 'Rate', align: 'right', cell: (r) => rateLabel(r.taxRate) },
                { key: 'taxable', header: 'Taxable', align: 'right', cell: (r) => formatMoney(r.taxable, r.currency) },
                { key: 'tax', header: 'GST', align: 'right', cell: (r) => formatMoney(r.tax, r.currency) },
                { key: 'total', header: 'Total', align: 'right', cell: (r) => formatMoney(r.total, r.currency) },
              ]} />
          </Card>
        </div>
      )}
    </>
  );
}
