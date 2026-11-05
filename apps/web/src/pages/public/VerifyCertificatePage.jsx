import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, ShieldX } from 'lucide-react';
import { AuthLayout } from '../../components/auth/AuthLayout.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { Button, Input, Skeleton } from '../../components/ui/index.js';
import { catalogApi } from '../../services/api/learn.js';
import { formatDate } from '../../utils/format.js';

/** Public certificate verification (linked from the QR code on every certificate). */
export function VerifyCertificatePage() {
  const { number } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(number ?? '');
  const q = useQuery({ queryKey: ['verify', number], queryFn: () => catalogApi.verifyCertificate(number), enabled: Boolean(number), retry: false });
  return (
    <AuthLayout title="Verify a certificate" subtitle="Check that a certificate is genuine.">
      <form className="mb-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (input.trim()) navigate(`/verify/${input.trim().toUpperCase()}`); }}>
        <Input aria-label="Certificate number" placeholder="CE-2026-XXXXXXXX" value={input} onChange={(e) => setInput(e.target.value)} />
        <Button type="submit">Verify</Button>
      </form>
      {number && (q.isLoading ? <Skeleton className="h-24" /> : q.isError ? <Alert tone="error" title="Not found">No certificate exists with number {number}.</Alert> : q.data.valid ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
          <p className="flex items-center gap-2 font-semibold text-green-800 dark:text-green-200"><BadgeCheck className="size-5" />Valid certificate</p>
          <dl className="mt-3 space-y-1 text-sm"><div><dt className="inline text-muted">Awarded to </dt><dd className="inline font-medium">{q.data.recipientName}</dd></div><div><dt className="inline text-muted">For </dt><dd className="inline font-medium">{q.data.courseTitle}</dd></div><div><dt className="inline text-muted">By </dt><dd className="inline font-medium">{q.data.academyName}</dd></div><div><dt className="inline text-muted">Issued </dt><dd className="inline">{formatDate(q.data.issuedAt)}</dd></div></dl>
        </div>
      ) : (
        <Alert tone="error" title={<span className="flex items-center gap-2"><ShieldX className="size-4" />Revoked</span>}>This certificate was revoked on {formatDate(q.data.revokedAt)}.</Alert>
      ))}
    </AuthLayout>
  );
}
