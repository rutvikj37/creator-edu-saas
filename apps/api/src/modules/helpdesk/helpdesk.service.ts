import { Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { Paginated } from '../../common/interceptors/response-envelope.interceptor.js';
import { toSkipTake } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AppConfig } from '../../config/app-config.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { academyOrigin } from '../tenants/academy-origin.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { StudentTicketDto, TicketListQuery, TicketReplyDto, TicketUpdateDto } from '../platform/dto/platform.dto.js';

const OPEN_PER_STUDENT = 10;
const ACADEMY = 'ACADEMY' as const;

/** Student ↔ academy help desk. Tickets are always confined to one academy; internal notes never reach students. */
@Injectable()
export class HelpdeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly notifications: NotificationsService,
  ) {}

  private async people(ids: string[]) {
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true, email: true } });
    return new Map(users.map((u) => [u.id, u]));
  }

  /** Active members of the academy whose role grants support.manage (owner, admins, support agents, custom roles). */
  private async agents(tenantId: string) {
    const rows = await this.prisma.tenantMember.findMany({
      where: { tenantId, status: 'ACTIVE', role: { permissions: { some: { permission: { key: PERMISSIONS.SUPPORT_MANAGE } } } } },
      select: { user: { select: { id: true, fullName: true, email: true } } },
    });
    return rows.map((r) => r.user);
  }

  // ── student side ───────────────────────────────────────────
  async create(tenantId: string, studentId: string, dto: StudentTicketDto) {
    const open = await this.prisma.supportTicket.count({ where: { scope: ACADEMY, tenantId, requesterId: studentId, status: { notIn: ['RESOLVED', 'CLOSED'] } } });
    if (open >= OPEN_PER_STUDENT) throw AppException.conflict(`You already have ${OPEN_PER_STUDENT} open requests. Wait for a reply or close one first.`);
    const t = await this.prisma.supportTicket.create({
      data: { scope: ACADEMY, tenantId, requesterId: studentId, subject: dto.subject, category: dto.category, priority: 'MEDIUM', messages: { create: { authorId: studentId, body: dto.body } } },
    });
    await this.notifyAgents(tenantId, t.id, `New request #${t.number}: ${t.subject}`, dto.body);
    return this.getForStudent(tenantId, studentId, t.id);
  }

  async listForStudent(tenantId: string, studentId: string, q: TicketListQuery) {
    const where: Prisma.SupportTicketWhereInput = { scope: ACADEMY, tenantId, requesterId: studentId, ...(q.status ? { status: q.status as never } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.supportTicket.findMany({ where, orderBy: { lastActivityAt: 'desc' }, ...toSkipTake(q), select: { id: true, number: true, subject: true, category: true, status: true, lastActivityAt: true, createdAt: true } }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return new Paginated(rows, { page: q.page, pageSize: q.pageSize, total });
  }

  async getForStudent(tenantId: string, studentId: string, id: string) {
    const t = await this.prisma.supportTicket.findFirst({
      where: { id, scope: ACADEMY, tenantId, requesterId: studentId },
      include: { messages: { where: { isInternalNote: false }, orderBy: { createdAt: 'asc' } } },
    });
    if (!t) throw AppException.notFound('Request not found');
    const people = await this.people(t.messages.map((m) => m.authorId));
    return {
      id: t.id, number: t.number, subject: t.subject, category: t.category, status: t.status, createdAt: t.createdAt, lastActivityAt: t.lastActivityAt,
      messages: t.messages.map((m) => ({ id: m.id, body: m.body, isStaff: m.isStaff, createdAt: m.createdAt, author: { fullName: m.isStaff ? people.get(m.authorId)?.fullName ?? 'Academy team' : people.get(m.authorId)?.fullName ?? 'You' } })),
    };
  }

  async studentReply(tenantId: string, studentId: string, id: string, body: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, scope: ACADEMY, tenantId, requesterId: studentId } });
    if (!t) throw AppException.notFound('Request not found');
    if (t.status === 'CLOSED') throw AppException.conflict('This request is closed. Open a new one if you still need help.');
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({ data: { ticketId: id, authorId: studentId, body } }),
      this.prisma.supportTicket.update({ where: { id }, data: { lastActivityAt: new Date(), status: ['RESOLVED', 'PENDING'].includes(t.status) ? 'OPEN' : t.status } }),
    ]);
    await this.notifyAgents(tenantId, id, `Student replied on #${t.number}: ${t.subject}`, body, t.assigneeId);
    return this.getForStudent(tenantId, studentId, id);
  }

  async studentClose(tenantId: string, studentId: string, id: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, scope: ACADEMY, tenantId, requesterId: studentId } });
    if (!t) throw AppException.notFound('Request not found');
    await this.prisma.supportTicket.update({ where: { id }, data: { status: 'CLOSED', resolvedAt: t.resolvedAt ?? new Date(), lastActivityAt: new Date() } });
    return this.getForStudent(tenantId, studentId, id);
  }

  // ── academy team side ──────────────────────────────────────
  async listForTeam(tenantId: string, agentId: string, q: TicketListQuery) {
    const where: Prisma.SupportTicketWhereInput = {
      scope: ACADEMY,
      tenantId,
      ...(q.status ? { status: q.status as never } : { status: { notIn: ['CLOSED'] } }),
      ...(q.priority ? { priority: q.priority as never } : {}),
      ...(q.view === 'mine' ? { assigneeId: agentId } : q.view === 'unassigned' ? { assigneeId: null } : {}),
      ...(q.q ? { OR: [{ subject: { contains: q.q } }, ...(Number.isInteger(Number(q.q)) ? [{ number: Number(q.q) }] : [])] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.supportTicket.findMany({ where, orderBy: [{ lastActivityAt: 'desc' }], ...toSkipTake(q) }),
      this.prisma.supportTicket.count({ where }),
    ]);
    const people = await this.people(rows.flatMap((r) => [r.requesterId, r.assigneeId].filter(Boolean) as string[]));
    return new Paginated(
      rows.map((r) => ({ ...r, requester: people.get(r.requesterId) ?? null, assignee: r.assigneeId ? people.get(r.assigneeId) ?? null : null })),
      { page: q.page, pageSize: q.pageSize, total },
    );
  }

  async summary(tenantId: string, agentId: string) {
    const open = { scope: ACADEMY, tenantId, status: { notIn: ['RESOLVED', 'CLOSED'] } } satisfies Prisma.SupportTicketWhereInput;
    const [byStatus, unassigned, mine] = await Promise.all([
      this.prisma.supportTicket.groupBy({ by: ['status'], where: { scope: ACADEMY, tenantId }, _count: { _all: true } }),
      this.prisma.supportTicket.count({ where: { ...open, assigneeId: null } }),
      this.prisma.supportTicket.count({ where: { ...open, assigneeId: agentId } }),
    ]);
    return { byStatus: Object.fromEntries(byStatus.map((c) => [c.status, c._count._all])), unassigned, mine };
  }

  async getForTeam(tenantId: string, id: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, scope: ACADEMY, tenantId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!t) throw AppException.notFound('Ticket not found');
    const people = await this.people([t.requesterId, ...(t.assigneeId ? [t.assigneeId] : []), ...t.messages.map((m) => m.authorId)]);
    return {
      ...t,
      requester: people.get(t.requesterId) ?? null,
      assignee: t.assigneeId ? people.get(t.assigneeId) ?? null : null,
      messages: t.messages.map((m) => ({ ...m, author: people.get(m.authorId) ?? null })),
    };
  }

  async teamReply(tenantId: string, id: string, agentId: string, dto: TicketReplyDto) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, scope: ACADEMY, tenantId } });
    if (!t) throw AppException.notFound('Ticket not found');
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({ data: { ticketId: id, authorId: agentId, body: dto.body, isStaff: true, isInternalNote: Boolean(dto.internal) } }),
      this.prisma.supportTicket.update({
        where: { id },
        data: dto.internal
          ? { lastActivityAt: new Date() }
          : { lastActivityAt: new Date(), firstResponseAt: t.firstResponseAt ?? new Date(), status: t.status === 'OPEN' ? 'PENDING' : t.status, assigneeId: t.assigneeId ?? agentId },
      }),
    ]);
    if (!dto.internal) await this.notifyStudent(tenantId, t.requesterId, t.id, `New reply on your request #${t.number}`, dto.body);
    return this.getForTeam(tenantId, id);
  }

  async update(tenantId: string, id: string, dto: TicketUpdateDto) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, scope: ACADEMY, tenantId } });
    if (!t) throw AppException.notFound('Ticket not found');
    if (dto.assigneeId && !(await this.agents(tenantId)).some((a) => a.id === dto.assigneeId)) {
      throw AppException.validation([{ field: 'assigneeId', message: 'Assignee must be a team member who handles support' }]);
    }
    await this.prisma.supportTicket.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status, resolvedAt: dto.status === 'RESOLVED' || dto.status === 'CLOSED' ? new Date() : null } : {}),
        ...(dto.priority ? { priority: dto.priority } : {}),
        ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
        lastActivityAt: new Date(),
      },
    });
    if (dto.status === 'RESOLVED' && t.status !== 'RESOLVED') await this.notifyStudent(tenantId, t.requesterId, t.id, `Request #${t.number} marked resolved`, 'Reply if you still need help — the request will reopen.');
    return this.getForTeam(tenantId, id);
  }

  team(tenantId: string) {
    return this.agents(tenantId);
  }

  private async notifyAgents(tenantId: string, ticketId: string, title: string, body: string, onlyUserId?: string | null) {
    const agents = await this.agents(tenantId);
    const targets = onlyUserId && agents.some((a) => a.id === onlyUserId) ? agents.filter((a) => a.id === onlyUserId) : agents;
    for (const a of targets) {
      await this.notifications.notify({ userId: a.id, tenantId, category: 'community', title, body: body.slice(0, 200), link: `/creator/helpdesk/${ticketId}`, brand: 'Help desk', skipEmail: true }).catch(() => undefined);
    }
  }

  private async notifyStudent(tenantId: string, userId: string, ticketId: string, title: string, body: string) {
    const { origin, name } = await academyOrigin(this.prisma, this.config, tenantId);
    await this.notifications.notify({ userId, tenantId, category: 'learning', title, body: body.slice(0, 200), link: `/learn/support/${ticketId}`, url: `${origin}/learn/support/${ticketId}`, brand: name }).catch(() => undefined);
  }
}
