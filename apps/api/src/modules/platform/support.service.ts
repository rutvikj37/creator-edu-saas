import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { Paginated } from '../../common/interceptors/response-envelope.interceptor.js';
import { toSkipTake } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { AppConfig } from '../../config/app-config.service.js';
import { escapeHtml } from '../../core/mail/templates.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CreateTicketDto, TicketListQuery, TicketReplyDto, TicketUpdateDto } from './dto/platform.dto.js';

const PRIORITY_SLA_HOURS: Record<string, number> = { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 };

/** Creator ↔ platform support. Internal notes are never returned to requesters. */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
  ) {}

  private async people(ids: string[]) {
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true, email: true } });
    return new Map(users.map((u) => [u.id, u]));
  }

  // ── requester side (creator workspace) ─────────────────────
  async create(tenantId: string, requesterId: string, dto: CreateTicketDto) {
    const t = await this.prisma.supportTicket.create({
      data: { tenantId, requesterId, subject: dto.subject, category: dto.category, priority: dto.priority, messages: { create: { authorId: requesterId, body: dto.body } } },
    });
    return this.getForRequester(tenantId, t.id);
  }

  async listForTenant(tenantId: string, q: TicketListQuery) {
    const where: Prisma.SupportTicketWhereInput = { tenantId, ...(q.status ? { status: q.status as never } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.supportTicket.findMany({ where, orderBy: { lastActivityAt: 'desc' }, ...toSkipTake(q) }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return new Paginated(rows, { page: q.page, pageSize: q.pageSize, total });
  }

  async getForRequester(tenantId: string, id: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, tenantId }, include: { messages: { where: { isInternalNote: false }, orderBy: { createdAt: 'asc' } } } });
    if (!t) throw AppException.notFound('Ticket not found');
    const people = await this.people(t.messages.map((m) => m.authorId));
    return { ...t, messages: t.messages.map((m) => ({ id: m.id, body: m.body, isStaff: m.isStaff, createdAt: m.createdAt, author: m.isStaff ? { fullName: 'Support team' } : people.get(m.authorId) })) };
  }

  async requesterReply(tenantId: string, id: string, authorId: string, body: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, tenantId } });
    if (!t) throw AppException.notFound('Ticket not found');
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({ data: { ticketId: id, authorId, body } }),
      this.prisma.supportTicket.update({ where: { id }, data: { lastActivityAt: new Date(), status: ['RESOLVED', 'CLOSED', 'PENDING'].includes(t.status) ? 'OPEN' : t.status } }),
    ]);
    return this.getForRequester(tenantId, id);
  }

  // ── support staff side ─────────────────────────────────────
  async listForStaff(staffId: string, q: TicketListQuery) {
    const where: Prisma.SupportTicketWhereInput = {
      ...(q.status ? { status: q.status as never } : { status: { notIn: ['CLOSED'] } }),
      ...(q.priority ? { priority: q.priority as never } : {}),
      ...(q.view === 'mine' ? { assigneeId: staffId } : q.view === 'unassigned' ? { assigneeId: null } : {}),
      ...(q.q ? { OR: [{ subject: { contains: q.q } }, ...(Number.isInteger(Number(q.q)) ? [{ number: Number(q.q) }] : [])] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.supportTicket.findMany({ where, orderBy: [{ lastActivityAt: 'desc' }], ...toSkipTake(q) }),
      this.prisma.supportTicket.count({ where }),
    ]);
    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId).filter(Boolean) as string[] } }, select: { id: true, name: true, slug: true } });
    const tById = new Map(tenants.map((t) => [t.id, t]));
    const people = await this.people(rows.flatMap((r) => [r.requesterId, r.assigneeId].filter(Boolean) as string[]));
    return new Paginated(
      rows.map((r) => ({
        ...r,
        tenant: r.tenantId ? tById.get(r.tenantId) ?? null : null,
        requester: people.get(r.requesterId) ?? null,
        assignee: r.assigneeId ? people.get(r.assigneeId) ?? null : null,
        slaDueAt: new Date(r.createdAt.getTime() + PRIORITY_SLA_HOURS[r.priority] * 3600_000),
      })),
      { page: q.page, pageSize: q.pageSize, total },
    );
  }

  async getForStaff(id: string) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!t) throw AppException.notFound('Ticket not found');
    const people = await this.people([t.requesterId, ...(t.assigneeId ? [t.assigneeId] : []), ...t.messages.map((m) => m.authorId)]);
    const tenant = t.tenantId ? await this.prisma.tenant.findUnique({ where: { id: t.tenantId }, select: { id: true, name: true, slug: true, status: true } }) : null;
    return {
      ...t,
      tenant,
      requester: people.get(t.requesterId) ?? null,
      assignee: t.assigneeId ? people.get(t.assigneeId) ?? null : null,
      messages: t.messages.map((m) => ({ ...m, author: people.get(m.authorId) ?? null })),
    };
  }

  async staffReply(id: string, staffId: string, dto: TicketReplyDto, origin: string) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!t) throw AppException.notFound('Ticket not found');
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({ data: { ticketId: id, authorId: staffId, body: dto.body, isStaff: true, isInternalNote: Boolean(dto.internal) } }),
      this.prisma.supportTicket.update({
        where: { id },
        data: dto.internal
          ? { lastActivityAt: new Date() }
          : { lastActivityAt: new Date(), firstResponseAt: t.firstResponseAt ?? new Date(), status: t.status === 'OPEN' ? 'PENDING' : t.status, assigneeId: t.assigneeId ?? staffId },
      }),
    ]);
    if (!dto.internal) {
      const requester = await this.prisma.user.findUnique({ where: { id: t.requesterId }, select: { email: true, fullName: true } });
      if (requester) {
        const url = `${origin}/creator/support/${t.id}`;
        await this.mail.send({
          to: requester.email,
          tag: 'support-reply',
          subject: `[#${t.number}] New reply: ${t.subject}`,
          html: `<p>Hi ${escapeHtml(requester.fullName)},</p><p>Our support team replied to your ticket <strong>#${t.number}</strong>.</p><p><a href="${escapeHtml(url)}">View the conversation</a></p>`,
          text: `Our support team replied to ticket #${t.number}: ${url}`,
        });
      }
    }
    return this.getForStaff(id);
  }

  async update(id: string, dto: TicketUpdateDto) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!t) throw AppException.notFound('Ticket not found');
    if (dto.assigneeId) {
      const ok = await this.prisma.userRole.findFirst({ where: { userId: dto.assigneeId, role: { key: { in: ['SUPPORT_ADMIN', 'SUPER_ADMIN'] } } } });
      if (!ok) throw AppException.validation([{ field: 'assigneeId', message: 'Assignee must be a support administrator' }]);
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
    return this.getForStaff(id);
  }

  async staffList() {
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', roles: { some: { role: { key: { in: ['SUPPORT_ADMIN', 'SUPER_ADMIN'] } } } } },
      select: { id: true, fullName: true, email: true },
    });
    return users;
  }

  async report() {
    const [byStatus, byPriority, resolved] = await Promise.all([
      this.prisma.supportTicket.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.supportTicket.groupBy({ by: ['priority'], where: { status: { notIn: ['RESOLVED', 'CLOSED'] } }, _count: { _all: true } }),
      this.prisma.supportTicket.findMany({ where: { firstResponseAt: { not: null } }, select: { createdAt: true, firstResponseAt: true, resolvedAt: true }, take: 1000, orderBy: { createdAt: 'desc' } }),
    ]);
    const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3600_000;
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
    return {
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      openByPriority: Object.fromEntries(byPriority.map((s) => [s.priority, s._count._all])),
      avgFirstResponseHours: avg(resolved.map((r) => hours(r.createdAt, r.firstResponseAt!))),
      avgResolutionHours: avg(resolved.filter((r) => r.resolvedAt).map((r) => hours(r.createdAt, r.resolvedAt!))),
    };
  }

  origin() {
    return this.config.get('WEB_PUBLIC_URL');
  }
}
