import { useState } from 'react';
import { Link } from 'react-router';
import { ListToolbar } from '../../components/common/ListToolbar.jsx';
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
  const [search, setSearch] = useState('');
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const rows = all.filter((p) => !term || p.title.toLowerCase().includes(term) || p.files.some((f) => f.title.toLowerCase().includes(term)));
  return (
    <>
      <PageHeader title="Downloads" count={q.data ? all.length : undefined} description="E-books, templates and files you own." />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : !q.data ? <Skeleton className="h-48" /> : all.length === 0 ? (
        <Card><EmptyState icon={Package} title="No downloads yet" description="Products you buy or get for free appear here." action={<Link to="/courses" className="text-sm font-medium text-primary-600 underline">Browse the academy</Link>} /></Card>
      ) : (
        <Card>
          <ListToolbar search={search} onSearch={setSearch} placeholder="Search by product or file name" count={rows.length} noun="product" />
          {!rows.length ? <EmptyState icon={Package} title="No downloads match" /> : (
            <ul className="divide-y divide-line">
              {rows.map((p) => (
                <li key={p.id} className="flex flex-col gap-3 p-4 lg:flex-row">
                  <div className="flex items-center gap-3 lg:w-72">
                    {p.coverUrl ? <img src={p.coverUrl} alt="" className="size-14 rounded-lg object-cover" /> : <span className="grid size-14 place-items-center rounded-lg bg-gradient-to-br from-sky-200 to-primary-500"><Package className="size-6 text-white" /></span>}
                    <div className="min-w-0"><p className="truncate font-semibold">{p.title}</p><p className="text-xs text-muted">Since {formatDate(p.since)} · {p.files.length} file{p.files.length === 1 ? '' : 's'}</p></div>
                  </div>
                  <ul className="flex-1 space-y-2">
                    {p.files.map((f) => (
                      <li key={f.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2/60 px-3 py-2 text-sm">
                        <span className="min-w-0"><span className="block truncate">{f.title}</span>{f.remaining !== null && <span className={f.remaining === 0 ? 'text-xs text-red-600' : 'text-xs text-muted'}>{f.remaining} download{f.remaining === 1 ? '' : 's'} left</span>}</span>
                        <Button size="sm" variant="secondary" leftIcon={Download} disabled={f.remaining === 0} loading={dl.isPending && dl.variables?.fileId === f.id} onClick={() => dl.mutate({ productId: p.id, fileId: f.id })}>Download</Button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
