import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Award, Bookmark, BookmarkCheck, Check, ChevronLeft, ChevronRight, CircleCheck, Download, ExternalLink, Lock, Menu, MessageSquare, NotebookPen, Trash2, X } from 'lucide-react';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, ErrorState, Skeleton, Tabs, Textarea, toast } from '../../components/ui/index.js';
import { RichTextView } from '../../components/forms/RichTextView.jsx';
import { learnApi } from '../../services/api/learn.js';
import { cn } from '../../utils/cn.js';
import { formatDate } from '../../utils/format.js';
import { QuizRunner } from './QuizRunner.jsx';
import { AssignmentPanel } from './AssignmentPanel.jsx';
import { VideoPlayer } from '../../components/video/VideoPlayer.jsx';

function flatLessons(sections) {
  return sections.flatMap((s) => s.lessons.flatMap((l) => [l, ...(l.children ?? [])]));
}

function LessonContent({ lessonId, onAutoComplete }) {
  const q = useQuery({ queryKey: ['lesson', lessonId], queryFn: () => learnApi.lesson(lessonId), retry: false });
  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.isError) return <Alert tone="error" title="Can't open this lesson">{q.error.message}</Alert>;
  const l = q.data;
  switch (l.type) {
    case 'TEXT': return <RichTextView value={l.content} className="max-w-3xl" />;
    case 'LINK': return <a href={l.externalUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-2 rounded-md border border-line px-4 py-3 text-sm font-medium hover:bg-surface-2"><ExternalLink className="size-4" />Open resource</a>;
    case 'PDF': return l.file ? <iframe title={l.title} src={l.file.url} className="h-[75vh] w-full rounded-lg border border-line bg-white" /> : null;
    case 'IMAGE': return l.file ? <img src={l.file.url} alt={l.title} className="max-h-[75vh] rounded-lg border border-line" /> : null;
    case 'AUDIO': return l.file ? <audio controls src={l.file.url} className="w-full max-w-xl" /> : null;
    case 'DOCUMENT':
    case 'DOWNLOAD': return l.file ? <a href={`${l.file.url}${l.file.downloadable ? (l.file.url.includes('?') ? '&' : '?') + 'download=1' : ''}`} className="inline-flex items-center gap-2 rounded-md border border-line px-4 py-3 text-sm font-medium hover:bg-surface-2"><Download className="size-4" />{l.file.fileName}</a> : null;
    case 'QUIZ': return <QuizRunner lessonId={lessonId} onPassed={onAutoComplete} />;
    case 'ASSIGNMENT': return <AssignmentPanel lessonId={lessonId} onSubmitted={onAutoComplete} />;
    case 'VIDEO': return l.hasVideo ? <VideoPlayer lessonId={lessonId} onCompleted={onAutoComplete} /> : <Alert tone="info">This video isn't available yet.</Alert>;
    default: return null;
  }
}

function NotesPanel({ courseId, lessonId }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notes', courseId], queryFn: () => learnApi.notes(courseId) });
  const [body, setBody] = useState('');
  const add = useMutation({ mutationFn: () => learnApi.addNote(lessonId, body), onSuccess: () => { setBody(''); qc.invalidateQueries({ queryKey: ['notes', courseId] }); }, onError: (e) => toast.error(e.message) });
  const del = useMutation({ mutationFn: learnApi.deleteNote, onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', courseId] }) });
  const notes = (q.data ?? []).filter((n) => n.lessonId === lessonId);
  return (
    <div className="space-y-3">
      <Textarea aria-label="New note" placeholder="Write a private note…" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      <Button size="sm" disabled={!body.trim()} loading={add.isPending} onClick={() => add.mutate()}>Save note</Button>
      <ul className="space-y-2">{notes.map((n) => <li key={n.id} className="rounded-md bg-surface-2 p-3 text-sm"><p className="whitespace-pre-wrap">{n.body}</p><div className="mt-1 flex justify-between text-xs text-muted">{formatDate(n.createdAt, { withTime: true })}<button type="button" aria-label="Delete note" onClick={() => del.mutate(n.id)}><Trash2 className="size-3.5" /></button></div></li>)}</ul>
      {!notes.length && <p className="text-sm text-muted">Notes are private to you.</p>}
    </div>
  );
}

function DiscussionPanel({ lessonId }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['comments', lessonId], queryFn: () => learnApi.comments(lessonId) });
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [reply, setReply] = useState('');
  const post = useMutation({ mutationFn: ({ text, parentId }) => learnApi.comment(lessonId, text, parentId), onSuccess: () => { setBody(''); setReply(''); setReplyTo(null); qc.invalidateQueries({ queryKey: ['comments', lessonId] }); }, onError: (e) => toast.error(e.message) });
  return (
    <div className="space-y-3">
      <Textarea aria-label="Ask a question" placeholder="Ask a question about this lesson…" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      <Button size="sm" disabled={!body.trim()} loading={post.isPending && !replyTo} onClick={() => post.mutate({ text: body })}>Post</Button>
      <ul className="space-y-3">{(q.data ?? []).map((t) => (
        <li key={t.id} className="rounded-md border border-line p-3 text-sm">
          <p className="font-medium">{t.author}</p><p className="mt-1 whitespace-pre-wrap">{t.body}</p>
          <ul className="mt-2 space-y-2 border-l-2 border-line pl-3">{t.replies.map((r) => <li key={r.id}><p className="text-xs font-medium">{r.author} {r.isInstructor && <Badge tone="primary">Instructor</Badge>}</p><p className="whitespace-pre-wrap">{r.body}</p></li>)}</ul>
          {replyTo === t.id ? (
            <div className="mt-2 space-y-2"><Textarea aria-label="Reply" rows={2} value={reply} onChange={(e) => setReply(e.target.value)} /><Button size="sm" disabled={!reply.trim()} onClick={() => post.mutate({ text: reply, parentId: t.id })}>Reply</Button></div>
          ) : <button type="button" className="mt-2 text-xs font-medium text-primary-600" onClick={() => setReplyTo(t.id)}>Reply</button>}
        </li>))}</ul>
    </div>
  );
}

/** Distraction-free learning view: curriculum · content · notes/discussion. */
export function PlayerPage() {
  const { courseId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const player = useQuery({ queryKey: ['player', courseId], queryFn: () => learnApi.player(courseId), retry: false });
  const [sidebar, setSidebar] = useState(false);
  const [tab, setTab] = useState('notes');
  const lessons = useMemo(() => (player.data ? flatLessons(player.data.sections) : []), [player.data]);
  const currentId = params.get('lesson') ?? player.data?.enrollment.lastLessonId ?? lessons.find((l) => !l.completed && !l.locked)?.id ?? lessons[0]?.id;
  const idx = lessons.findIndex((l) => l.id === currentId);
  const current = lessons[idx];
  const go = (id) => { setParams({ lesson: id }, { replace: true }); setSidebar(false); };
  const refresh = () => qc.invalidateQueries({ queryKey: ['player', courseId] });
  useEffect(() => { if (player.data) document.title = player.data.course.title; }, [player.data]);

  const toggle = useMutation({
    mutationFn: () => (current.completed ? learnApi.uncomplete(current.id) : learnApi.complete(current.id)),
    onSuccess: (r) => { refresh(); if (r.certificate) toast.success('Course complete! Your certificate is ready.'); else if (!current.completed && lessons[idx + 1] && !lessons[idx + 1].locked) go(lessons[idx + 1].id); },
    onError: (e) => toast.error(e.details?.[0]?.message ?? e.message),
  });
  const bookmark = useMutation({ mutationFn: () => learnApi.bookmark(current.id), onSuccess: refresh });

  if (player.isError) return <div className="grid min-h-dvh place-items-center p-4"><ErrorState title="Can't open this course" error={player.error} onRetry={() => navigate('/learn')} /></div>;
  if (player.isLoading) return <div className="p-6"><Skeleton className="h-[80vh]" /></div>;
  const p = player.data;

  const curriculum = (
    <nav aria-label="Course curriculum" className="space-y-4 p-4">
      {p.sections.map((s, si) => (
        <div key={s.id}>
          <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{si + 1}. {s.title}</p>
          <ul>{s.lessons.flatMap((l) => [l, ...(l.children ?? []).map((c) => ({ ...c, sub: true }))]).map((l) => (
            <li key={l.id}>
              <button type="button" disabled={l.locked} onClick={() => go(l.id)} aria-current={l.id === currentId ? 'page' : undefined}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm', l.sub && 'pl-7', l.id === currentId ? 'bg-primary-50 font-medium text-primary-700' : 'hover:bg-surface-2', l.locked && 'cursor-not-allowed opacity-60')}>
                {l.locked ? <Lock className="size-4 shrink-0 text-muted" /> : l.completed ? <CircleCheck className="size-4 shrink-0 text-green-600" /> : <span className="size-4 shrink-0 rounded-full border border-line-strong" />}
                <span className="flex-1 truncate">{l.title}</span>
                {l.locked && l.unlocksAt && <span className="text-[10px] text-muted">{formatDate(l.unlocksAt)}</span>}
              </button>
            </li>))}</ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
        <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Show curriculum" onClick={() => setSidebar(true)}><Menu className="size-5" /></Button>
        <Link to="/learn" className="flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /><span className="hidden sm:inline">My learning</span></Link>
        <p className="min-w-0 flex-1 truncate font-semibold">{p.course.title}</p>
        <div className="hidden items-center gap-2 sm:flex"><div className="h-1.5 w-32 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-green-600" style={{ width: `${p.enrollment.progressPercent}%` }} /></div><span className="text-xs text-muted">{p.enrollment.progressPercent}%</span></div>
        {p.enrollment.completedAt && p.course.certificateEnabled && <Link to="/learn/certificates" className="inline-flex items-center gap-1 text-sm font-medium text-primary-600"><Award className="size-4" />Certificate</Link>}
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-line bg-surface lg:block">{curriculum}</aside>
        {sidebar && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-slate-900/50" onClick={() => setSidebar(false)} /><aside className="absolute inset-y-0 left-0 w-80 overflow-y-auto bg-surface"><div className="flex justify-end p-2"><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setSidebar(false)}><X className="size-4" /></Button></div>{curriculum}</aside></div>}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {current ? (
            <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-xl font-semibold sm:text-2xl">{current.title}</h1>
                <Button variant="ghost" size="icon-sm" aria-label={current.bookmarked ? 'Remove bookmark' : 'Bookmark lesson'} onClick={() => bookmark.mutate()}>{current.bookmarked ? <BookmarkCheck className="size-5 text-primary-600" /> : <Bookmark className="size-5" />}</Button>
              </div>
              <LessonContent key={current.id} lessonId={current.id} onAutoComplete={refresh} />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <Button variant="secondary" leftIcon={ChevronLeft} disabled={idx <= 0} onClick={() => go(lessons[idx - 1].id)}>Previous</Button>
                {!['QUIZ', 'ASSIGNMENT'].includes(current.type) && <Button variant={current.completed ? 'secondary' : 'primary'} leftIcon={current.completed ? Check : undefined} loading={toggle.isPending} onClick={() => toggle.mutate()}>{current.completed ? 'Completed' : 'Mark complete'}</Button>}
                <Button variant="secondary" rightIcon={ChevronRight} disabled={idx >= lessons.length - 1 || lessons[idx + 1]?.locked} onClick={() => go(lessons[idx + 1].id)}>Next</Button>
              </div>
            </div>
          ) : <p className="p-8 text-muted">This course has no lessons yet.</p>}
        </main>
        {current && (
          <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-line bg-surface p-4 xl:block">
            <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: 'notes', label: <span className="inline-flex items-center gap-1"><NotebookPen className="size-4" />Notes</span> }, { value: 'discussion', label: <span className="inline-flex items-center gap-1"><MessageSquare className="size-4" />Q&A</span> }]} />
            {tab === 'notes' ? <NotesPanel courseId={courseId} lessonId={current.id} /> : <DiscussionPanel lessonId={current.id} />}
          </aside>
        )}
      </div>
    </div>
  );
}
