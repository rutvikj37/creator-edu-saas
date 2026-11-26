import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award } from 'lucide-react';
import { CERTIFICATE_DESIGNS, CERTIFICATE_DESIGN_KEYS, resolveCertificateDesign } from '@ce/shared';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Input, Modal, Switch, Tabs, toast } from '../../components/ui/index.js';
import { ListToolbar } from '../../components/common/ListToolbar.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { creatorLearnApi } from '../../services/api/learn.js';
import { formatDate } from '../../utils/format.js';
import { CertificatePreview, DesignThumb } from './certificate-designs.jsx';

export function CertificatesAdminPage() {
  const qc = useQueryClient();
  const tpl = useQuery({ queryKey: ['creator', 'cert-template'], queryFn: creatorLearnApi.template });
  const list = useQuery({ queryKey: ['creator', 'certificates'], queryFn: creatorLearnApi.certificates });
  const [form, setForm] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [reason, setReason] = useState('');
  const [tab, setTab] = useState('issued');
  const [search, setSearch] = useState('');
  const [courseF, setCourseF] = useState();
  const [statusF, setStatusF] = useState();
  useEffect(() => { if (tpl.data) setForm({ ...tpl.data, designKey: resolveCertificateDesign(tpl.data.designKey).key }); }, [tpl.data]);

  const pickDesign = (key) => {
    const d = resolveCertificateDesign(key);
    setForm((f) => ({
      ...f,
      designKey: d.key,
      accentColor: d.suggestedAccent,
      title: !f.title || CERTIFICATE_DESIGN_KEYS.some((k) => CERTIFICATE_DESIGNS[k].suggestedTitle === f.title)
        ? d.suggestedTitle
        : f.title,
    }));
  };

  const save = useMutation({
    mutationFn: () => creatorLearnApi.updateTemplate({
      designKey: form.designKey,
      title: form.title,
      bodyText: form.bodyText,
      signatoryName: form.signatoryName || null,
      signatoryRole: form.signatoryRole || null,
      accentColor: form.accentColor,
      showQr: form.showQr,
    }),
    onSuccess: (d) => { qc.setQueryData(['creator', 'cert-template'], d); toast.success('Template saved'); },
    onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });
  const revoke = useMutation({ mutationFn: () => creatorLearnApi.revokeCertificate(revoking.id, reason), onSuccess: () => { toast.success('Certificate revoked'); setRevoking(null); setReason(''); qc.invalidateQueries({ queryKey: ['creator', 'certificates'] }); }, onError: (e) => toast.error(e.message) });
  const reinstate = useMutation({ mutationFn: (id) => creatorLearnApi.reinstateCertificate(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['creator', 'certificates'] }) });
  const all = list.data ?? [];
  const term = search.trim().toLowerCase();
  const rows = all.filter((r) => (!term || `${r.recipientName} ${r.number}`.toLowerCase().includes(term)) && (!courseF || r.courseTitle === courseF) && (!statusF || r.status === statusF));
  return (
    <>
      <PageHeader title="Certificates" count={list.data ? all.length : undefined} description="Design your certificate and manage the ones you’ve issued." breadcrumbs={[{ label: 'Certificates' }]} />
      <Tabs className="mb-6" value={tab} onChange={setTab} tabs={[{ value: 'issued', label: 'Issued certificates', count: list.data ? all.length : undefined }, { value: 'template', label: 'Template' }]} />
      {tab === 'template' ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardHeader title="Template" description="Pick a design, then customise the wording. Enable certificates per course in Pricing & access." />
            {form && (
              <CardBody className="space-y-6">
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-fg">Design</legend>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {CERTIFICATE_DESIGN_KEYS.map((key) => {
                      const d = CERTIFICATE_DESIGNS[key];
                      return (
                        <DesignThumb
                          key={key}
                          designKey={key}
                          accent={form.designKey === key ? form.accentColor : d.suggestedAccent}
                          name={d.name}
                          description={d.description}
                          selected={form.designKey === key}
                          onSelect={() => pickDesign(key)}
                        />
                      );
                    })}
                  </div>
                </fieldset>
                <div className="space-y-4 border-t border-line pt-4">
                  <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                  <Input label="Text before the course name" value={form.bodyText} onChange={(e) => setForm({ ...form, bodyText: e.target.value })} />
                  <Input label="Signatory name" value={form.signatoryName ?? ''} onChange={(e) => setForm({ ...form, signatoryName: e.target.value })} />
                  <Input label="Signatory role" value={form.signatoryRole ?? ''} onChange={(e) => setForm({ ...form, signatoryRole: e.target.value })} />
                  <div className="flex items-end gap-2">
                    <input aria-label="Accent colour" type="color" value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })} className="h-9 w-12 rounded border border-line" />
                    <Input label="Accent colour" value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })} />
                  </div>
                  <Switch label="QR code for verification" checked={form.showQr} onChange={(v) => setForm({ ...form, showQr: v })} />
                  <Button loading={save.isPending} onClick={() => save.mutate()}>Save template</Button>
                </div>
              </CardBody>
            )}
          </Card>
          {form && (
            <Card className="h-fit xl:sticky xl:top-20">
              <CardHeader title="Preview" description={`${resolveCertificateDesign(form.designKey).name} design`} />
              <CardBody>
                <CertificatePreview form={form} />
                {form.showQr ? <p className="mt-2 text-center text-[10px] text-muted">QR code appears on the downloaded PDF</p> : null}
              </CardBody>
            </Card>
          )}
        </div>
      ) : (
        <Card>
          <ListToolbar search={search} onSearch={setSearch} placeholder="Search by student or certificate number" count={rows.length} noun="certificate"
            filtered={Boolean(term || courseF || statusF)} onReset={() => { setSearch(''); setCourseF(undefined); setStatusF(undefined); }}
            filters={<>
              <FilterChip label="Course" value={courseF} onChange={setCourseF} options={[...new Set(all.map((r) => r.courseTitle))].map((t) => ({ value: t, label: t }))} panelClassName="w-72" />
              <FilterChip label="Status" value={statusF} onChange={setStatusF} options={[{ value: 'ISSUED', label: 'Issued' }, { value: 'REVOKED', label: 'Revoked' }]} />
            </>} />
          <DataTable loading={list.isLoading} error={list.error} rows={rows} empty={all.length ? <EmptyState icon={Award} title="No certificates match" description="Try a different search or clear the filters." /> : <EmptyState icon={Award} title="None issued yet" description="Certificates are issued automatically when students complete eligible courses." />}
            columns={[
              { key: 'recipientName', header: 'Student', cell: (r) => <div className="flex items-center gap-2.5"><Avatar name={r.recipientName} size="sm" /><span className="font-medium text-fg">{r.recipientName}</span></div> },
              { key: 'courseTitle', header: 'Course' },
              { key: 'number', header: 'Number', cell: (r) => <a className="text-primary-600 hover:underline" href={`/verify/${r.number}`} target="_blank" rel="noreferrer">{r.number}</a> },
              { key: 'issuedAt', header: 'Issued', cell: (r) => formatDate(r.issuedAt) },
              { key: 'status', header: 'Status', cell: (r) => <Badge tone={r.status === 'ISSUED' ? 'success' : 'danger'}>{r.status.toLowerCase()}</Badge> },
              { key: 'a', header: '', align: 'right', cell: (r) => r.status === 'ISSUED' ? <Button variant="ghost" size="sm" onClick={() => setRevoking(r)}>Revoke</Button> : <Button variant="ghost" size="sm" onClick={() => reinstate.mutate(r.id)}>Reinstate</Button> },
            ]} />
        </Card>
      )}
      <Modal open={Boolean(revoking)} onClose={() => setRevoking(null)} title="Revoke certificate?" description="The verification page will show it as revoked."
        footer={<><Button variant="secondary" onClick={() => setRevoking(null)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={revoke.isPending} onClick={() => revoke.mutate()}>Revoke</Button></>}>
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );
}
