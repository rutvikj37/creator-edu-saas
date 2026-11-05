import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowDown, ArrowUp, Package, Plus, Trash2, Users } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button, Card, DataTable, EmptyState, Input, Modal, StatusBadge, Textarea, toast } from '../../components/ui/index.js';
import { FileUpload } from '../../components/forms/FileUpload.jsx';
import { productsApi } from '../../services/api/commerce.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { applyApiErrors } from '../../utils/forms.js';
import { formatDate, formatMoney } from '../../utils/format.js';

const optNum = z.union([z.literal(''), z.coerce.number()]).transform((v) => (v === '' ? null : v));
const schema = z.object({
  title: z.string().trim().min(1, 'Give it a name').max(200),
  description: z.string().max(5000).optional(),
  priceAmount: z.coerce.number({ message: 'Enter a price (0 for free)' }).min(0, 'Enter a price (0 for free)'),
  compareAtAmount: optNum,
  downloadLimit: optNum.refine((v) => v === null || (Number.isInteger(v) && v >= 1), 'Whole number, at least 1'),
});
const size = (b) => (b == null ? '' : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function ProductForm({ product, onDone }) {
  const [cover, setCover] = useState(product?.coverFileId ? { id: product.coverFileId, url: product.coverUrl } : null);
  const [files, setFiles] = useState(product?.files.map((f) => ({ id: f.id, title: f.title, fileName: f.fileName, sizeBytes: f.sizeBytes })) ?? []);
  const [fileError, setFileError] = useState(null);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { title: product?.title ?? '', description: product?.description ?? '', priceAmount: product ? Number(product.priceAmount) : '', compareAtAmount: product?.compareAtAmount ? Number(product.compareAtAmount) : '', downloadLimit: product?.downloadLimit ?? '' } });
  const { register, formState: { errors, isSubmitting } } = form;
  const move = (i, d) => { const n = [...files]; [n[i], n[i + d]] = [n[i + d], n[i]]; setFiles(n); };
  const submit = form.handleSubmit(async (v) => {
    setFileError(null);
    const body = { ...v, description: v.description || null, coverFileId: cover?.id ?? null, files: files.map((f) => (f.id ? { id: f.id, title: f.title } : { fileAssetId: f.fileAssetId, title: f.title })) };
    try {
      if (product) await productsApi.update(product.id, body);
      else await productsApi.create(body);
      toast.success(product ? 'Product saved' : 'Product created — publish it when you are ready');
      onDone();
    } catch (e) {
      const fe = e.details?.find((x) => x.field === 'files');
      if (fe) setFileError(fe.message);
      applyApiErrors(e, form.setError, ['title', 'description', 'priceAmount', 'compareAtAmount', 'downloadLimit']);
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Input label="Name" {...register('title')} error={errors.title?.message} required />
      <Textarea label="Description" rows={4} {...register('description')} hint="What is inside, who it is for." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Price" type="number" min={0} step="0.01" {...register('priceAmount')} error={errors.priceAmount?.message} hint="0 = free download" required />
        <Input label="Compare-at price" type="number" min={0} step="0.01" placeholder="Optional" {...register('compareAtAmount')} error={errors.compareAtAmount?.message} />
        <Input label="Downloads per file" type="number" min={1} placeholder="Unlimited" {...register('downloadLimit')} error={errors.downloadLimit?.message} />
      </div>
      <FileUpload purpose="IMAGE" accept="image/png,image/jpeg,image/webp" label="Cover image (optional)" value={cover} onUploaded={(f) => setCover({ id: f.id, url: f.url })} onClear={() => setCover(null)} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Files</legend>
        {files.map((f, i) => (
          <div key={f.id ?? f.fileAssetId} className="flex items-center gap-2 rounded-md border border-line p-2">
            <Input aria-label={`File ${i + 1} name`} value={f.title} onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <span className="hidden shrink-0 text-xs text-muted sm:block">{f.fileName} {size(f.sizeBytes)}</span>
            <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === files.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Remove ${f.title}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
        <FileUpload key={files.length} purpose="PRODUCT_FILE" accept=".pdf,.epub,.zip,.docx,.xlsx,.pptx,.txt,.csv,.png,.jpg,.jpeg,.webp,.mp3,.m4a,.wav" label="Add a file" preview="file" hint="PDF, EPUB, ZIP, Office files, images or audio — up to 2 GB"
          value={null} onUploaded={(f) => setFiles([...files, { fileAssetId: f.id, title: (f.fileName ?? 'File').replace(/\.[^.]+$/, ''), fileName: f.fileName, sizeBytes: f.sizeBytes }])} onClear={() => {}} />
        {fileError && <p className="text-xs text-red-600">{fileError}</p>}
      </fieldset>
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{product ? 'Save' : 'Create product'}</Button>
      </div>
    </form>
  );
}

function Buyers({ product, onClose }) {
  const q = useQuery({ queryKey: ['creator', 'products', product.id, 'buyers'], queryFn: () => productsApi.buyers(product.id) });
  return (
    <Modal open onClose={onClose} title={`Buyers — ${product.title}`} size="lg">
      {!q.data ? <p className="text-sm text-muted">Loading…</p> : q.data.length === 0 ? <p className="text-sm text-muted">No buyers yet.</p> : (
        <ul className="divide-y divide-line text-sm">
          {q.data.map((b) => <li key={b.userId} className="flex justify-between gap-3 py-2"><span>{b.name} <span className="text-muted">{b.email}</span></span><span className="text-muted">{b.source === 'FREE' ? 'Free' : 'Bought'} {formatDate(b.since)} · {b.downloads} downloads{b.active ? '' : ' · revoked'}</span></li>)}
        </ul>
      )}
    </Modal>
  );
}

export function ProductsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can('courses.manage');
  const [editing, setEditing] = useState(null);
  const [buyersOf, setBuyersOf] = useState(null);
  const q = useQuery({ queryKey: ['creator', 'products'], queryFn: productsApi.list });
  const done = () => { setEditing(null); qc.invalidateQueries({ queryKey: ['creator', 'products'] }); };
  const status = useMutation({
    mutationFn: ({ id, s }) => productsApi.setStatus(id, s),
    onSuccess: (p) => { toast.success({ PUBLISHED: 'Product published', DRAFT: 'Product unpublished', ARCHIVED: 'Product archived' }[p.status]); qc.invalidateQueries({ queryKey: ['creator', 'products'] }); },
    onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });
  return (
    <>
      <PageHeader title="Digital products" description="Sell e-books, PDFs, templates and other downloads on their own." breadcrumbs={[{ label: 'Digital products' }]}
        actions={manage && <Button leftIcon={Plus} onClick={() => setEditing('new')}>New product</Button>} />
      <Card>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data ?? []} onRowClick={manage ? (r) => setEditing(r) : undefined}
          empty={<EmptyState icon={Package} title="No products yet" description="Upload an e-book, worksheet pack or template and sell it — or give it away to collect students." action={manage && <Button size="sm" leftIcon={Plus} onClick={() => setEditing('new')}>Create a product</Button>} />}
          columns={[
            { key: 'title', header: 'Product', cell: (r) => <div><p className="font-medium text-fg">{r.title}</p><p className="text-xs text-muted">{r.files.length} file{r.files.length === 1 ? '' : 's'}{r.downloadLimit ? ` · ${r.downloadLimit} downloads per file` : ''}</p></div> },
            { key: 'price', header: 'Price', cell: (r) => (Number(r.priceAmount) === 0 ? 'Free' : formatMoney(r.priceAmount, r.currency)) },
            { key: 'buyers', header: 'Buyers', cell: (r) => r.buyers },
            { key: 'revenue', header: 'Revenue', cell: (r) => formatMoney(r.revenue, r.currency) },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions', header: '', cell: (r) => (
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" leftIcon={Users} aria-label={`Buyers of ${r.title}`} onClick={() => setBuyersOf(r)}>Buyers</Button>
                  {manage && (r.status !== 'PUBLISHED'
                    ? <Button size="sm" variant="secondary" onClick={() => status.mutate({ id: r.id, s: 'PUBLISHED' })}>Publish</Button>
                    : <Button size="sm" variant="ghost" onClick={() => status.mutate({ id: r.id, s: 'DRAFT' })}>Unpublish</Button>)}
                  {manage && <Button size="sm" variant="ghost" aria-label={`Archive ${r.title}`} onClick={() => status.mutate({ id: r.id, s: 'ARCHIVED' })}>Archive</Button>}
                </div>
              ),
            },
          ]} />
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New product' : 'Edit product'} size="lg">
        {editing && <ProductForm product={editing === 'new' ? null : editing} onDone={done} />}
      </Modal>
      {buyersOf && <Buyers product={buyersOf} onClose={() => setBuyersOf(null)} />}
    </>
  );
}
