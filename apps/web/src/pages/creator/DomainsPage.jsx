import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AtSign, Check, Copy, Globe, Link2, Plus, RefreshCw, Star, Trash2, X } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SettingsTabs } from '../../components/layout/SettingsTabs.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, ErrorState, Input, Modal, Skeleton, StatusBadge, toast } from '../../components/ui/index.js';
import { workspaceApi } from '../../services/api/auth.js';
import { applyApiErrors } from '../../utils/forms.js';
import { formatDate } from '../../utils/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { PLATFORM_ROOT } from '../../utils/host.js';

const schema = z.object({
  hostname: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?=.{4,253}$)(?!-)(?:[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/, 'Enter a valid domain, e.g. learn.example.com'),
});

function DnsRecords({ records }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-xs">
        <thead className="bg-surface-2 text-muted"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Value</th><th /></tr></thead>
        <tbody className="divide-y divide-line">
          {records.map((r) => (
            <tr key={r.type}>
              <td className="px-3 py-2 font-medium">{r.type}</td>
              <td className="px-3 py-2 font-mono">{r.name}</td>
              <td className="px-3 py-2 font-mono break-all">{r.value}</td>
              <td className="px-2 py-1 text-right">
                <Button variant="ghost" size="icon-sm" aria-label={`Copy ${r.type} value`} onClick={() => navigator.clipboard?.writeText(r.value).then(() => toast.success('Copied'))}>
                  <Copy className="size-3.5" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MAX_SUBDOMAINS = 3;

/** Option 1: a branded subdomain on the platform domain — live instantly, no DNS needed. */
function SubdomainOption({ count, onAdded }) {
  const [name, setName] = useState('');
  const clean = name.trim().toLowerCase();
  const debounced = useDebouncedValue(clean, 350);
  const check = useQuery({ queryKey: ['domains', 'availability', debounced], queryFn: () => workspaceApi.subdomainAvailability(debounced), enabled: debounced.length >= 3, staleTime: 0 });
  const full = count >= MAX_SUBDOMAINS;
  const add = useMutation({
    mutationFn: () => workspaceApi.addSubdomain(clean),
    onSuccess: (d) => { toast.success(`${d.hostname} is live`); setName(''); onAdded(); },
    onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });
  const result = debounced === clean && clean.length >= 3 ? check.data : null;
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><AtSign className="size-4" />Free {PLATFORM_ROOT} subdomain</span>} description="Pick a branded address. It works straight away with HTTPS — nothing to set up." actions={<Badge>{count}/{MAX_SUBDOMAINS}</Badge>} />
      <CardBody className="space-y-3">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (result?.available) add.mutate(); }}>
          <div className="flex flex-1 items-center overflow-hidden rounded-md border border-line bg-surface focus-within:ring-2 focus-within:ring-primary-500">
            <input aria-label="Subdomain name" className="h-9 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" placeholder="yourbrand" value={name} disabled={full}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={40} />
            <span className="border-l border-line bg-surface-2 px-3 py-2 text-sm text-muted">.{PLATFORM_ROOT}</span>
          </div>
          <Button type="submit" leftIcon={Plus} disabled={!result?.available || full} loading={add.isPending}>Add subdomain</Button>
        </form>
        {full ? <p className="text-xs text-muted">You've used all {MAX_SUBDOMAINS} subdomains. Remove one to pick another name.</p>
          : result ? (result.available
            ? <p className="flex items-center gap-1 text-xs text-green-700"><Check className="size-3.5" />{result.hostname} is available</p>
            : <p className="flex items-center gap-1 text-xs text-red-600"><X className="size-3.5" />{result.reason}</p>)
          : <p className="text-xs text-muted">3–40 lowercase letters, numbers or hyphens.</p>}
      </CardBody>
    </Card>
  );
}

export function DomainsPage() {
  const qc = useQueryClient();
  const auth = useAuth();
  const canManage = auth.can('domains.manage');
  const domains = useQuery({ queryKey: ['domains'], queryFn: workspaceApi.domains, enabled: canManage });
  const [addOpen, setAddOpen] = useState(false);
  const [toRemove, setToRemove] = useState(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['domains'] });

  const form = useForm({ resolver: zodResolver(schema), defaultValues: { hostname: '' } });
  const onAdd = form.handleSubmit(async ({ hostname }) => {
    try {
      await workspaceApi.addDomain(hostname);
      toast.success('Domain added', { description: 'Add the DNS records shown, then verify.' });
      form.reset();
      setAddOpen(false);
      invalidate();
    } catch (e) {
      if (e.code === 'CONFLICT') form.setError('hostname', { message: e.message });
      else if (e.code === 'PLAN_LIMIT_REACHED' || e.code === 'FEATURE_NOT_IN_PLAN' || e.code === 'NO_ACTIVE_PLAN') form.setError('hostname', { message: 'Your current plan doesn’t include another own domain. Upgrade in Billing, or use a free subdomain instead.' });
      else applyApiErrors(e, form.setError, ['hostname']);
    }
  });

  const verify = useMutation({
    mutationFn: workspaceApi.verifyDomain,
    onSuccess: (d) => {
      if (d.status === 'VERIFIED') toast.success(`${d.hostname} is verified`);
      else toast.error('Not verified yet', { description: d.lastCheckError ?? 'DNS changes can take up to 24 hours.' });
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const primary = useMutation({ mutationFn: workspaceApi.makePrimary, onSuccess: () => { toast.success('Primary domain updated'); invalidate(); }, onError: (e) => toast.error(e.message) });
  const remove = useMutation({
    mutationFn: workspaceApi.removeDomain,
    onSuccess: () => { toast.success('Domain removed'); setToRemove(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  if (!canManage) {
    return (<><PageHeader title="Domains" breadcrumbs={[{ label: 'Domains' }]} /><SettingsTabs /><Card><EmptyState title="You don't have access" description="Ask the academy owner for the domains permission." /></Card></>);
  }

  return (
    <>
      <PageHeader title="Domains" description="Choose how students reach your academy: a free branded subdomain, your own domain, or both." breadcrumbs={[{ label: 'Domains' }]} /><SettingsTabs />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <SubdomainOption count={(domains.data ?? []).filter((d) => d.type === 'SUBDOMAIN').length} onAdded={invalidate} />
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Link2 className="size-4" />Your own domain</span>} description="Use a domain you own, like learn.yourbrand.com. You'll add two DNS records, then verify." />
          <CardBody className="space-y-3">
            <Button leftIcon={Plus} onClick={() => setAddOpen(true)}>Connect your domain</Button>
            <p className="text-xs text-muted">Included domains depend on your plan. Visitors are served on it once DNS is verified and its HTTPS certificate is issued.</p>
          </CardBody>
        </Card>
      </div>
      <h2 className="mb-3 text-sm font-semibold text-fg-2">Your addresses</h2>
      {domains.isError ? (
        <Card><ErrorState error={domains.error} onRetry={() => domains.refetch()} /></Card>
      ) : domains.isLoading ? (
        <Card className="p-5"><Skeleton className="h-16 w-full" /></Card>
      ) : (
        <div className="space-y-4">
          {domains.data.map((d) => (
            <Card key={d.id} className="p-5">
              <div className="flex flex-wrap items-start gap-4">
                <Globe className="mt-0.5 size-5 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold break-all">
                    {d.hostname}
                    {d.isPrimary && <Badge tone="primary">Primary</Badge>}
                    <Badge>{d.type === 'SUBDOMAIN' ? (d.isDefault ? 'Original subdomain' : 'Subdomain') : 'Own domain'}</Badge>
                    <StatusBadge status={d.status} />
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Added {formatDate(d.createdAt)}
                    {d.lastCheckedAt && ` · Last checked ${formatDate(d.lastCheckedAt, { withTime: true })}`}
                  </p>
                  {d.lastCheckError && d.status !== 'VERIFIED' && <p className="mt-1 text-xs text-red-600">{d.lastCheckError}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {d.type === 'CUSTOM' && d.status !== 'VERIFIED' && (
                    <Button variant="secondary" size="sm" leftIcon={RefreshCw} loading={verify.isPending && verify.variables === d.id} onClick={() => verify.mutate(d.id)}>Verify</Button>
                  )}
                  {d.status === 'VERIFIED' && !d.isPrimary && (
                    <Button variant="secondary" size="sm" leftIcon={Star} loading={primary.isPending && primary.variables === d.id} onClick={() => primary.mutate(d.id)}>Make primary</Button>
                  )}
                  {!d.isDefault && (
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${d.hostname}`} onClick={() => setToRemove(d)}><Trash2 className="size-4" /></Button>
                  )}
                </div>
              </div>
              {d.type === 'CUSTOM' && d.status !== 'VERIFIED' && <DnsRecords records={d.dnsInstructions} />}
            </Card>
          ))}
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Connect a custom domain" description="Use a subdomain you control, e.g. learn.yourbrand.com."
        footer={<><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button><Button onClick={onAdd} loading={form.formState.isSubmitting}>Add domain</Button></>}>
        <form onSubmit={onAdd} noValidate>
          <Input label="Domain" placeholder="learn.yourbrand.com" autoFocus {...form.register('hostname')} error={form.formState.errors.hostname?.message} />
        </form>
      </Modal>
      <ConfirmDialog open={Boolean(toRemove)} onClose={() => setToRemove(null)} title={`Remove ${toRemove?.hostname}?`}
        description="Visitors using this domain will no longer reach your academy." confirmLabel="Remove domain"
        loading={remove.isPending} onConfirm={() => remove.mutate(toRemove.id)} />
    </>
  );
}
