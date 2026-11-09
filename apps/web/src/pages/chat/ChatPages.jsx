import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MessagesSquare, MoreVertical, RotateCcw } from 'lucide-react';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { ChatThread, useChatThread } from '../../components/chat/ChatThread.jsx';
import { Avatar, Badge, Card, Dropdown, DropdownItem, EmptyState, ErrorState, Skeleton, toast } from '../../components/ui/index.js';
import { creatorChatApi, learnChatApi, platformChatApi, supportChatApi } from '../../services/api/chat.js';
import { cn } from '../../utils/cn.js';

function CustomerChat({ api, title, description, emptyDescription, teamName }) {
  const chat = useChatThread(api, { side: 'customer' });
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card className="flex h-[calc(100vh-12rem)] min-h-[28rem] flex-col overflow-hidden">
        <ChatThread chat={chat} side="customer" className="flex-1" emptyTitle="Start a conversation" emptyDescription={emptyDescription}
          header={<div className="flex items-center gap-3 border-b border-line px-4 py-3"><span className="grid size-9 place-items-center rounded-full bg-primary-100 text-primary-700"><MessagesSquare className="size-4" aria-hidden /></span><div><p className="font-semibold text-fg">{teamName}</p><p className="text-xs text-muted">Usually replies within a few hours</p></div></div>} />
      </Card>
    </>
  );
}

/** Student: chat with the academy team. */
export function StudentChatPage() {
  return <CustomerChat api={learnChatApi} title="Chat with us" description="Questions about a course, a payment or your account? The academy team replies here." teamName="Academy team" emptyDescription="Send a message and the team will reply here. You'll get a notification when they do." />;
}

/** Creator: chat with platform support. */
export function CreatorSupportChatPage() {
  return <CustomerChat api={supportChatApi} title="Chat with platform support" description="Talk to our support team in real time. For longer issues you can also open a ticket." teamName="Platform support" emptyDescription="Describe what you need help with and a support agent will reply here." />;
}

/** "Thu" for this week, "10:42" for today, "05 Nov" before that — like an email inbox. */
export function dayLabel(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (now - d < 6 * 86_400_000) return d.toLocaleDateString('en-IN', { weekday: 'short' });
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function AgentThread({ inbox, id, contact, onChanged, onBack }) {
  const api = useMemo(() => inbox.thread(id), [inbox, id]);
  const chat = useChatThread(api, { side: 'agent' });
  const status = useMutation({
    mutationFn: (s) => api.setStatus(s),
    onSuccess: (r) => { chat.setStatus(r.status); onChanged(); toast.success(r.status === 'CLOSED' ? 'Conversation closed' : 'Conversation reopened'); },
    onError: (e) => toast.error(e.message),
  });
  const header = (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3">
      <button type="button" className="text-sm text-primary-600 md:hidden" onClick={onBack} aria-label="All conversations">←</button>
      <Avatar name={contact?.name} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-fg">{contact?.name ?? 'Conversation'}</p>
        <p className="truncate text-xs text-muted">{contact?.email ?? contact?.slug ?? ''}</p>
      </div>
      <Badge tone={chat.status === 'OPEN' ? 'success' : 'neutral'}>{chat.status === 'OPEN' ? 'Open' : 'Closed'}</Badge>
      <Dropdown trigger={(p) => <button type="button" {...p} aria-label="Conversation actions" className="grid size-8 place-items-center rounded-md text-fg-2 hover:bg-surface-2"><MoreVertical className="size-4" aria-hidden /></button>}>
        <DropdownItem icon={chat.status === 'OPEN' ? CheckCircle2 : RotateCcw} onClick={() => status.mutate(chat.status === 'OPEN' ? 'CLOSED' : 'OPEN')}>{chat.status === 'OPEN' ? 'Close conversation' : 'Reopen conversation'}</DropdownItem>
      </Dropdown>
    </div>
  );
  return <ChatThread chat={chat} side="agent" header={header} className="h-full" />;
}

function ChatInbox({ inbox, scope, title, description, searchPlaceholder }) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? undefined;
  const unread = params.get('unread') === '1';
  const search = params.get('q') ?? '';
  const selected = params.get('c');
  const query = { ...(status ? { status } : {}), ...(unread ? { unread: 1 } : {}), ...(search ? { q: search } : {}) };
  const q = useQuery({ queryKey: ['chat', scope, query], queryFn: () => inbox.list(query), placeholderData: (p) => p, refetchInterval: 15_000 });
  const set = (patch) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); return n; }, { replace: true });
  const refresh = () => qc.invalidateQueries({ queryKey: ['chat', scope] });
  const items = q.data?.items ?? [];
  const contact = items.find((c) => c.id === selected)?.customer;
  return (
    <>
      <PageHeader title={title} count={q.data?.total} description={description} />
      <Card className="grid h-[calc(100vh-12rem)] min-h-[32rem] grid-cols-1 overflow-hidden md:grid-cols-[20rem_1fr]">
        <div className={cn('flex min-h-0 flex-col border-line md:border-r', selected && 'hidden md:flex')}>
          <div className="space-y-3 border-b border-line p-4">
            <SearchInput value={search} onChange={(v) => set({ q: v })} placeholder={searchPlaceholder} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">Filter by:</span>
              <FilterChip label="Status" value={status} onChange={(v) => set({ status: v })} options={[{ value: 'OPEN', label: 'Open' }, { value: 'CLOSED', label: 'Closed' }]} />
              <FilterChip label="Messages" value={unread ? '1' : undefined} onChange={(v) => set({ unread: v })} options={[{ value: '1', label: `Unread${q.data?.unreadConversations ? ` (${q.data.unreadConversations})` : ''}` }]} />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="m-4 h-40" /> : items.length === 0 ? (
              <EmptyState icon={MessagesSquare} title={search || status || unread ? 'No conversations match' : 'No conversations yet'} description={search || status || unread ? 'Try a different search or clear the filters.' : 'Conversations appear here when someone writes to you.'} />
            ) : (
              <ul aria-label="Conversations">
                {items.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => { set({ c: c.id }); setTimeout(refresh, 500); }} aria-current={selected === c.id ? 'true' : undefined}
                      className={cn('flex w-full items-center gap-3 border-l-2 px-4 py-3 text-left transition-colors', selected === c.id ? 'border-primary-600 bg-primary-50 dark:bg-primary-500/10' : 'border-transparent hover:bg-surface-2')}>
                      <Avatar name={c.customer.name} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className={cn('truncate text-sm', c.unread > 0 || selected === c.id ? 'font-semibold text-fg' : 'font-medium text-fg-2', selected === c.id && 'text-primary-700 dark:text-primary-300')}>{c.customer.name}</span>
                          <span className="shrink-0 text-[11px] text-muted">{dayLabel(c.lastMessageAt)}</span>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-muted">{c.lastMessagePreview}</span>
                          {c.unread > 0 && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary-600 px-1.5 text-[11px] font-semibold text-on-primary">{c.unread}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className={cn('min-h-0', !selected && 'hidden md:block')}>
          {selected ? <AgentThread key={selected} inbox={inbox} id={selected} contact={contact} onChanged={refresh} onBack={() => set({ c: null })} />
            : <EmptyState icon={MessagesSquare} title="Select a conversation" description="Pick someone on the left to read and reply." className="h-full" />}
        </div>
      </Card>
    </>
  );
}

/** Academy staff: inbox of student chats. */
export function CreatorChatInboxPage() {
  return <ChatInbox inbox={creatorChatApi} scope="creator" title="Inbox" description="Live conversations with your students." searchPlaceholder="Search by name or email" />;
}

/** Platform support: inbox of academy chats. */
export function PlatformChatInboxPage() {
  return <ChatInbox inbox={platformChatApi} scope="platform" title="Live chat" description="Real-time conversations with academy teams." searchPlaceholder="Search by academy name or slug" />;
}
