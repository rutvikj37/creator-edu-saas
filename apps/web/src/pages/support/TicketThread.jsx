import { Avatar, Badge } from '../../components/ui/index.js';
import { cn } from '../../utils/cn.js';
import { formatDate } from '../../utils/format.js';

/** Conversation view shared by staff and creators. Message bodies render as text (escaped). */
export function TicketThread({ messages, staffView = false, staffLabel = 'Support' }) {
  return (
    <ol className="space-y-4">
      {messages.map((m) => (
        <li key={m.id} className={cn('rounded-lg border p-4', m.isInternalNote ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950' : m.isStaff ? 'border-primary-200 bg-primary-50/40' : 'border-line bg-surface')}>
          <div className="mb-2 flex items-center gap-2 text-sm">
            <Avatar name={m.author?.fullName ?? '?'} size="sm" />
            <span className="font-medium">{m.author?.fullName ?? 'Unknown'}</span>
            {m.isStaff && <Badge tone="primary">{staffLabel}</Badge>}
            {staffView && m.isInternalNote && <Badge tone="warning">Internal note</Badge>}
            <span className="ml-auto text-xs text-muted">{formatDate(m.createdAt, { withTime: true })}</span>
          </div>
          <p className="text-sm whitespace-pre-wrap text-fg-2">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}
