import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ListToolbar } from '../../components/common/ListToolbar.jsx';
import { Award, Download, ExternalLink, Share2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, toast } from '../../components/ui/index.js';
import { learnApi } from '../../services/api/learn.js';
import { formatDate } from '../../utils/format.js';

export function StudentCertificatesPage() {
  const q = useQuery({ queryKey: ['learn', 'certificates'], queryFn: learnApi.certificates });
  const download = async (c) => {
    try {
      const blob = await learnApi.certificatePdf(c.id);
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `certificate-${c.number}.pdf` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(e.message);
    }
  };
  const [search, setSearch] = useState('');
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const rows = all.filter((c) => !term || c.courseTitle.toLowerCase().includes(term) || c.number.toLowerCase().includes(term));
  const share = (c) => {
    const url = `${window.location.origin}/verify/${c.number}`;
    navigator.clipboard?.writeText(url).then(() => toast.success('Verification link copied'), () => toast.error('Couldn’t copy the link'));
  };
  return (
    <>
      <PageHeader title="Certificates" count={q.data ? all.length : undefined} description="Download and share your achievements." />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : q.isLoading ? <Skeleton className="h-40" /> : !all.length ? (
        <Card><EmptyState icon={Award} title="No certificates yet" description="Complete a course with a certificate to earn one." action={<Link to="/learn" className="text-sm font-medium text-primary-600 underline">Continue learning</Link>} /></Card>
      ) : (
        <Card>
          <ListToolbar search={search} onSearch={setSearch} placeholder="Search by course or certificate number" count={rows.length} noun="certificate" />
          {!rows.length ? <EmptyState icon={Award} title="No certificates match" /> : (
            <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((c) => (
                <article key={c.id} className="flex flex-col overflow-hidden rounded-xl border border-line">
                  <div className="grid h-24 place-items-center bg-gradient-to-br from-amber-100 via-amber-200 to-amber-400 dark:from-amber-500/20 dark:to-amber-600/30"><Award className="size-10 text-amber-700 dark:text-amber-300" aria-hidden /></div>
                  <div className="flex flex-1 flex-col gap-1 p-4">
                    <p className="font-semibold text-fg">{c.courseTitle}</p>
                    <p className="text-xs text-muted">Issued {formatDate(c.issuedAt)} · <span className="font-mono">{c.number}</span></p>
                    {c.status === 'REVOKED' && <Badge tone="danger" className="mt-1 w-fit">Revoked</Badge>}
                    {c.status === 'ISSUED' && (
                      <div className="mt-auto flex flex-wrap gap-2 pt-3">
                        <Button size="sm" leftIcon={Download} onClick={() => download(c)}>Download PDF</Button>
                        <Button size="sm" variant="secondary" leftIcon={Share2} onClick={() => share(c)}>Copy link</Button>
                        <a href={`/verify/${c.number}`} target="_blank" rel="noreferrer" aria-label="Open verification page" className="inline-flex h-8 items-center rounded-md px-2 text-fg-2 hover:bg-surface-2"><ExternalLink className="size-4" /></a>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}
