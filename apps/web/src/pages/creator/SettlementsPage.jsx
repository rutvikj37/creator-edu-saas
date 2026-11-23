import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BarChart3, Download } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { MetricCard } from '../../components/common/ListToolbar.jsx';
import { presetRange } from '../../components/common/DateRangeFilter.jsx';
import { PERIOD_OPTIONS } from '../../utils/period.js';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Card, DataTable, EmptyState, StatusBadge, toast } from '../../components/ui/index.js';
import { creatorCommerceApi } from '../../services/api/commerce.js';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { saveBlob } from '../../utils/download.js';
import { formatDate, formatMoney } from '../../utils/format.js';

/** Settlements: payouts from the academy's own Razorpay account. */
export function SettlementsPage() {
  const [term, setTerm] = useState('');
  const [period, setPeriod] = useState();
  const q = useDebouncedValue(term.trim(), 300);
  const params = { ...(period ? presetRange(period) : {}), ...(q ? { q } : {}) };
  const s = useQuery({ queryKey: ['creator', 'settlements', params], queryFn: () => creatorCommerceApi.settlements(params), placeholderData: (p) => p, retry: false });
  const csv = useMutation({ mutationFn: () => creatorCommerceApi.settlementsCsv(params).then((b) => saveBlob(b, 'settlements.csv')), onError: (e) => toast.error(e.message) });
  const d = s.data;
  const m = (v) => formatMoney(v ?? 0, d?.currency ?? 'INR');
  return (
    <>
      <PageHeader title="Settlements" count={d?.items?.length} description="Track the status of your earnings." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <MetricCard label="Total earnings" value={m(d?.totals.earnings)} hint="Captured payments minus refunds" loading={s.isLoading} />
        <MetricCard label="Settled amount" value={m(d?.totals.settled)} hint="Paid out to your bank by Razorpay" loading={s.isLoading} />
        <MetricCard label="To be settled" value={m(d?.totals.toBeSettled)} hint="Estimate, after Razorpay fees" loading={s.isLoading} />
      </div>
      {d && !d.connected && <Alert tone="info" className="mb-4">Razorpay pays your earnings directly to your bank. <Link to="/creator/payments" className="font-medium underline">Connect Razorpay</Link> to see your settlements here.</Alert>}
      <Card>
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchInput className="sm:flex-1" value={term} onChange={setTerm} placeholder="Search for UTR or settlement ID" />
            <Button variant="ghost" leftIcon={Download} disabled={!d?.connected} loading={csv.isPending} onClick={() => csv.mutate()}>CSV</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted">Filter by:</span><FilterChip label="Payment date" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} /></div>
        </div>
        {d && <p className="px-4 pt-3 text-sm text-muted">{d.items.length} settlement{d.items.length === 1 ? '' : 's'}</p>}
        <DataTable loading={s.isLoading} error={s.error} onRetry={() => s.refetch()} rows={d?.items ?? []}
          empty={<EmptyState icon={BarChart3} title="No results found" description={d?.connected ? 'Razorpay hasn’t settled any payments in this period yet.' : undefined} />}
          columns={[
            { key: 'date', header: 'Date', cell: (r) => formatDate(r.date, { withTime: true }) },
            { key: 'amount', header: 'Settled amount', cell: (r) => <span className="font-medium tabular-nums">{m(r.amount)}</span> },
            { key: 'id', header: 'Settlement ID', cell: (r) => <span className="font-mono text-xs">{r.id}</span> },
            { key: 'transactions', header: 'No. of transactions', align: 'right', cell: (r) => r.transactions ?? '—' },
            { key: 'utr', header: 'UTR', cell: (r) => <span className="font-mono text-xs">{r.utr ?? '—'}</span> },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status === 'processed' ? 'PAID' : r.status === 'failed' ? 'FAILED' : 'PENDING'} label={r.status === 'processed' ? 'Settled' : r.status === 'failed' ? 'Failed' : 'In progress'} /> },
          ]} />
      </Card>
    </>
  );
}
