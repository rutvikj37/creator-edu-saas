import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from '../auth/Alert.jsx';
import { Button, Input, Modal, Textarea, toast } from '../ui/index.js';
import { reviewsApi } from '../../services/api/reviews.js';
import { StarInput } from './Stars.jsx';

/** Student: rate and review a course (create, edit, delete). */
export function ReviewDialog({ courseId, open, onClose }) {
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ['review', courseId], queryFn: () => reviewsApi.mine(courseId), enabled: open });
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState(null);
  useEffect(() => {
    if (mine.data) { setRating(mine.data.rating); setTitle(mine.data.title ?? ''); setBody(mine.data.body ?? ''); }
  }, [mine.data]);
  const done = (msg) => { qc.invalidateQueries({ queryKey: ['review', courseId] }); toast.success(msg); onClose(); };
  const save = useMutation({ mutationFn: () => reviewsApi.save(courseId, { rating, title: title || null, body: body || null }), onSuccess: () => done(mine.data ? 'Review updated' : 'Thanks for your review!'), onError: (e) => setError(e.message) });
  const remove = useMutation({ mutationFn: () => reviewsApi.remove(courseId), onSuccess: () => { setRating(0); setTitle(''); setBody(''); done('Review deleted'); }, onError: (e) => toast.error(e.message) });
  return (
    <Modal open={open} onClose={onClose} title={mine.data ? 'Your review' : 'Rate this course'}
      footer={<>
        {mine.data && <Button variant="ghost" className="mr-auto text-red-600" loading={remove.isPending} onClick={() => remove.mutate()}>Delete</Button>}
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={!rating} loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>{mine.data ? 'Save' : 'Submit'}</Button>
      </>}>
      <div className="space-y-4">
        {mine.data?.status === 'HIDDEN' && <Alert tone="warning" title="Your review is hidden">{mine.data.hiddenReason}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <StarInput value={rating} onChange={setRating} />
        <Input label="Headline (optional)" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea label="Your review (optional)" rows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} hint="Shown on the course page with your first name and last initial." />
        {mine.data?.reply && <div className="rounded-md bg-surface-2 p-3 text-sm"><p className="mb-1 font-medium">Reply from the academy</p><p className="whitespace-pre-line text-fg-2">{mine.data.reply}</p></div>}
      </div>
    </Modal>
  );
}
