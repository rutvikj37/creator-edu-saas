import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Input, Modal, Switch, toast } from '../../components/ui/index.js';
import { creatorLearnApi } from '../../services/api/learn.js';
import { formatDate } from '../../utils/format.js';

export function CertificatesAdminPage() {
  const qc = useQueryClient();
  const tpl = useQuery({ queryKey: ['creator', 'cert-template'], queryFn: creatorLearnApi.template });
  const list = useQuery({ queryKey: ['creator', 'certificates'], queryFn: creatorLearnApi.certificates });
  const [form, setForm] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [reason, setReason] = useState('');
  useEffect(() => { if (tpl.data) setForm(tpl.data); }, [tpl.data]);
  const save = useMutation({ mutationFn: () => creatorLearnApi.updateTemplate({ title: form.title, bodyText: form.bodyText, signatoryName: form.signatoryName || null, signatoryRole: form.signatoryRole || null, accentColor: form.accentColor, showQr: form.showQr }), onSuccess: (d) => { qc.setQueryData(['creator', 'cert-template'], d); toast.success('Template saved'); }, onError: (e) => toast.error(e.details?.[0]?.message ?? e.message) });
  const revoke = useMutation({ mutationFn: () => creatorLearnApi.revokeCertificate(revoking.id, reason), onSuccess: () => { toast.success('Certificate revoked'); setRevoking(null); setReason(''); qc.invalidateQueries({ queryKey: ['creator', 'certificates'] }); }, onError: (e) => toast.error(e.message) });
  const reinstate = useMutation({ mutationFn: (id) => creatorLearnApi.reinstateCertificate(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['creator', 'certificates'] }) });
  return (
    <>
      <PageHeader title="Certificates" description="Design your certificate and manage issued certificates." breadcrumbs={[{ label: 'Content' }, { label: 'Certificates' }]} />
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card className="h-fit">
          <CardHeader title="Template" description="Enable certificates per course in Pricing & access." />
          {form && <CardBody className="space-y-4">
            <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Input label="Text before the course name" value={form.bodyText} onChange={(e) => setForm({ ...form, bodyText: e.target.value })} />
            <Input label="Signatory name" value={form.signatoryName ?? ''} onChange={(e) => setForm({ ...form, signatoryName: e.target.value })} />
            <Input label="Signatory role" value={form.signatoryRole ?? ''} onChange={(e) => setForm({ ...form, signatoryRole: e.target.value })} />
            <div className="flex items-end gap-2"><input aria-label="Accent colour" type="color" value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })} className="h-9 w-12 rounded border border-line" /><Input label="Accent colour" value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })} /></div>
            <Switch label="QR code for verification" checked={form.showQr} onChange={(v) => setForm({ ...form, showQr: v })} />
            <div className="rounded-lg border-2 p-4 text-center" style={{ borderColor: form.accentColor }}><p className="text-xs uppercase" style={{ color: form.accentColor }}>Your academy</p><p className="mt-1 font-serif text-lg font-bold">{form.title}</p><p className="text-xs text-muted">This is to certify that</p><p className="font-serif text-base font-bold" style={{ color: form.accentColor }}>Student Name</p><p className="text-xs">{form.bodyText}</p><p className="text-sm font-semibold">Course title</p></div>
            <Button loading={save.isPending} onClick={() => save.mutate()}>Save template</Button>
          </CardBody>}
        </Card>
        <Card>
          <CardHeader title="Issued certificates" />
          <DataTable loading={list.isLoading} error={list.error} rows={list.data ?? []} empty={<EmptyState icon={Award} title="None issued yet" description="Certificates are issued automatically when students complete eligible courses." />}
            columns={[
              { key: 'recipientName', header: 'Student' },
              { key: 'courseTitle', header: 'Course' },
              { key: 'number', header: 'Number', cell: (r) => <a className="text-primary-600 hover:underline" href={`/verify/${r.number}`} target="_blank" rel="noreferrer">{r.number}</a> },
              { key: 'issuedAt', header: 'Issued', cell: (r) => formatDate(r.issuedAt) },
              { key: 'status', header: 'Status', cell: (r) => <Badge tone={r.status === 'ISSUED' ? 'success' : 'danger'}>{r.status.toLowerCase()}</Badge> },
              { key: 'a', header: '', align: 'right', cell: (r) => r.status === 'ISSUED' ? <Button variant="ghost" size="sm" onClick={() => setRevoking(r)}>Revoke</Button> : <Button variant="ghost" size="sm" onClick={() => reinstate.mutate(r.id)}>Reinstate</Button> },
            ]} />
        </Card>
      </div>
      <Modal open={Boolean(revoking)} onClose={() => setRevoking(null)} title="Revoke certificate?" description="The verification page will show it as revoked."
        footer={<><Button variant="secondary" onClick={() => setRevoking(null)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={revoke.isPending} onClick={() => revoke.mutate()}>Revoke</Button></>}>
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );
}
