import { Watermark } from '../video/Watermark.jsx';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LiveKitRoom, RoomAudioRenderer, VideoConference } from '@livekit/components-react';
import '@livekit/components-styles';
import { BarChart3, Check, Hourglass, MessageCircleQuestion, ThumbsUp, UserCheck, X } from 'lucide-react';
import { Badge, Button, Input, Tabs, toast } from '../ui/index.js';
import { creatorLiveApi } from '../../services/api/live.js';

const POLL_MS = 4000;

function PollsPanel({ api, host }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['live', 'polls', api.key], queryFn: api.polls, refetchInterval: POLL_MS });
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const set = (data) => qc.setQueryData(['live', 'polls', api.key], data);
  const create = useMutation({ mutationFn: () => api.createPoll({ question, options: options.filter((o) => o.trim()) }), onSuccess: (d) => { set(d); setQuestion(''); setOptions(['', '']); }, onError: (e) => toast.error(e.message) });
  const vote = useMutation({ mutationFn: ({ id, i }) => api.vote(id, i), onSuccess: set, onError: (e) => toast.error(e.message) });
  const close = useMutation({ mutationFn: (id) => api.closePoll(id), onSuccess: set, onError: (e) => toast.error(e.message) });
  return (
    <div className="space-y-4">
      {host && (
        <form className="space-y-2 rounded-lg border border-line p-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Input aria-label="Poll question" placeholder="Ask the room a question" value={question} onChange={(e) => setQuestion(e.target.value)} />
          {options.map((o, i) => <Input key={i} aria-label={`Option ${i + 1}`} placeholder={`Option ${i + 1}`} value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />)}
          <div className="flex gap-2">
            {options.length < 6 && <Button size="sm" variant="ghost" onClick={() => setOptions([...options, ''])}>Add option</Button>}
            <Button size="sm" type="submit" loading={create.isPending} disabled={!question.trim() || options.filter((o) => o.trim()).length < 2}>Launch poll</Button>
          </div>
        </form>
      )}
      {(q.data ?? []).length === 0 && <p className="text-sm text-muted">No polls yet.</p>}
      {(q.data ?? []).map((p) => (
        <div key={p.id} className="rounded-lg border border-line p-3">
          <div className="mb-2 flex items-start justify-between gap-2"><p className="text-sm font-medium">{p.question}</p>{p.status === 'CLOSED' ? <Badge>Closed</Badge> : host && <Button size="sm" variant="ghost" onClick={() => close.mutate(p.id)}>Close</Button>}</div>
          <ul className="space-y-1.5">
            {p.options.map((o, i) => {
              const pct = p.total ? Math.round((p.counts[i] / p.total) * 100) : 0;
              const mine = p.myVote === i;
              const canVote = !host && p.status === 'OPEN' && api.vote;
              return (
                <li key={i}>
                  <button type="button" disabled={!canVote} onClick={() => vote.mutate({ id: p.id, i })} className={`relative w-full overflow-hidden rounded-md border px-3 py-1.5 text-left text-sm ${mine ? 'border-primary-500' : 'border-line'} ${canVote ? 'hover:bg-surface-2' : ''}`}>
                    <span className="absolute inset-y-0 left-0 bg-primary-100 dark:bg-primary-900/40" style={{ width: `${pct}%` }} aria-hidden />
                    <span className="relative flex justify-between gap-2"><span>{mine && <Check className="mr-1 inline size-3.5" />}{o}</span><span className="tabular-nums text-muted">{pct}%</span></span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-xs text-muted">{p.total} vote{p.total === 1 ? '' : 's'}</p>
        </div>
      ))}
    </div>
  );
}

function QuestionsPanel({ api, host }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['live', 'questions', api.key], queryFn: api.questions, refetchInterval: POLL_MS });
  const [text, setText] = useState('');
  const set = (data) => qc.setQueryData(['live', 'questions', api.key], data);
  const ask = useMutation({ mutationFn: () => api.ask(text), onSuccess: (d) => { set(d); setText(''); }, onError: (e) => toast.error(e.message) });
  const upvote = useMutation({ mutationFn: (id) => api.upvote(id), onSuccess: set });
  const answer = useMutation({ mutationFn: (id) => api.answer(id), onSuccess: set });
  return (
    <div className="space-y-3">
      {api.ask && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) ask.mutate(); }}>
          <Input aria-label="Your question" placeholder="Ask a question" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" size="sm" loading={ask.isPending}>Ask</Button>
        </form>
      )}
      {(q.data ?? []).length === 0 && <p className="text-sm text-muted">No questions yet.</p>}
      {(q.data ?? []).map((x) => (
        <div key={x.id} className={`rounded-lg border border-line p-3 text-sm ${x.answered ? 'opacity-60' : ''}`}>
          <p>{x.text}</p>
          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>{x.name}{x.answered && ' · answered'}</span>
            <span className="flex items-center gap-1">
              {api.upvote && !x.mine ? <button type="button" className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-2 ${x.upvotedByMe ? 'text-primary-600' : ''}`} onClick={() => upvote.mutate(x.id)} aria-label="Upvote"><ThumbsUp className="size-3.5" />{x.upvotes}</button> : <span className="inline-flex items-center gap-1"><ThumbsUp className="size-3.5" />{x.upvotes}</span>}
              {host && !x.answered && <Button size="sm" variant="ghost" onClick={() => answer.mutate(x.id)}>Mark answered</Button>}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function AdmissionsPanel({ sessionId }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['live', 'admissions', sessionId], queryFn: () => creatorLiveApi.admissions(sessionId), refetchInterval: POLL_MS });
  const decide = useMutation({ mutationFn: ({ id, admit }) => creatorLiveApi.decide(sessionId, id, admit), onSuccess: (d) => qc.setQueryData(['live', 'admissions', sessionId], d), onError: (e) => toast.error(e.message) });
  const waiting = (q.data ?? []).filter((a) => a.status === 'WAITING');
  return waiting.length === 0 ? <p className="text-sm text-muted">Nobody is waiting.</p> : (
    <ul className="space-y-2">{waiting.map((a) => (
      <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-line p-2 text-sm">
        <span className="truncate">{a.name}</span>
        <span className="flex gap-1">
          <Button size="sm" leftIcon={UserCheck} onClick={() => decide.mutate({ id: a.id, admit: true })}>Admit</Button>
          <Button size="icon-sm" variant="ghost" aria-label={`Deny ${a.name}`} onClick={() => decide.mutate({ id: a.id, admit: false })}><X className="size-4" /></Button>
        </span>
      </li>
    ))}</ul>
  );
}

/**
 * The classroom: LiveKit conference (video, audio, screen share, chat, participants) with
 * polls, Q&A and — for hosts — the waiting room. Attendees in the waiting room see a holding screen
 * until the host admits them; LiveKit then grants their permissions without reconnecting.
 */
export function LiveRoom({ join, title, api, host = false, sessionId, onLeave, endButton }) {
  const [tab, setTab] = useState(host && join.waitingRoom !== false ? 'waiting' : 'polls');
  const admission = useQuery({ queryKey: ['live', 'admission', api.key], queryFn: api.admission, enabled: Boolean(join.waiting && api.admission), refetchInterval: (query) => (query.state.data?.status === 'ADMITTED' ? false : 3000) });
  const status = join.waiting ? admission.data?.status ?? 'WAITING' : 'ADMITTED';
  const tabs = [...(host ? [{ value: 'waiting', label: 'Waiting room' }] : []), { value: 'polls', label: 'Polls' }, { value: 'qa', label: 'Q&A' }];
  return (
    <LiveKitRoom serverUrl={join.url} token={join.token} connect video={false} audio={false} onDisconnected={onLeave} data-lk-theme="default" className="flex h-dvh flex-col bg-[#111]">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 text-white">
        <p className="truncate text-sm font-medium">{title}</p>
        <div className="flex items-center gap-2">{host && <Badge tone="danger" dot>Live</Badge>}{endButton}</div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <Watermark enabled={!host} />
          {status === 'DENIED' ? (
            <div className="grid h-full place-items-center text-white/80"><p>The host did not admit you to this session.</p></div>
          ) : status !== 'ADMITTED' ? (
            <div className="grid h-full place-items-center text-center text-white/85"><div><Hourglass className="mx-auto mb-3 size-10 animate-pulse" /><p className="text-lg font-medium">Waiting for the host to let you in…</p><p className="mt-1 text-sm text-white/60">Keep this page open.</p></div></div>
          ) : (
            <VideoConference />
          )}
          <RoomAudioRenderer />
        </main>
        {status === 'ADMITTED' && (
          <aside className="hidden w-80 shrink-0 flex-col border-l border-white/10 bg-surface lg:flex">
            <Tabs className="px-3 pt-2" value={tab} onChange={setTab} tabs={tabs} />
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {tab === 'waiting' && <AdmissionsPanel sessionId={sessionId} />}
              {tab === 'polls' && <PollsPanel api={api} host={host} />}
              {tab === 'qa' && <QuestionsPanel api={api} host={host} />}
            </div>
            <p className="flex items-center gap-1.5 border-t border-line px-3 py-2 text-xs text-muted"><BarChart3 className="size-3.5" />Polls <MessageCircleQuestion className="ml-2 size-3.5" />Q&A update every few seconds</p>
          </aside>
        )}
      </div>
    </LiveKitRoom>
  );
}
