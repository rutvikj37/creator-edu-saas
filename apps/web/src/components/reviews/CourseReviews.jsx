import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardBody, Skeleton } from '../ui/index.js';
import { reviewsApi } from '../../services/api/reviews.js';
import { formatDate } from '../../utils/format.js';
import { Stars } from './Stars.jsx';

/** Public reviews section of a course page: summary with distribution, filter by stars, list with replies. */
export function CourseReviews({ slug }) {
  const [page, setPage] = useState(1);
  const [rating, setRating] = useState(null);
  const q = useQuery({ queryKey: ['public', 'reviews', slug, page, rating], queryFn: () => reviewsApi.publicList(slug, { page, ...(rating ? { rating } : {}) }), placeholderData: (prev) => prev });
  const d = q.data;
  if (!d) return q.isLoading ? <Skeleton className="h-40" /> : null;
  if (!d.summary.count) return null;
  const s = d.summary;
  return (
    <section aria-labelledby="reviews-h">
      <h2 id="reviews-h" className="mb-4 text-xl font-semibold">Student reviews</h2>
      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        <div>
          <p className="text-4xl font-semibold">{s.average.toFixed(1)}</p>
          <Stars value={s.average} />
          <p className="mt-1 text-sm text-muted">{s.count} rating{s.count === 1 ? '' : 's'}</p>
          <div className="mt-4 space-y-1.5">
            {[5, 4, 3, 2, 1].map((n) => {
              const pct = s.count ? Math.round((s.distribution[n] / s.count) * 100) : 0;
              return (
                <button key={n} type="button" aria-pressed={rating === n} onClick={() => { setRating(rating === n ? null : n); setPage(1); }}
                  className={`flex w-full items-center gap-2 rounded px-1 text-xs hover:bg-surface-2 ${rating === n ? 'bg-surface-2 font-semibold' : ''}`}
                  aria-label={`${n} stars: ${pct}%${rating === n ? ' (filter on)' : ''}`}>
                  <span className="w-8 text-left">{n} ★</span>
                  <span className="h-2 flex-1 rounded-full bg-surface-2"><span className="block h-2 rounded-full bg-amber-400" style={{ width: `${pct}%` }} /></span>
                  <span className="w-9 text-right text-muted">{pct}%</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-3">
          {d.items.length === 0 ? <p className="text-sm text-muted">No reviews with this rating.</p> : d.items.map((r) => (
            <Card key={r.id}>
              <CardBody className="space-y-2">
                <div className="flex flex-wrap items-center gap-2"><Stars value={r.rating} size="size-3.5" /><span className="text-sm font-medium">{r.author}</span><span className="text-xs text-muted">{formatDate(r.createdAt)}{r.edited ? ' · edited' : ''}</span></div>
                {r.title && <p className="font-semibold">{r.title}</p>}
                {r.body && <p className="whitespace-pre-line text-sm text-fg-2">{r.body}</p>}
                {r.reply && <div className="rounded-md border-l-2 border-primary-500 bg-surface-2 p-3 text-sm"><p className="mb-0.5 text-xs font-medium text-muted">Reply from the academy</p><p className="whitespace-pre-line">{r.reply}</p></div>}
              </CardBody>
            </Card>
          ))}
          {d.pages > 1 && (
            <div className="flex items-center justify-between pt-1 text-sm">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-muted">Page {d.page} of {d.pages}</span>
              <Button size="sm" variant="secondary" disabled={page >= d.pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
