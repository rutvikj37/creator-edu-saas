import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Copy, CreditCard, ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SettingsTabs } from '../../components/layout/SettingsTabs.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, Input, Skeleton, Switch, toast } from '../../components/ui/index.js';
import { creatorCommerceApi } from '../../services/api/commerce.js';
import { applyApiErrors } from '../../utils/forms.js';
import { formatDate } from '../../utils/format.js';

const schema = (configured) =>
  z.object({
    keyId: z.string().trim().regex(/^rzp_(test|live)_[A-Za-z0-9]{8,32}$/, 'Starts with rzp_test_ or rzp_live_'),
    keySecret: configured ? z.string().trim().max(128).optional().or(z.literal('')) : z.string().trim().min(8, 'Enter the key secret').max(128),
    webhookSecret: z.string().trim().max(128).optional().or(z.literal('')),
  });

const STATUS = {
  VERIFIED: { tone: 'success', label: 'Connected' },
  CONFIGURED: { tone: 'warning', label: 'Not verified' },
  ERROR: { tone: 'danger', label: 'Check failed' },
};

function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast.success('Copied'));
}

function ConnectForm({ gateway, onSaved }) {
  const configured = gateway.configured;
  const form = useForm({ resolver: zodResolver(schema(configured)), defaultValues: { keyId: gateway.keyId ?? '', keySecret: '', webhookSecret: '' } });
  const submit = form.handleSubmit(async (v) => {
    try {
      const body = { keyId: v.keyId, ...(v.keySecret ? { keySecret: v.keySecret } : {}), ...(v.webhookSecret ? { webhookSecret: v.webhookSecret } : {}) };
      const out = await creatorCommerceApi.saveGateway(body);
      form.reset({ keyId: out.keyId, keySecret: '', webhookSecret: '' });
      if (out.status === 'VERIFIED') toast.success('Razorpay connected');
      else toast.error(out.lastError ?? 'Razorpay did not accept these keys');
      onSaved(out);
    } catch (e) {
      applyApiErrors(e, form.setError, ['keyId', 'keySecret', 'webhookSecret']);
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Input label="Key ID" placeholder="rzp_test_…" autoComplete="off" spellCheck={false} {...form.register('keyId')} error={form.formState.errors.keyId?.message} required />
      <Input label="Key secret" type="password" autoComplete="new-password" placeholder={configured ? 'Stored securely — leave blank to keep' : ''} {...form.register('keySecret')} error={form.formState.errors.keySecret?.message} required={!configured} />
      <Input label="Webhook secret" type="password" autoComplete="new-password" hint="The secret you choose when adding the webhook in Razorpay (step 2)." placeholder={gateway.hasWebhookSecret ? 'Stored securely — leave blank to keep' : ''} {...form.register('webhookSecret')} error={form.formState.errors.webhookSecret?.message} />
      <div className="flex items-center gap-3">
        <Button type="submit" loading={form.formState.isSubmitting}>{configured ? 'Save and verify' : 'Connect Razorpay'}</Button>
        <a className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline" href="https://dashboard.razorpay.com/app/website-app-settings/api-keys" target="_blank" rel="noreferrer noopener">Get API keys <ExternalLink className="size-3.5" /></a>
      </div>
    </form>
  );
}

export function PaymentsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['creator', 'gateway'], queryFn: creatorCommerceApi.gateway });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const set = (data) => qc.setQueryData(['creator', 'gateway'], data);
  const verify = useMutation({ mutationFn: creatorCommerceApi.verifyGateway, onSuccess: (d) => { set(d); d.status === 'VERIFIED' ? toast.success('Keys verified') : toast.error(d.lastError); }, onError: (e) => toast.error(e.message) });
  const toggle = useMutation({ mutationFn: creatorCommerceApi.setGatewayActive, onSuccess: (d) => { set(d); toast.success(d.isActive ? 'Payments resumed' : 'Payments paused'); }, onError: (e) => toast.error(e.message) });
  const remove = useMutation({ mutationFn: creatorCommerceApi.removeGateway, onSuccess: () => { setConfirmRemove(false); qc.invalidateQueries({ queryKey: ['creator', 'gateway'] }); toast.success('Razorpay disconnected'); }, onError: (e) => { setConfirmRemove(false); toast.error(e.message); } });

  const g = q.data;
  const status = g?.configured ? STATUS[g.status] : null;
  return (
    <>
      <PageHeader title="Payments" description="Sell courses with your own Razorpay account. Money settles directly to your bank account." breadcrumbs={[{ label: 'Payments' }]} /><SettingsTabs />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : !g ? <Skeleton className="h-80" /> : (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <Card>
              <CardHeader
                title={<span className="flex items-center gap-2"><CreditCard className="size-4" />1. Razorpay API keys</span>}
                description="Create keys in the Razorpay Dashboard → Account & Settings → API Keys. Use test keys first."
                actions={status && <Badge tone={status.tone}>{status.label}</Badge>}
              />
              <CardBody className="space-y-4">
                {g.configured && g.status === 'ERROR' && (g.lastError === 'Razorpay rejected these keys'
                  ? <Alert tone="error" title="Razorpay rejected these keys">Check that the key id and secret belong together and come from the same mode (test or live).</Alert>
                  : <Alert tone="error" title="Couldn't verify with Razorpay">{g.lastError}. Your keys are saved — use “Re-check keys” to try again.</Alert>)}
                {g.configured && g.mode === 'TEST' && g.status === 'VERIFIED' && <Alert tone="warning" title="Test mode">Buyers can only pay with Razorpay test cards and UPI. Switch to live keys when you are ready to sell.</Alert>}
                <ConnectForm key={g.updatedAt ?? 'new'} gateway={g} onSaved={set} />
              </CardBody>
            </Card>
            {g.configured && (
              <Card>
                <CardHeader title="2. Webhook" description="Lets Razorpay tell us about payments even if the buyer closes the page. Strongly recommended." />
                <CardBody className="space-y-4 text-sm">
                  <ol className="list-decimal space-y-2 pl-5 text-fg-2">
                    <li>In Razorpay, open <span className="font-medium">Account & Settings → Webhooks → Add new webhook</span>.</li>
                    <li>Paste this URL:
                      <div className="mt-2 flex items-center gap-2 rounded-md border border-line bg-surface-2 p-2"><code className="flex-1 break-all text-xs">{g.webhookUrl}</code><Button variant="ghost" size="icon-sm" aria-label="Copy webhook URL" onClick={() => copy(g.webhookUrl)}><Copy className="size-3.5" /></Button></div>
                    </li>
                    <li>Choose a secret, select the events <span className="font-mono text-xs">{g.webhookEvents.join(', ')}</span>, and save.</li>
                    <li>Enter the same secret above as the webhook secret.</li>
                  </ol>
                  {g.hasWebhookSecret ? <p className="flex items-center gap-1.5 text-green-700"><CheckCircle2 className="size-4" />Webhook secret saved.</p> : <Alert tone="warning">No webhook secret yet — payments still work, but rely on the buyer's browser and our 5-minute reconciliation.</Alert>}
                </CardBody>
              </Card>
            )}
          </div>
          <div className="space-y-6">
            <Card>
              <CardHeader title="Status" />
              <CardBody className="space-y-4 text-sm">
                {!g.configured ? <p className="text-muted">Not connected. Paid courses show “Online checkout opens once this academy enables payments.”</p> : (
                  <>
                    <dl className="grid grid-cols-2 gap-y-2">
                      <dt className="text-muted">Mode</dt><dd>{g.mode === 'LIVE' ? 'Live' : 'Test'}</dd>
                      <dt className="text-muted">Key ID</dt><dd className="truncate font-mono text-xs">{g.keyId}</dd>
                      <dt className="text-muted">Last verified</dt><dd>{formatDate(g.lastVerifiedAt, { withTime: true })}</dd>
                    </dl>
                    <Switch label="Accept payments" checked={g.isActive} disabled={toggle.isPending} onChange={(v) => toggle.mutate(v)} />
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" leftIcon={RefreshCw} loading={verify.isPending} onClick={() => verify.mutate()}>Re-check keys</Button>
                      <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setConfirmRemove(true)}>Disconnect</Button>
                    </div>
                  </>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-2 text-sm text-fg-2">
                <p className="flex items-center gap-2 font-medium text-fg"><ShieldAlert className="size-4" />How payments work</p>
                <p>Buyers pay in Razorpay's secure checkout. We confirm every payment directly with Razorpay before giving access.</p>
                <p>GST on sales follows your <Link className="text-primary-600 underline" to="/creator/academy?tab=business">business settings</Link>. Your plan's platform commission is recorded per sale.</p>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
      <ConfirmDialog open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Disconnect Razorpay?" description="Paid courses stop accepting new purchases. Accounts with past payments can only be paused, so refunds keep working." confirmLabel="Disconnect" loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </>
  );
}
