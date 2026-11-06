import { useCallback, useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Button, EmptyState, ErrorState, Skeleton, toast } from '../ui/index.js';
import { cn } from '../../utils/cn.js';
import { formatDate } from '../../utils/format.js';

const merge = (a, b) => {
  const seen = new Set(a.map((m) => m.id));
  return [...a, ...b.filter((m) => !seen.has(m.id))];
};

/**
 * Keeps one conversation live: loads the latest page, then long-polls the API for anything newer
 * (the server holds each request until a message arrives or 25 s pass). Stops when unmounted.
 */
export function useChatThread(api, { side, idleDelayMs = 2000, retryDelayMs = 4000 } = {}) {
  const [state, setState] = useState({ loading: true, error: null, messages: [], hasMore: false, status: 'OPEN' });
  const last = useRef(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const first = await api.load();
        if (!alive) return;
        last.current = first.messages.at(-1)?.id ?? null;
        setState({ loading: false, error: null, messages: first.messages, hasMore: first.hasMore, status: first.conversation.status });
        if (first.messages.some((m) => m.side !== side)) api.read().catch(() => undefined);
      } catch (e) {
        if (alive) setState((s) => ({ ...s, loading: false, error: e }));
        return;
      }
      while (alive) {
        const started = Date.now();
        try {
          const r = await api.poll(last.current, true, ctrl.signal);
          if (!alive) return;
          if (r.messages.length) {
            last.current = r.messages.at(-1).id;
            setState((s) => ({ ...s, messages: merge(s.messages, r.messages), status: r.status }));
            if (r.messages.some((m) => m.side !== side)) api.read().catch(() => undefined);
          } else {
            setState((s) => (s.status === r.status ? s : { ...s, status: r.status }));
            if (Date.now() - started < 1000) await sleep(idleDelayMs);
          }
        } catch {
          if (!alive) return;
          await sleep(retryDelayMs);
        }
      }
    })();
    return () => { alive = false; ctrl.abort(); };
  }, [api, side, idleDelayMs, retryDelayMs, tick]);

  const send = useCallback(async (body) => {
    const m = await api.send(body);
    setState((s) => ({ ...s, messages: merge(s.messages, [m]), ...(side === 'customer' ? { status: 'OPEN' } : {}) }));
    return m;
  }, [api, side]);

  const older = useCallback(async () => {
    const first = state.messages[0];
    if (!first) return;
    const r = await api.older(first.id);
    setState((s) => ({ ...s, messages: [...r.messages, ...s.messages.filter((m) => !r.messages.some((x) => x.id === m.id))], hasMore: r.hasMore }));
  }, [api, state.messages]);

  return { ...state, send, older, retry: () => setTick((t) => t + 1), setStatus: (status) => setState((s) => ({ ...s, status })) };
}

/** Message list and composer. `side` is the viewer's side ('customer' or 'agent'). */
export function ChatThread({ chat, side, emptyTitle = 'No messages yet', emptyDescription, placeholder = 'Write a message…', className }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [chat.messages.length]);

  const submit = async (e) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await chat.send(body);
      setText('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  if (chat.error) return <ErrorState error={chat.error} onRetry={chat.retry} />;
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" role="log" aria-live="polite" aria-label="Messages">
        {chat.loading ? <Skeleton className="h-32" /> : chat.messages.length === 0 ? (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        ) : (
          <>
            {chat.hasMore && <div className="text-center"><Button size="sm" variant="ghost" onClick={() => chat.older().catch((e) => toast.error(e.message))}>Load earlier messages</Button></div>}
            {chat.messages.map((m) => {
              const mine = m.side === side;
              return (
                <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[80%] rounded-lg px-3 py-2 text-sm', mine ? 'bg-primary-600 text-white' : 'bg-subtle text-fg')}>
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className={cn('mt-1 text-[11px]', mine ? 'text-white/75' : 'text-muted')}>{m.senderName ? `${m.senderName} · ` : ''}{formatDate(m.createdAt, { withTime: true })}</p>
                  </div>
                </div>
              );
            })}
          </>
        )}
        <div ref={end} />
      </div>
      {chat.status === 'CLOSED' && <p className="border-t border-line px-4 py-2 text-xs text-muted">{side === 'customer' ? 'This conversation was closed. Sending a message opens it again.' : 'This conversation is closed. The customer can reopen it by writing again.'}</p>}
      <form onSubmit={submit} className="flex items-end gap-2 border-t border-line p-3">
        <label htmlFor="chat-input" className="sr-only">Message</label>
        <textarea id="chat-input" rows={2} maxLength={2000} value={text} placeholder={placeholder} disabled={chat.loading}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
        <Button type="submit" leftIcon={Send} loading={sending} disabled={!text.trim()}>Send</Button>
      </form>
    </div>
  );
}
