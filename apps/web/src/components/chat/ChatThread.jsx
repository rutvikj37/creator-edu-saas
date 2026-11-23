import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { Button, EmptyState, ErrorState, Skeleton, toast } from '../ui/index.js';
import { cn } from '../../utils/cn.js';

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

const timeLabel = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
};

/**
 * Message list and composer. `side` is the viewer's side ('customer' or 'agent'): the other side's
 * messages sit on the left in a tinted bubble, the viewer's own on the right with the sender's name.
 */
export function ChatThread({ chat, side, header, emptyTitle = 'No messages yet', emptyDescription, placeholder = 'Start typing here…', className }) {
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
      {header}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6" role="log" aria-live="polite" aria-label="Messages">
        {chat.loading ? <Skeleton className="h-32" /> : chat.messages.length === 0 ? (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        ) : (
          <>
            {chat.hasMore && <div className="text-center"><Button size="sm" variant="ghost" onClick={() => chat.older().catch((e) => toast.error(e.message))}>Load earlier messages</Button></div>}
            {chat.messages.map((m) => {
              const mine = m.side === side;
              return (
                <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[75%] rounded-xl px-3.5 py-2.5 text-sm text-fg', mine ? 'bg-surface-2' : 'bg-primary-50 dark:bg-primary-500/10')}>
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className="mt-1.5 flex items-center justify-end gap-2 text-[11px] text-muted">
                      {mine && m.senderName && <span className="rounded bg-primary-100 px-1.5 py-0.5 font-medium text-primary-700 dark:bg-primary-500/20 dark:text-primary-300">{m.senderName}</span>}
                      <span>{timeLabel(m.createdAt)}</span>
                    </p>
                  </div>
                </div>
              );
            })}
          </>
        )}
        <div ref={end} />
      </div>
      {chat.status === 'CLOSED' && <p className="px-6 pb-2 text-center text-xs text-muted">{side === 'customer' ? 'This conversation was closed. Sending a message opens it again.' : 'This conversation is closed. The customer can reopen it by writing again.'}</p>}
      <form onSubmit={submit} className="border-t border-line p-3 sm:p-4">
        <div className="flex items-end gap-2 rounded-xl border border-line bg-surface px-3 py-2 focus-within:ring-2 focus-within:ring-primary-500">
          <label htmlFor="chat-input" className="sr-only">Message</label>
          <textarea id="chat-input" rows={1} maxLength={2000} value={text} placeholder={placeholder} disabled={chat.loading}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            className="max-h-40 min-h-[2rem] flex-1 resize-none bg-transparent py-1 text-sm focus:outline-none" />
          <button type="submit" aria-label="Send" disabled={!text.trim() || sending}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-600 text-on-primary transition-opacity disabled:opacity-40">
            {sending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
          </button>
        </div>
      </form>
    </div>
  );
}
