import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copyright, FileText, MonitorSmartphone, Minus, Play, Plus } from 'lucide-react';
import { PageHeader } from '../../../components/layout/PageHeader.jsx';
import { SettingsTabs } from '../../../components/layout/SettingsTabs.jsx';
import { Card, ErrorState, Skeleton, Switch, toast } from '../../../components/ui/index.js';
import { http } from '../../../services/api/client.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { cn } from '../../../utils/cn.js';

const securityApi = {
  get: () => http.get('/creator/settings/security').then((r) => r.data),
  save: (body) => http.put('/creator/settings/security', body).then((r) => r.data),
};

function Stepper({ label, value, onChange, min, max, unit }) {
  return (
    <div className="inline-flex h-10 items-center rounded-md border border-line" role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)} className="grid h-full w-10 place-items-center text-fg-2 disabled:opacity-40"><Minus className="size-4" /></button>
      <span className="min-w-12 text-center text-sm tabular-nums" aria-live="polite">{value}{unit ? ` ${unit}` : ''}</span>
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)} className="grid h-full w-10 place-items-center text-fg-2 disabled:opacity-40"><Plus className="size-4" /></button>
    </div>
  );
}

function Section({ icon: Icon, title }) {
  return <h2 className="mt-2 flex items-center gap-2 rounded-lg bg-surface-2/70 px-4 py-3 font-semibold first:mt-0"><Icon className="size-4" aria-hidden />{title}</h2>;
}

function Row({ label, hint, children, htmlFor }) {
  return (
    <div className="grid gap-3 border-b border-line px-1 py-5 last:border-0 sm:px-4 md:grid-cols-2">
      <div>{htmlFor ? <label htmlFor={htmlFor} className="font-medium text-fg">{label}</label> : <p className="font-medium text-fg">{label}</p>}{hint && <p className="mt-1 text-sm text-muted">{hint}</p>}</div>
      <div>{children}</div>
    </div>
  );
}

/** Settings → Security: device limit, team 2FA, PDF and video watermarks. */
export function SecurityPage() {
  const qc = useQueryClient();
  const auth = useAuth();
  const q = useQuery({ queryKey: ['settings', 'security'], queryFn: securityApi.get });
  const [s, setS] = useState(null);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: securityApi.save,
    onSuccess: (d) => { qc.setQueryData(['settings', 'security'], d); toast.success('Saved'); },
    onError: (e) => { toast.error(e.details?.[0]?.message ?? e.message); if (q.data) setS(q.data); },
  });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  if (!s) return <Skeleton className="h-96" />;
  const put = (patch) => { setS((x) => ({ ...x, ...patch, pdfWatermark: { ...x.pdfWatermark, ...(patch.pdfWatermark ?? {}) }, videoWatermark: { ...x.videoWatermark, ...(patch.videoWatermark ?? {}) } })); save.mutate(patch); };
  const vw = s.videoWatermark;
  const has2fa = Boolean(auth.user?.twoFactorEnabledAt);

  return (
    <>
      <PageHeader title="Security" description="Secure your content and your team’s accounts." />
      <SettingsTabs />
      <Card className="space-y-2 p-4 sm:p-6">
        <Section icon={MonitorSmartphone} title="Limit usage" />
        <Row label="Device limit for learner login" hint="How many devices a learner can be signed in on at once. Signing in on one more signs them out of their oldest device. 0 means no limit.">
          <Stepper label="Device limit" value={s.deviceLimit} min={0} max={20} onChange={(v) => put({ deviceLimit: v })} />
        </Row>
        <Row htmlFor="team-2fa" label="2-factor authentication for your team" hint={has2fa ? 'Team members must turn on 2FA before they can open this workspace.' : <>Turn on 2FA for your own account first in <Link className="text-primary-600 underline" to="/creator/account/security">Account security</Link>.</>}>
          <Switch id="team-2fa" checked={s.teamTwoFactor} disabled={!has2fa && !s.teamTwoFactor} onChange={(v) => put({ teamTwoFactor: v })} />
        </Row>

        <Section icon={Copyright} title="Watermark content" />
        <Row htmlFor="pdf-wm" label={<span className="inline-flex items-center gap-1.5"><FileText className="size-4" aria-hidden />On PDF files</span>} hint="Stamps the learner’s email and phone on every page of lesson PDFs and PDF downloads. PDFs over 50 MB are served without a watermark.">
          <Switch id="pdf-wm" checked={s.pdfWatermark.enabled} onChange={(v) => put({ pdfWatermark: { enabled: v } })} />
        </Row>
        {s.pdfWatermark.enabled && <>
          <Row htmlFor="wm-color" label="Watermark color">
            <label className="inline-flex h-10 items-center gap-2 rounded-md border border-line px-3">
              <input id="wm-color" type="color" value={s.pdfWatermark.color} onChange={(e) => setS((x) => ({ ...x, pdfWatermark: { ...x.pdfWatermark, color: e.target.value.toUpperCase() } }))} onBlur={(e) => save.mutate({ pdfWatermark: { color: e.target.value.toUpperCase() } })} className="size-6 cursor-pointer border-0 bg-transparent p-0" />
              <span className="font-mono text-sm">{s.pdfWatermark.color}</span>
            </label>
          </Row>
          <Row htmlFor="wm-fixed" label="Fixed position" hint="Also places a unique learner ID in the middle of every page.">
            <Switch id="wm-fixed" checked={s.pdfWatermark.fixedPosition} onChange={(v) => put({ pdfWatermark: { fixedPosition: v } })} />
          </Row>
        </>}
        <div className="px-1 py-5 sm:px-4">
          <p className="flex items-center gap-1.5 font-medium text-fg"><Play className="size-4" aria-hidden />On videos and live classes</p>
          <p className="mt-1 text-sm text-muted">Shows the learner’s email and phone over the player to discourage screen recording.</p>
          <div className="mt-4 space-y-3" role="radiogroup" aria-label="Video watermark">
            {[
              { v: 'off', t: 'Off', d: 'No watermark on videos and live classes.' },
              { v: 'static', t: 'Static watermark', d: 'A faint watermark covers the whole player the entire time.' },
              { v: 'dynamic', t: 'Dynamic watermark', d: 'The watermark appears at random spots and intervals.' },
            ].map((o) => (
              <div key={o.v} className={cn('rounded-xl border p-4', vw.mode === o.v ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-500/5' : 'border-line')}>
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="radio" name="video-wm" className="mt-1" checked={vw.mode === o.v} onChange={() => put({ videoWatermark: { mode: o.v } })} />
                  <span><span className="block font-medium text-fg">{o.t}</span><span className="text-sm text-muted">{o.d}</span></span>
                </label>
                {o.v === 'dynamic' && vw.mode === 'dynamic' && (
                  <div className="mt-4 space-y-3 pl-7">
                    <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm">Display watermark for</span><Stepper label="Display for seconds" unit="sec" value={vw.showForSec} min={1} max={600} onChange={(v) => put({ videoWatermark: { showForSec: v } })} /></div>
                    <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm">Display watermark after every</span><Stepper label="Every seconds" unit="sec" value={vw.everySec} min={1} max={3600} onChange={(v) => put({ videoWatermark: { everySec: v } })} /></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}
