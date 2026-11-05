import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Package } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button, Card, CardBody, EmptyState, ErrorState, Skeleton, toast } from '../../components/ui/index.js';
import { productsApi } from '../../services/api/commerce.js';
import { formatDate } from '../../utils/format.js';

/** Student: digital products owned, with secure downloads. */
export function DownloadsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['learn', 'products'], queryFn: productsApi.mine });
  const dl = useMutation({
    mutationFn: ({ productId, fileId }) => productsApi.download(productId, fileId),
    onSuccess: (r) => { window.location.assign(r.url); qc.invalidateQueries({ queryKey: ['learn', 'products'] }); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <PageHeader title="Downloads" description="E-books, templates and files you own." breadcrumbs={[{ label: 'Downloads' }]} />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : !q.data ? <Skeleton className="h-48" /> : q.data.length === 0 ? (
        <Card><EmptyState icon={Package} title="No downloads yet" description="Products you buy or get for free appear here." action={<Link to="/courses" className="text-sm font-medium text-primary-600 underline">Browse the academy</Link>} /></Card>
      ) : (
        <div className="space-y-4">
          {q.data.map((p) => (
            <Card key={p.id}>
              <CardBody className="space-y-3">
                <div className="flex items-center gap-3">{p.coverUrl ? <img src={p.coverUrl} alt="" className="size-12 rounded object-cover" /> : <Package className="size-8 text-muted" />}<div><p className="font-semibold">{p.title}</p><p className="text-xs text-muted">Since {formatDate(p.since)}</p></div></div>
                <ul className="divide-y divide-line rounded-md border border-line">
                  {p.files.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span>{f.title}{f.remaining !== null && <span className="ml-2 text-xs text-muted">{f.remaining} download{f.remaining === 1 ? '' : 's'} left</span>}</span>
                      <Button size="sm" variant="secondary" leftIcon={Download} disabled={f.remaining === 0} loading={dl.isPending && dl.variables?.fileId === f.id} onClick={() => dl.mutate({ productId: p.id, fileId: f.id })}>Download</Button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
