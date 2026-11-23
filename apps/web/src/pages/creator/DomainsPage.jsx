import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeftRight, Check, ChevronRight, Cloud, Copy, Globe, RefreshCw, Star, Trash2, X } from 'lucide-react';
import { cn } from '../../utils/cn.js';
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

/** Default domain: the academy's address on the platform domain. Changing it adds a subdomain and makes it primary. */
function DefaultDomain({ domains, onChanged }) {
  const subs = domains.filter((d) => d.type === 'SUBDOMAIN');
  const current = (domains.find((d) => d.isPrimary && d.type === 'SUBDOMAIN') ?? subs.find((d) => d.isDefault) ?? subs[0])?.hostname?.replace(`.${PLATFORM_ROOT}`, '') ?? '';
  const [name, setName] = useState(current);
  useEffect(() => setName(current), [current]);
  const clean = name.trim().toLowerCase();
  const debounced = useDebouncedValue(clean, 350);
  const changed = clean !== current;
  const owned = subs.find((d) => d.hostname === `${clean}.${PLATFORM_ROOT}`);
  const check = useQuery({ queryKey: ['domains', 'availability', debounced], queryFn: () => workspaceApi.subdomainAvailability(debounced), enabled: changed && !owned && debounced.length >= 3, staleTime: 0 });
  const full = subs.length >= MAX_SUBDOMAINS;
  const save = useMutation({
    mutationFn: async () => {
      const d = owned ?? await workspaceApi.addSubdomain(clean);
      await workspaceApi.makePrimary(d.id);
      return d;
    },
    onSuccess: (d) => { toast.success(`${d.hostname} is now your address`); onChanged(); },
    onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });
  const result = changed && !owned && debounced === clean && clean.length >= 3 ? check.data : null;
  const canSave = changed && (owned || (result?.available && !full));
  const primaryIsSub = domains.some((d) => d.isPrimary && d.type === 'SUBDOMAIN');
  return (
    <div className="grid gap-4 border-b border-line pb-8 md:grid-cols-2">
      <div>
        <p className="font-medium text-fg">Default domain</p>
        <p className="mt-1 max-w-md text-sm text-muted">This is the default website address of your academy. You can pick up to {MAX_SUBDOMAINS} addresses on {PLATFORM_ROOT}; older ones keep working.</p>
      </div>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }}>
        <div className="flex items-center overflow-hidden rounded-md border border-line bg-surface focus-within:ring-2 focus-within:ring-primary-500">
          <input aria-label="Subdomain name" className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" value={name} maxLength={40}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
          <span className="border-l border-line bg-surface-2 px-3 py-2.5 text-sm text-muted">.{PLATFORM_ROOT}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {primaryIsSub && !changed && <Badge>Primary domain</Badge>}
          <span className="text-xs text-muted">{subs.length}/{MAX_SUBDOMAINS} used</span>
          {changed && (owned ? <span className="text-xs text-fg-2">You already own this address — save to make it primary.</span>
            : full ? <span className="text-xs text-red-600">You’ve used all {MAX_SUBDOMAINS}. Remove one below to pick another.</span>
            : result ? (result.available ? <span className="flex items-center gap-1 text-xs text-green-700"><Check className="size-3.5" />Available</span> : <span className="flex items-center gap-1 text-xs text-red-600"><X className="size-3.5" />{result.reason}</span>)
            : <span className="text-xs text-muted">3–40 lowercase letters, numbers or hyphens.</span>)}
        </div>
        {changed && <div className="flex gap-2"><Button type="submit" size="sm" disabled={!canSave} loading={save.isPending}>Save</Button><Button size="sm" variant="ghost" onClick={() => setName(current)}>Cancel</Button></div>}
      </form>
    </div>
  );
}

const METHODS = {
  cname: { title: 'CNAME', subtitle: 'Link with the CNAME record from your domain provider', icon: ArrowLeftRight },
  cloudflare: { title: 'Cloudflare', subtitle: 'For domains whose DNS is on Cloudflare', icon: Cloud },
};

export function DomainsPage() {
  const qc = useQueryClient();
  const auth = useAuth();
  const canManage = auth.can('domains.manage');
  const domains = useQuery({ queryKey: ['domains'], queryFn: workspaceApi.domains, enabled: canManage });
  const [addOpen, setAddOpen] = useState(false);
  const [method, setMethod] = useState('cname');
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
    return (<><PageHeader title="Domain management" /><SettingsTabs /><Card><EmptyState title="You don't have access" description="Ask the academy owner for the domains permission." /></Card></>);
  }

  const list = domains.data ?? [];
  return (
    <>
      <PageHeader title="Domain management" description="Connect and customize your website address." /><SettingsTabs />
      <Card className="p-5 sm:p-6">
        {domains.isError ? <ErrorState error={domains.error} onRetry={() => domains.refetch()} /> : domains.isLoading ? <Skeleton className="h-24" /> : <DefaultDomain domains={list} onChanged={invalidate} />}
        <div className="grid gap-4 pt-8 md:grid-cols-2">
          <div>
            <p className="font-medium text-fg">Link your custom domain</p>
            <p className="mt-1 max-w-md text-sm text-muted">Personalize your website address with a domain you own, like learn.yourbrand.com. Don’t have one? Buy it from a registrar such as GoDaddy or Namecheap, then link it here with a CNAME record or through Cloudflare.</p>
          </div>
          <div className="space-y-3">
            {Object.entries(METHODS).map(([key, m]) => (
              <button key={key} type="button" onClick={() => { setMethod(key); setAddOpen(true); }} className="flex w-full items-center gap-3 rounded-xl bg-surface-2/60 p-4 text-left hover:bg-surface-2">
                <span className={cn('grid size-5 place-items-center rounded-full border', method === key && addOpen ? 'border-primary-600' : 'border-line-strong')} aria-hidden />
                <m.icon className={cn('size-5', key === 'cloudflare' ? 'text-orange-500' : 'text-fg-2')} aria-hidden />
                <span className="flex-1"><span className="block font-medium text-fg">{m.title}</span><span className="text-xs text-muted">{m.subtitle}</span></span>
                <ChevronRight className="size-4 text-muted" aria-hidden />
              </button>
            ))}
            <p className="text-xs text-muted">Included domains depend on your plan. Your site is served on it once DNS is verified and the HTTPS certificate is issued.</p>
          </div>
        </div>
      </Card>

      {list.length > 0 && <h2 className="mt-8 mb-3 text-sm font-semibold text-fg-2">Your addresses</h2>}
      <div className="space-y-4">
        {list.map((d) => (
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

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={method === 'cloudflare' ? 'Link a domain on Cloudflare' : 'Link a domain with CNAME'} description="Use a subdomain you control, e.g. learn.yourbrand.com."
        footer={<><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button><Button onClick={onAdd} loading={form.formState.isSubmitting}>Add domain</Button></>}>
        <form onSubmit={onAdd} noValidate className="space-y-4">
          <Input label="Domain" placeholder="learn.yourbrand.com" autoFocus {...form.register('hostname')} error={form.formState.errors.hostname?.message} />
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-fg-2">
            {method === 'cloudflare' ? <>
              <li>Add the domain here. We’ll show a <strong>CNAME</strong> and a <strong>TXT</strong> record.</li>
              <li>In Cloudflare → DNS → Records, add both records exactly as shown.</li>
              <li>Set the CNAME’s proxy status to <strong>DNS only</strong> (grey cloud) so we can verify it and issue its HTTPS certificate.</li>
              <li>Click <strong>Verify</strong>. Once it’s live you may turn the proxy on with SSL/TLS mode <strong>Full (strict)</strong>.</li>
            </> : <>
              <li>Add the domain here. We’ll show a <strong>CNAME</strong> and a <strong>TXT</strong> record.</li>
              <li>In your domain provider’s DNS settings (GoDaddy, Namecheap…), add both records.</li>
              <li>Come back and click <strong>Verify</strong>. DNS changes can take up to 24 hours.</li>
            </>}
          </ol>
        </form>
      </Modal>
      <ConfirmDialog open={Boolean(toRemove)} onClose={() => setToRemove(null)} title={`Remove ${toRemove?.hostname}?`}
        description="Visitors using this domain will no longer reach your academy." confirmLabel="Remove domain"
        loading={remove.isPending} onConfirm={() => remove.mutate(toRemove.id)} />
    </>
  );
}
