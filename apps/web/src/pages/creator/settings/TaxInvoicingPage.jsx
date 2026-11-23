import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { PageHeader } from '../../../components/layout/PageHeader.jsx';
import { SettingsTabs } from '../../../components/layout/SettingsTabs.jsx';
import { Badge, Button, Card, ErrorState, Input, Select, Skeleton, Switch, Textarea, toast } from '../../../components/ui/index.js';
import { academyApi2 as academyApi } from '../../../services/api/creator.js';
import { INDIAN_STATES } from '../../../utils/indianStates.js';
import { cn } from '../../../utils/cn.js';

function Row({ label, hint, children, className, htmlFor }) {
  return (
    <div className={cn('grid gap-3 border-b border-line py-6 last:border-0 md:grid-cols-2', className)}>
      <div>{htmlFor ? <label htmlFor={htmlFor} className="font-medium text-fg">{label}</label> : <p className="font-medium text-fg">{label}</p>}{hint && <p className="mt-1 text-sm text-muted">{hint}</p>}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Settings → Tax and invoicing: GST, place of supply, exports under LUT and invoice series. */
export function TaxInvoicingPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['academy', 'business'], queryFn: academyApi.business });
  const [f, setF] = useState(null);
  const [errors, setErrors] = useState({});
  useEffect(() => { if (q.data) setF({ ...q.data, taxDetails: q.data.taxDetails ?? '', invoiceNote: q.data.invoiceNote ?? '', gstin: q.data.gstin ?? '', taxRate: Number(q.data.taxRate ?? 18) }); }, [q.data]);
  const save = useMutation({
    mutationFn: (body) => academyApi.updateBusiness(body),
    onSuccess: (d) => { setErrors({}); qc.invalidateQueries({ queryKey: ['academy', 'business'] }); qc.invalidateQueries({ queryKey: ['onboarding'] }); toast.success('Saved'); return d; },
    onError: (e) => { if (e.details?.length) setErrors(Object.fromEntries(e.details.map((x) => [x.field, x.message]))); toast.error(e.details?.[0]?.message ?? e.message); },
  });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  if (!f) return <Skeleton className="h-96" />;
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const fy = (q.data.nextInvoiceNumber ?? '').split('/')[1] ?? '';
  const preview = `${(f.invoicePrefix || 'INV').toUpperCase()}/${fy}/${String(Math.max(1, Number(f.invoiceStartNumber) || 1)).padStart(5, '0')}`;
  const startChanged = Number(f.invoiceStartNumber) !== q.data.invoiceStartNumber || f.invoicePrefix !== q.data.invoicePrefix;
  const toggle = (key, v) => { set({ [key]: v }); save.mutate({ [key]: v }); };

  return (
    <>
      <PageHeader title="Tax and invoicing" description="Customize the taxes and invoices issued to your customers." />
      <SettingsTabs />
      <Card className="p-4 sm:p-6">
        <h2 className="rounded-lg bg-surface-2/70 px-4 py-3 font-semibold">Taxes</h2>
        <div className="px-1 sm:px-4">
          <Row label="GST registration" hint="GST is charged at checkout and shown on invoices only when you’re registered.">
            <div className="space-y-4">
              <Switch label="My business is GST registered" checked={Boolean(f.gstRegistered)} onChange={(v) => set({ gstRegistered: v })} />
              {f.gstRegistered && <>
                <Input label="GSTIN" placeholder="22AAAAA0000A1Z5" value={f.gstin} error={errors.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select label="GST rate" value={String(f.taxRate)} onChange={(e) => set({ taxRate: Number(e.target.value) })} options={[0, 5, 12, 18, 28].map((r) => ({ value: String(r), label: `${r}%` }))} />
                  <Select label="Prices" value={f.pricesIncludeTax === false ? 'exclusive' : 'inclusive'} onChange={(e) => set({ pricesIncludeTax: e.target.value === 'inclusive' })} options={[{ value: 'inclusive', label: 'Include GST' }, { value: 'exclusive', label: 'GST added at checkout' }]} />
                </div>
              </>}
              <Button loading={save.isPending} onClick={() => save.mutate({ gstRegistered: f.gstRegistered, ...(f.gstRegistered ? { gstin: f.gstin, taxRate: f.taxRate, pricesIncludeTax: f.pricesIncludeTax } : {}) })}>Save</Button>
            </div>
          </Row>
          <Row label="Your tax details" hint="Printed on every invoice — e.g. SAC code, registered office or LUT number.">
            <Textarea aria-label="Your tax details" rows={4} maxLength={2000} value={f.taxDetails} onChange={(e) => set({ taxDetails: e.target.value })} />
            <Button className="mt-3" disabled={f.taxDetails === (q.data.taxDetails ?? '')} loading={save.isPending} onClick={() => save.mutate({ taxDetails: f.taxDetails })}>Save</Button>
          </Row>
          <Row label="Place of supply" hint="The state your business is registered in.">
            <Select aria-label="Place of supply" placeholder="Select state" value={f.state ?? ''} onChange={(e) => { set({ state: e.target.value }); save.mutate({ state: e.target.value }); }} options={INDIAN_STATES.map((s) => ({ value: s, label: s }))} />
          </Row>
          <Row label="" className="md:[&>div:first-child]:hidden">
            <div className="flex gap-3">
              <Switch id="lut" checked={Boolean(f.exportsUnderLut)} onChange={(v) => toggle('exportsUnderLut', v)} />
              <div>
                <label htmlFor="lut" className="font-medium text-fg">I sell to customers outside India <Badge tone="info" className="ml-1">New</Badge></label>
                <p className="mt-1 text-sm text-muted">By turning this on, you confirm you hold a valid LUT and are eligible for zero-rated exports under GST. Buyers outside India then pay no GST and their invoices show 0% IGST.</p>
                {!f.exportsUnderLut && f.gstRegistered && <p className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="size-3.5" aria-hidden />While this is off, international sales are charged {Number(f.taxRate)}% GST.</p>}
              </div>
            </div>
          </Row>
        </div>

        <h2 className="mt-4 rounded-lg bg-surface-2/70 px-4 py-3 font-semibold">Invoices</h2>
        <div className="px-1 sm:px-4">
          <Row htmlFor="inv-on" label="Generate invoice on purchase" hint="Buyers get a downloadable invoice for every paid order.">
            <Switch id="inv-on" checked={Boolean(f.invoicesEnabled)} onChange={(v) => toggle('invoicesEnabled', v)} />
          </Row>
          <Row label="Serial number" hint="Numbers restart from this serial every financial year, as GST requires.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Prefix" maxLength={12} value={f.invoicePrefix ?? ''} error={errors.invoicePrefix} onChange={(e) => set({ invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} />
              <Input label="Serial no." type="number" min={1} value={f.invoiceStartNumber} error={errors.invoiceStartNumber} onChange={(e) => set({ invoiceStartNumber: e.target.value })} />
            </div>
            <p className="mt-3 rounded-full bg-primary-50 px-3 py-1.5 text-sm text-primary-800 dark:bg-primary-500/10 dark:text-primary-200">
              {startChanged ? `First invoice of a year: ${preview}` : `Next invoice number: ${q.data.nextInvoiceNumber}`}
            </p>
            <Button className="mt-3" disabled={!startChanged} loading={save.isPending} onClick={() => save.mutate({ invoicePrefix: f.invoicePrefix || 'INV', invoiceStartNumber: Number(f.invoiceStartNumber) })}>Save</Button>
          </Row>
          <Row label="Note on invoice" hint="Shown at the bottom of every invoice.">
            <Textarea aria-label="Note on invoice" rows={4} maxLength={2000} value={f.invoiceNote} onChange={(e) => set({ invoiceNote: e.target.value })} />
            <Button className="mt-3" disabled={f.invoiceNote === (q.data.invoiceNote ?? '')} loading={save.isPending} onClick={() => save.mutate({ invoiceNote: f.invoiceNote })}>Save</Button>
          </Row>
          <Row htmlFor="itc" label="Allow learners to claim GST input credit" hint="Shows a GSTIN field at checkout; the buyer’s GSTIN is printed on their invoice.">
            <Switch id="itc" checked={Boolean(f.gstInputCredit)} onChange={(v) => toggle('gstInputCredit', v)} />
          </Row>
        </div>
      </Card>
    </>
  );
}
