import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessagesSquare } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { ChatThread, useChatThread } from '../../components/chat/ChatThread.jsx';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, Tabs, toast } from '../../components/ui/index.js';
import { creatorChatApi, learnChatApi, platformChatApi, supportChatApi } from '../../services/api/chat.js';
import { cn } from '../../utils/cn.js';
import { formatDate } from '../../utils/format.js';

function CustomerChat({ api, title, description, breadcrumbs, emptyDescription }) {
  const chat = useChatThread(api, { side: 'customer' });
  return (
    <>
      <PageHeader title={title} description={description} breadcrumbs={breadcrumbs} />
      <Card className="flex h-[70vh] flex-col"><ChatThread chat={chat} side="customer" className="flex-1" emptyTitle="Start a conversation" emptyDescription={emptyDescription} /></Card>
    </>
  );
}

/** Student: chat with the academy team. */
export function StudentChatPage() {
  return <CustomerChat api={learnChatApi} title="Chat with us" description="Questions about a course, a payment or your account? The academy team replies here." breadcrumbs={[{ label: 'Chat' }]} emptyDescription="Send a message and the team will reply here. You'll get a notification when they do." />;
}

/** Creator: chat with platform support. */
export function CreatorSupportChatPage() {
  return <CustomerChat api={supportChatApi} title="Chat with platform support" description="Talk to our support team in real time. For longer issues you can also open a ticket." breadcrumbs={[{ label: 'Support' }, { label: 'Chat' }]} emptyDescription="Describe what you need help with and a support agent will reply here." />;
}

function AgentThread({ inbox, id, onChanged }) {
  const api = useMemo(() => inbox.thread(id), [inbox, id]);
  const chat = useChatThread(api, { side: 'agent' });
  const status = useMutation({
    mutationFn: (s) => api.setStatus(s),
    onSuccess: (r) => { chat.setStatus(r.status); onChanged(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-end gap-2 border-b border-line px-4 py-2">
        <Badge tone={chat.status === 'OPEN' ? 'success' : 'neutral'}>{chat.status === 'OPEN' ? 'Open' : 'Closed'}</Badge>
        <Button size="sm" variant="secondary" loading={status.isPending} disabled={chat.loading} onClick={() => status.mutate(chat.status === 'OPEN' ? 'CLOSED' : 'OPEN')}>{chat.status === 'OPEN' ? 'Close conversation' : 'Reopen'}</Button>
      </div>
      <ChatThread chat={chat} side="agent" className="flex-1" placeholder="Write a reply…" />
    </div>
  );
}

function ChatInbox({ inbox, scope, title, description, breadcrumbs, customerLabel }) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? 'OPEN';
  const selected = params.get('c');
  const query = view === 'UNREAD' ? { unread: 1 } : view === 'ALL' ? {} : { status: view };
  const key = ['chat', scope, view];
  const q = useQuery({ queryKey: key, queryFn: () => inbox.list(query), refetchInterval: 15_000 });
  const set = (patch) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); return n; });
  const refresh = () => qc.invalidateQueries({ queryKey: ['chat', scope] });
  return (
    <>
      <PageHeader title={title} description={description} breadcrumbs={breadcrumbs} />
      <Tabs className="mb-4" value={view} onChange={(v) => set({ view: v, c: null })} tabs={[{ value: 'OPEN', label: 'Open' }, { value: 'UNREAD', label: `Unread${q.data?.unreadConversations ? ` (${q.data.unreadConversations})` : ''}` }, { value: 'CLOSED', label: 'Closed' }, { value: 'ALL', label: 'All' }]} />
      <Card className="grid h-[72vh] grid-cols-1 overflow-hidden md:grid-cols-[18rem_1fr]">
        <div className={cn('min-h-0 overflow-y-auto border-line md:border-r', selected && 'hidden md:block')}>
          {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="m-4 h-40" /> : q.data.items.length === 0 ? (
            <EmptyState icon={MessagesSquare} title="No conversations" description="Conversations appear here when someone writes to you." />
          ) : (
            <ul className="divide-y divide-line" aria-label="Conversations">
              {q.data.items.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => { set({ c: c.id }); setTimeout(refresh, 500); }} aria-current={selected === c.id ? 'true' : undefined}
                    className={cn('w-full px-4 py-3 text-left hover:bg-subtle', selected === c.id && 'bg-subtle')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-fg">{c.customer.name}</span>
                      {c.unread > 0 && <Badge tone="info">{c.unread}</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted">{c.lastMessagePreview}</p>
                    <p className="text-[11px] text-muted">{c.customer.email ?? c.customer.slug ?? ''}{c.lastMessageAt ? ` · ${formatDate(c.lastMessageAt, { withTime: true })}` : ''}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={cn('min-h-0', !selected && 'hidden md:block')}>
          {selected ? (
            <div className="flex h-full flex-col">
              <button type="button" className="border-b border-line px-4 py-2 text-left text-sm text-primary-600 md:hidden" onClick={() => set({ c: null })}>← All conversations</button>
              <div className="min-h-0 flex-1"><AgentThread key={selected} inbox={inbox} id={selected} onChanged={refresh} /></div>
            </div>
          ) : <EmptyState icon={MessagesSquare} title={`Choose a ${customerLabel}`} description="Pick a conversation to read and reply." className="h-full" />}
        </div>
      </Card>
    </>
  );
}

/** Academy staff: inbox of student chats. */
export function CreatorChatInboxPage() {
  return <ChatInbox inbox={creatorChatApi} scope="creator" customerLabel="conversation" title="Chat inbox" description="Live conversations with your students." breadcrumbs={[{ label: 'Students' }, { label: 'Chat' }]} />;
}

/** Platform support: inbox of academy chats. */
export function PlatformChatInboxPage() {
  return <ChatInbox inbox={platformChatApi} scope="platform" customerLabel="conversation" title="Live chat" description="Real-time conversations with academy teams." breadcrumbs={[{ label: 'Support' }, { label: 'Live chat' }]} />;
}
