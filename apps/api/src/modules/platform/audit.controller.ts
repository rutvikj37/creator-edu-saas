import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@ce/shared';
import { RequirePermissions, RequireRealm } from '../../common/decorators/auth.decorators.js';
import { Paginated } from '../../common/interceptors/response-envelope.interceptor.js';
import { toSkipTake } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditQuery } from './dto/platform.dto.js';

@ApiTags('Platform · Audit')
@ApiBearerAuth()
@RequireRealm('PLATFORM')
@RequirePermissions(PERMISSIONS.PLATFORM_AUDIT_READ)
@Controller({ path: 'platform/audit-logs', version: '1' })
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: q.sort === 'createdAt' ? 'asc' : 'desc' }, ...toSkipTake(q) }),
      this.prisma.auditLog.count({ where }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))] as string[];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, email: true } });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return new Paginated(rows.map((r) => ({ ...r, actor: r.actorUserId ? (byId.get(r.actorUserId) ?? null) : null })), { page: q.page, pageSize: q.pageSize, total });
  }
}
