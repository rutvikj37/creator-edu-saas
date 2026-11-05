import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, X } from 'lucide-react';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, Card, CardBody, Skeleton, Textarea, toast } from '../../components/ui/index.js';
import { RichTextView } from '../../components/forms/RichTextView.jsx';
import { learnApi, uploadSubmission } from '../../services/api/learn.js';
import { formatDate } from '../../utils/format.js';

export function AssignmentPanel({ lessonId, onSubmitted }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['assignment', lessonId], queryFn: () => learnApi.assignment(lessonId) });
  const [text, setText] = useState(null);
  const [files, setFiles] = useState(null);
  const [uploading, setUploading] = useState(null);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError) return <Alert tone="error">{q.error.message}</Alert>;
  const a = q.data;
  const sub = a.submission;
  const curText = text ?? sub?.text ?? '';
  const curFiles = files ?? sub?.files ?? [];

  const upload = async (file) => {
    if (!file) return;
    setUploading(0);
    try { const f = await uploadSubmission(file, setUploading); setFiles([...curFiles, f]); } catch (e) { toast.error(e.details?.[0]?.message ?? e.message); } finally { setUploading(null); }
  };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await learnApi.submitAssignment(lessonId, { text: curText, fileAssetIds: curFiles.map((f) => f.id) });
      qc.setQueryData(['assignment', lessonId], r);
      setText(null); setFiles(null);
      toast.success('Submitted');
      onSubmitted?.();
    } catch (e) { toast.error(e.details?.[0]?.message ?? e.message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card><CardBody className="space-y-3">
        <RichTextView value={a.instructions} />
        <p className="text-xs text-muted">{a.dueAt ? `Due ${formatDate(a.dueAt, { withTime: true })}${a.allowLate ? ' · late submissions accepted' : ''}` : 'No due date'} · {a.maxPoints} points</p>
      </CardBody></Card>
      {sub && (
        <Alert tone={sub.status === 'GRADED' ? 'success' : sub.status === 'RETURNED' ? 'error' : 'info'} title={sub.status === 'GRADED' ? `Graded: ${sub.points}/${a.maxPoints}` : sub.status === 'RETURNED' ? 'Returned for changes' : `Submitted ${formatDate(sub.submittedAt, { withTime: true })}${sub.isLate ? ' (late)' : ''}`}>
          {sub.feedback}
        </Alert>
      )}
      {a.canSubmit && (
        <Card><CardBody className="space-y-3">
          <Textarea label="Your answer" rows={6} value={curText} onChange={(e) => setText(e.target.value)} />
          {a.allowFiles && (
            <div className="space-y-2">
              {curFiles.map((f) => <div key={f.id} className="flex items-center gap-2 text-sm"><Paperclip className="size-4 text-muted" /><span className="flex-1">{f.fileName}</span><Button variant="ghost" size="icon-sm" aria-label={`Remove ${f.fileName}`} onClick={() => setFiles(curFiles.filter((x) => x.id !== f.id))}><X className="size-4" /></Button></div>)}
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-primary-600"><Paperclip className="size-4" />{uploading !== null ? `Uploading… ${uploading}%` : 'Attach file'}<input type="file" className="sr-only" accept=".pdf,.docx,.pptx,.xlsx,.zip,.txt,.csv,image/*" onChange={(e) => upload(e.target.files?.[0])} /></label>
            </div>
          )}
          <div className="flex justify-end"><Button loading={busy} onClick={submit}>{sub ? 'Resubmit' : 'Submit assignment'}</Button></div>
        </CardBody></Card>
      )}
      {sub?.files?.length > 0 && !a.canSubmit && <div className="flex flex-wrap gap-2">{sub.files.map((f) => <a key={f.id} href={f.url} className="inline-flex items-center gap-1 text-sm text-primary-600 underline"><Paperclip className="size-3.5" />{f.fileName}</a>)}<Badge>{sub.status.toLowerCase()}</Badge></div>}
    </div>
  );
}
