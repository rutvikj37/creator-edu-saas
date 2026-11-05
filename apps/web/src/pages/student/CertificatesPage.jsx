import { useQuery } from '@tanstack/react-query';
import { Award, Download, ExternalLink } from 'lucide-react';
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
  return (
    <>
      <PageHeader title="Certificates" description="Download and share your achievements." breadcrumbs={[{ label: 'Certificates' }]} />
      {q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : q.isLoading ? <Skeleton className="h-40" /> : !q.data.length ? (
        <Card><EmptyState icon={Award} title="No certificates yet" description="Complete a course with a certificate to earn one." /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {q.data.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex items-start gap-3">
                <Award className="size-6 text-primary-600" aria-hidden />
                <div className="flex-1">
                  <p className="font-semibold">{c.courseTitle}</p>
                  <p className="text-sm text-muted">Issued {formatDate(c.issuedAt)} · {c.number}</p>
                  {c.status === 'REVOKED' && <Badge tone="danger" className="mt-2">Revoked</Badge>}
                </div>
              </div>
              {c.status === 'ISSUED' && (
                <div className="mt-4 flex gap-2">
                  <Button size="sm" leftIcon={Download} onClick={() => download(c)}>Download PDF</Button>
                  <a href={`/verify/${c.number}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-xs font-medium hover:bg-surface-2"><ExternalLink className="size-3.5" />Verification page</a>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
