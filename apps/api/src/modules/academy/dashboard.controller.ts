import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantScoped } from '../../common/decorators/auth.decorators.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';

/** Creator dashboard widgets from live data. Revenue/enrolment widgets join as those modules ship. */
@ApiTags('Creator · Dashboard')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/dashboard', version: '1' })
export class CreatorDashboardController {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Workspace KPIs, recent activity and plan usage' })
  async get() {
    const tenantId = this.ctx.requireTenantId();
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [byStatus, students, newStudents, staff, activity, ent, storage] = await Promise.all([
      this.db.course.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.user.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.user.count({ where: { tenantId, createdAt: { gte: since } } }),
      this.db.tenantMember.count({ where: { status: 'ACTIVE' } }),
      this.prisma.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, action: true, createdAt: true, actorUserId: true } }),
      this.entitlements.get(tenantId),
      this.db.fileAsset.aggregate({ where: { status: 'READY' }, _sum: { sizeBytes: true } }),
    ]);
    const courses = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
    const actors = await this.prisma.user.findMany({ where: { id: { in: activity.map((a) => a.actorUserId).filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
    return {
      courses: { total: Object.entries(courses).filter(([k]) => k !== 'ARCHIVED').reduce((s, [, v]) => s + v, 0), published: courses.PUBLISHED ?? 0, draft: (courses.DRAFT ?? 0) + (courses.UNPUBLISHED ?? 0), scheduled: courses.SCHEDULED ?? 0 },
      students: { total: students, newLast30Days: newStudents },
      staff,
      usage: {
        courses: { used: (courses.DRAFT ?? 0) + (courses.PUBLISHED ?? 0) + (courses.SCHEDULED ?? 0) + (courses.UNPUBLISHED ?? 0), limit: ent.features['courses.max']?.limit ?? null },
        students: { used: students, limit: ent.features['students.max']?.limit ?? null },
        storageBytes: { used: Number(storage._sum.sizeBytes ?? 0), limit: ent.features['storage.gb']?.limit != null ? ent.features['storage.gb'].limit! * 1024 ** 3 : null },
      },
      plan: { name: ent.planName, status: ent.status },
      activity: activity.map((a) => ({ ...a, actor: actors.find((u) => u.id === a.actorUserId)?.fullName ?? null })),
      revenue: { available: false, reason: 'Revenue appears once payments are enabled.' },
    };
  }
}
