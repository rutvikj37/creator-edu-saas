import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LifeBuoy, Plus } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button, Card, CardBody, DataTable, EmptyState, ErrorState, Input, Modal, Select, Skeleton, StatusBadge, Textarea, toast } from '../../components/ui/index.js';
import { creatorApi } from '../../services/api/platform.js';
import { useListParams } from '../../hooks/useListParams.js';
import { applyApiErrors } from '../../utils/forms.js';
import { formatDate } from '../../utils/format.js';
import { TicketThread } from '../support/TicketThread.jsx';

const schema = z.object({
  subject: z.string().trim().min(5, 'At least 5 characters').max(200),
  category: z.enum(['billing', 'technical', 'account', 'content', 'payments', 'other']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  body: z.string().trim().min(10, 'Describe the issue in at least 10 characters').max(10000),
});

export function CreatorSupportPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const [params, update] = useListParams();
  const q = useQuery({ queryKey: ['creator', 'tickets', params], queryFn: () => creatorApi.tickets(params), placeholderData: (p) => p });
  const [open, setOpen] = useState(false);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { subject: '', category: 'technical', priority: 'MEDIUM', body: '' } });
  useEffect(() => {
    const preset = search.get('new');
    if (preset) {
      form.reset({ subject: preset === 'billing' ? 'Plan change request' : '', category: preset === 'billing' ? 'billing' : 'technical', priority: 'MEDIUM', body: '' });
      setOpen(true);
      setSearch((s) => { s.delete('new'); return s; }, { replace: true });
    }
  }, [search, setSearch, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await creatorApi.createTicket(values);
      toast.success('Ticket created', { description: 'Our team will reply by email.' });
      setOpen(false);
      form.reset();
      qc.invalidateQueries({ queryKey: ['creator', 'tickets'] });
    } catch (e) {
      applyApiErrors(e, form.setError, ['subject', 'category', 'priority', 'body']);
    }
  });

  return (
    <>
      <PageHeader title="Support" description="Get help from the platform team." breadcrumbs={[{ label: 'Workspace' }, { label: 'Support' }]} actions={<Button leftIcon={Plus} onClick={() => setOpen(true)}>New ticket</Button>} />
      <Card>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta} onPageChange={(page) => update({ page }, { resetPage: false })}
          empty={<EmptyState icon={LifeBuoy} title="No tickets yet" description="Questions about billing, uploads or your academy? We're here." action={<Button size="sm" onClick={() => setOpen(true)}>Create a ticket</Button>} />}
          columns={[
            { key: 'number', header: '#', cell: (r) => <span className="text-muted">#{r.number}</span> },
            { key: 'subject', header: 'Subject', cell: (r) => <Link to={`/creator/support/${r.id}`} className="font-medium text-primary-600 hover:underline">{r.subject}</Link> },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'lastActivityAt', header: 'Updated', cell: (r) => formatDate(r.lastActivityAt, { withTime: true }) },
          ]} />
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="New support ticket" size="lg"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={form.formState.isSubmitting} onClick={onSubmit}>Submit ticket</Button></>}>
        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Input label="Subject" {...form.register('subject')} error={form.formState.errors.subject?.message} /></div>
          <Select label="Category" {...form.register('category')} options={['billing', 'technical', 'account', 'content', 'payments', 'other'].map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))} />
          <Select label="Priority" {...form.register('priority')} options={[{ value: 'LOW', label: 'Low' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'HIGH', label: 'High' }, { value: 'URGENT', label: 'Urgent' }]} />
          <div className="sm:col-span-2"><Textarea label="Describe the issue" rows={6} {...form.register('body')} error={form.formState.errors.body?.message} /></div>
        </form>
      </Modal>
    </>
  );
}

export function CreatorTicketPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['creator', 'ticket', id], queryFn: () => creatorApi.ticket(id) });
  const [body, setBody] = useState('');
  const reply = useMutation({ mutationFn: () => creatorApi.replyTicket(id, body), onSuccess: (d) => { qc.setQueryData(['creator', 'ticket', id], d); setBody(''); toast.success('Reply sent'); }, onError: (e) => toast.error(e.message) });
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  if (q.isLoading) return <Skeleton className="h-96" />;
  const t = q.data;
  return (
    <>
      <PageHeader title={`#${t.number} ${t.subject}`} description={<span className="inline-flex items-center gap-2">Opened {formatDate(t.createdAt, { withTime: true })} · <StatusBadge status={t.status} /></span>} breadcrumbs={[{ label: 'Support', to: '/creator/support' }, { label: `#${t.number}` }]} />
      <div className="max-w-3xl space-y-6">
        <TicketThread messages={t.messages} />
        <Card>
          <CardBody className="space-y-3">
            <Textarea label={['RESOLVED', 'CLOSED'].includes(t.status) ? 'Reply to reopen this ticket' : 'Reply'} rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="flex justify-end"><Button disabled={!body.trim()} loading={reply.isPending} onClick={() => reply.mutate()}>Send reply</Button></div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
