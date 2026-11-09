import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../core/redis/redis.constants.js';
import { NotificationsService } from '../notifications/notifications.service.js';

export type ChatKind = 'ACADEMY' | 'PLATFORM';
export type Side = 'customer' | 'agent';

const MAX_WAIT_MS = 25_000;
const PAGE = 50;
const RATE_PER_MINUTE = 30;
const CHANNEL = 'chat:new';

type Conv = { id: string; tenantId: string; kind: ChatKind; customerUserId: string | null; status: string; lastMessageAt: Date | null; lastMessagePreview: string | null; customerUnread: number; agentUnread: number; createdAt: Date };

/**
 * Live chat: students ↔ academy team (ACADEMY) and academy team ↔ platform support (PLATFORM).
 * Messages are stored in MySQL; delivery is near real-time through long polling: a client asks
 * for messages after the last one it has and the request waits (up to 25 s) until a new message
 * is published on Redis — so it works across API instances without WebSockets or new headers.
 * All access checks are done by the caller (controller) choosing the conversation.
 */
@Injectable()
export class ChatService implements OnModuleDestroy {
  private readonly log = new Logger(ChatService.name);
  private sub: Redis | null = null;
  private readonly waiters = new Map<string, Set<() => void>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly notifications: NotificationsService,
  ) {}

  private async subscriber() {
    if (this.sub) return this.sub;
    const sub = this.redis.duplicate();
    sub.on('message', (_channel: string, conversationId: string) => {
      const set = this.waiters.get(conversationId);
      if (!set) return;
      this.waiters.delete(conversationId);
      for (const wake of set) wake();
    });
    sub.on('error', (e) => this.log.warn(`chat subscriber: ${e.message}`));
    await sub.subscribe(CHANNEL);
    this.sub = sub;
    return sub;
  }

  async onModuleDestroy() {
    for (const set of this.waiters.values()) for (const wake of set) wake();
    this.waiters.clear();
    await this.sub?.quit().catch(() => undefined);
  }

  // ── conversations ─────────────────────────────────────────
  /** The student's thread with an academy, or the academy's thread with platform support (created on demand). */
  async customerThread(tenantId: string, kind: ChatKind, customerUserId: string | null) {
    const threadKey = kind === 'ACADEMY' ? `ACADEMY:${customerUserId}` : 'PLATFORM';
    const existing = await this.prisma.chatConversation.findUnique({ where: { tenantId_threadKey: { tenantId, threadKey } } });
    if (existing) return existing as Conv;
    try {
      return (await this.prisma.chatConversation.create({ data: { tenantId, kind, customerUserId: kind === 'ACADEMY' ? customerUserId : null, threadKey } })) as Conv;
    } catch {
      return (await this.prisma.chatConversation.findUniqueOrThrow({ where: { tenantId_threadKey: { tenantId, threadKey } } })) as Conv;
    }
  }

  /** A conversation an agent may open: ACADEMY ones of their academy, or any PLATFORM one for platform support. */
  async agentThread(id: string, scope: { kind: 'ACADEMY'; tenantId: string } | { kind: 'PLATFORM' }) {
    const c = await this.prisma.chatConversation.findFirst({ where: { id, kind: scope.kind, ...(scope.kind === 'ACADEMY' ? { tenantId: scope.tenantId } : {}) } });
    if (!c) throw AppException.notFound('Conversation not found');
    return c as Conv;
  }

  /** Customers whose name or email (students) or academy name/slug (platform) contains `q`. */
  private async matching(scope: { kind: 'ACADEMY'; tenantId: string } | { kind: 'PLATFORM' }, q: string) {
    if (scope.kind === 'ACADEMY') {
      const users = await this.prisma.user.findMany({ where: { realmKey: scope.tenantId, OR: [{ fullName: { contains: q } }, { email: { contains: q } }] }, select: { id: true }, take: 500 });
      return { customerUserId: { in: users.map((u) => u.id) } };
    }
    const tenants = await this.prisma.tenant.findMany({ where: { OR: [{ name: { contains: q } }, { slug: { contains: q } }] }, select: { id: true }, take: 500 });
    return { tenantId: { in: tenants.map((t) => t.id) } };
  }

  async list(scope: { kind: 'ACADEMY'; tenantId: string } | { kind: 'PLATFORM' }, params: { status?: string; unread?: boolean; page?: number; q?: string }) {
    const page = Math.max(1, Number(params.page) || 1);
    const q = params.q?.trim().slice(0, 100);
    const where = {
      ...(q ? await this.matching(scope, q) : {}),
      kind: scope.kind, ...(scope.kind === 'ACADEMY' ? { tenantId: scope.tenantId } : {}), lastMessageAt: { not: null },
      ...(params.status === 'OPEN' || params.status === 'CLOSED' ? { status: params.status as 'OPEN' | 'CLOSED' } : {}),
      ...(params.unread ? { agentUnread: { gt: 0 } } : {}),
    };
    const [rows, total, unread] = await Promise.all([
      this.prisma.chatConversation.findMany({ where, orderBy: { lastMessageAt: 'desc' }, skip: (page - 1) * 30, take: 30 }),
      this.prisma.chatConversation.count({ where }),
      this.prisma.chatConversation.count({ where: { kind: scope.kind, ...(scope.kind === 'ACADEMY' ? { tenantId: scope.tenantId } : {}), agentUnread: { gt: 0 } } }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.customerUserId).filter((x): x is string => Boolean(x)) } }, select: { id: true, fullName: true, email: true } });
    const tenants = scope.kind === 'PLATFORM' ? await this.prisma.tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId) } }, select: { id: true, name: true, slug: true } }) : [];
    return {
      items: rows.map((r) => ({
        id: r.id, status: r.status, lastMessageAt: r.lastMessageAt, lastMessagePreview: r.lastMessagePreview, unread: r.agentUnread,
        customer: scope.kind === 'ACADEMY' ? { name: users.find((u) => u.id === r.customerUserId)?.fullName ?? 'Student', email: users.find((u) => u.id === r.customerUserId)?.email ?? null } : { name: tenants.find((t) => t.id === r.tenantId)?.name ?? 'Academy', email: null, slug: tenants.find((t) => t.id === r.tenantId)?.slug ?? null },
      })),
      total, page, pages: Math.max(1, Math.ceil(total / 30)), unreadConversations: unread,
    };
  }

  // ── messages ──────────────────────────────────────────────
  private async view(c: Conv, rows: { id: string; senderId: string; side: string; body: string; createdAt: Date }[]) {
    const people = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.senderId))] } }, select: { id: true, fullName: true } });
    return rows.map((m) => ({ id: m.id, side: m.side as Side, body: m.body, createdAt: m.createdAt, senderName: people.find((p) => p.id === m.senderId)?.fullName ?? '' }));
  }

  /** Latest messages (oldest first). `before` pages back through history. */
  async messages(c: Conv, before?: string) {
    const pivot = before ? await this.prisma.chatMessage.findFirst({ where: { id: before, conversationId: c.id } }) : null;
    const rows = await this.prisma.chatMessage.findMany({ where: { conversationId: c.id, ...(pivot ? { createdAt: { lt: pivot.createdAt } } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: PAGE });
    return { conversation: { id: c.id, status: c.status, kind: c.kind }, messages: await this.view(c, rows.reverse()), hasMore: rows.length === PAGE };
  }

  private async newer(c: Conv, after: string | undefined) {
    const pivot = after ? await this.prisma.chatMessage.findFirst({ where: { id: after, conversationId: c.id } }) : null;
    if (after && !pivot) return [];
    return this.prisma.chatMessage.findMany({ where: { conversationId: c.id, ...(pivot ? { OR: [{ createdAt: { gt: pivot.createdAt } }, { createdAt: pivot.createdAt, id: { gt: pivot.id } }] } : {}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: PAGE });
  }

  /** Messages after `after`; with `wait`, holds the request until one arrives or the timeout passes. */
  async poll(c: Conv, after: string | undefined, waitMs: number) {
    let rows = await this.newer(c, after);
    if (!rows.length && waitMs > 0) {
      await this.subscriber();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, Math.min(waitMs, MAX_WAIT_MS));
        const set = this.waiters.get(c.id) ?? new Set();
        function done() { clearTimeout(timer); set.delete(done); resolve(); }
        set.add(done);
        this.waiters.set(c.id, set);
      });
      rows = await this.newer(c, after);
    }
    const fresh = await this.prisma.chatConversation.findUniqueOrThrow({ where: { id: c.id } });
    return { messages: await this.view(c, rows), status: fresh.status };
  }

  async send(c: Conv, side: Side, senderId: string, body: string) {
    const text = body.trim();
    if (!text) throw AppException.validation([{ field: 'body', message: 'Write a message' }]);
    if (text.length > 2000) throw AppException.validation([{ field: 'body', message: 'Keep messages under 2000 characters' }]);
    const key = `chat:rate:${senderId}:${Math.floor(Date.now() / 60_000)}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 70);
    if (n > RATE_PER_MINUTE) throw AppException.conflict('You are sending messages too quickly. Wait a moment.');
    const m = await this.prisma.chatMessage.create({ data: { tenantId: c.tenantId, conversationId: c.id, senderId, side, body: text } });
    await this.prisma.chatConversation.update({
      where: { id: c.id },
      data: {
        lastMessageAt: m.createdAt, lastMessagePreview: text.slice(0, 200),
        // A new message from the customer re-opens a closed conversation.
        ...(side === 'customer' ? { agentUnread: { increment: 1 }, status: 'OPEN' } : { customerUnread: { increment: 1 } }),
      },
    });
    await this.redis.publish(CHANNEL, c.id);
    if (side === 'agent') await this.notifyCustomer(c, text).catch(() => undefined);
    return (await this.view(c, [m]))[0];
  }

  private async notifyCustomer(c: Conv, text: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: c.tenantId }, select: { name: true } });
    if (c.kind === 'ACADEMY' && c.customerUserId) {
      await this.notifications.notify({ userId: c.customerUserId, tenantId: c.tenantId, category: 'community', title: `New message from ${tenant?.name ?? 'your academy'}`, body: text.slice(0, 200), link: '/learn/chat', brand: tenant?.name ?? 'Your academy', skipEmail: true });
    }
    if (c.kind === 'PLATFORM') {
      const owners = await this.prisma.tenantMember.findMany({ where: { tenantId: c.tenantId, status: 'ACTIVE', role: { key: 'OWNER' } }, select: { userId: true } });
      for (const o of owners) await this.notifications.notify({ userId: o.userId, tenantId: c.tenantId, category: 'community', title: 'New reply from platform support', body: text.slice(0, 200), link: '/creator/support-chat', brand: 'Platform support', skipEmail: true });
    }
  }

  async markRead(c: Conv, side: Side) {
    await this.prisma.chatConversation.update({ where: { id: c.id }, data: side === 'customer' ? { customerUnread: 0 } : { agentUnread: 0 } });
    return { read: true };
  }

  async setStatus(c: Conv, status: 'OPEN' | 'CLOSED') {
    await this.prisma.chatConversation.update({ where: { id: c.id }, data: { status } });
    await this.redis.publish(CHANNEL, c.id);
    return { status };
  }

  summary(c: Conv) {
    return { id: c.id, status: c.status, unread: c.customerUnread };
  }
}
