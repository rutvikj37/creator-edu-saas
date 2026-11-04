import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { Paginated } from '../../common/interceptors/response-envelope.interceptor.js';
import { toOrderBy, toSkipTake } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { HostResolverService } from '../../core/tenancy/host-resolver.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { SessionService } from '../auth/services/session.service.js';
import type { AssignPlanDto, LimitOverridesDto, TenantListQuery } from './dto/platform.dto.js';

/** Days a tenant stays restorable after a deletion request (data is retained; financial records are never deleted). */
export const DELETION_RETENTION_DAYS = 30;

interface Actor {
  userId: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Cross-tenant administration. Uses the root Prisma client intentionally: these endpoints are
 * restricted to platform roles by permission guards and every mutation is audited.
 */
@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly hosts: HostResolverService,
    private readonly subscriptions: SubscriptionsService,
    private readonly entitlements: EntitlementsService,
    private readonly sessions: SessionService,
  ) {}

  async list(q: TenantListQuery) {
    const where: Prisma.TenantWhereInput = {
      ...(q.status ? { status: q.status as never } : { status: { not: 'DELETED' } }),
      ...(q.q ? { OR: [{ name: { contains: q.q } }, { slug: { contains: q.q } }, { owner: { email: { contains: q.q } } }] } : {}),
      ...(q.planId ? { subscriptions: { some: { currentKey: 'current', planId: q.planId } } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        orderBy: toOrderBy(q.sort, ['createdAt', 'name', 'status'] as const, { createdAt: 'desc' }),
        ...toSkipTake(q),
        select: {
          id: true, name: true, slug: true, status: true, country: true, createdAt: true,
          owner: { select: { id: true, fullName: true, email: true } },
          subscriptions: { where: { currentKey: 'current' }, select: { status: true, plan: { select: { id: true, name: true } } } },
          _count: { select: { users: true, members: true } },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return new Paginated(
      rows.map(({ subscriptions, _count, ...t }) => ({ ...t, subscription: subscriptions[0] ?? null, studentCount: _count.users, staffCount: _count.members })),
      { page: q.page, pageSize: q.pageSize, total },
    );
  }

  private async get(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t || t.status === 'DELETED') throw AppException.notFound('Tenant not found');
    return t;
  }

  async detail(id: string) {
    await this.get(id);
    const t = await this.prisma.tenant.findUniqueOrThrow({
      where: { id },
      include: {
        owner: { select: { id: true, fullName: true, email: true, phone: true, emailVerifiedAt: true, lastLoginAt: true } },
        domains: { orderBy: { createdAt: 'asc' }, select: { id: true, hostname: true, type: true, status: true, isPrimary: true, createdAt: true } },
        members: { select: { id: true, status: true, createdAt: true, role: { select: { key: true, name: true } }, user: { select: { id: true, fullName: true, email: true } } } },
        limitOverrides: true,
      },
    });
    const [subscription, entitlements, studentCount, recentActivity, subscriptionHistory] = await Promise.all([
      this.subscriptions.current(id),
      this.entitlements.get(id),
      this.prisma.user.count({ where: { tenantId: id, deletedAt: null } }),
      this.prisma.auditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, action: true, actorUserId: true, createdAt: true, targetType: true } }),
      this.prisma.subscription.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, status: true, source: true, createdAt: true, canceledAt: true, plan: { select: { name: true } } } }),
    ]);
    return {
      ...t,
      limitOverrides: t.limitOverrides.map((o) => ({ ...o, limitValue: o.limitValue === null ? null : Number(o.limitValue) })),
      subscription,
      entitlements,
      subscriptionHistory,
      usage: {
        students: studentCount,
        staff: t.members.length,
        customDomains: t.domains.filter((d) => d.type === 'CUSTOM').length,
      },
      recentActivity,
    };
  }

  private async setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED', actor: Actor, reason?: string) {
    const t = await this.get(id);
    if (t.status === 'PENDING_DELETION') throw AppException.conflict('Restore the tenant before changing its status.');
    const updated = await this.prisma.tenant.update({ where: { id }, data: { status, suspendedReason: status === 'SUSPENDED' ? reason : null } });
    await this.invalidateHosts(id);
    await this.audit.record({ action: status === 'SUSPENDED' ? 'tenant.suspend' : 'tenant.activate', tenantId: id, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Tenant', targetId: id, before: { status: t.status }, after: { status, reason }, ip: actor.ip, userAgent: actor.userAgent });
    return updated;
  }

  activate(id: string, actor: Actor) {
    return this.setStatus(id, 'ACTIVE', actor);
  }

  async suspend(id: string, reason: string, actor: Actor) {
    const t = await this.setStatus(id, 'SUSPENDED', actor, reason);
    // Sign students out of the suspended academy immediately.
    const students = await this.prisma.user.findMany({ where: { tenantId: id }, select: { id: true } });
    for (const s of students) await this.sessions.revokeAllForUser(s.id, 'tenant_suspended');
    return t;
  }

  async scheduleDeletion(id: string, confirmSlug: string, actor: Actor) {
    const t = await this.get(id);
    if (confirmSlug !== t.slug) throw AppException.validation([{ field: 'confirmSlug', message: 'Type the academy slug exactly to confirm' }]);
    const at = new Date(Date.now() + DELETION_RETENTION_DAYS * 86_400_000);
    const updated = await this.prisma.tenant.update({ where: { id }, data: { status: 'PENDING_DELETION', deletionScheduledAt: at } });
    await this.invalidateHosts(id);
    await this.audit.record({ action: 'tenant.delete_scheduled', tenantId: id, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Tenant', targetId: id, after: { deletionScheduledAt: at }, ip: actor.ip, userAgent: actor.userAgent });
    return updated;
  }

  async restore(id: string, actor: Actor) {
    const t = await this.get(id);
    if (t.status !== 'PENDING_DELETION') throw AppException.conflict('Tenant is not scheduled for deletion.');
    const updated = await this.prisma.tenant.update({ where: { id }, data: { status: 'ACTIVE', deletionScheduledAt: null } });
    await this.invalidateHosts(id);
    await this.audit.record({ action: 'tenant.restore', tenantId: id, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Tenant', targetId: id, ip: actor.ip, userAgent: actor.userAgent });
    return updated;
  }

  async assignPlan(id: string, dto: AssignPlanDto, actor: Actor) {
    await this.get(id);
    const before = await this.subscriptions.current(id);
    const sub = await this.prisma.$transaction((tx) => this.subscriptions.assignPlan(tx, { tenantId: id, planId: dto.planId, planPriceId: dto.planPriceId, source: 'admin', allowTrial: false }));
    await this.subscriptions.afterChange(id);
    await this.audit.record({ action: 'subscription.change', tenantId: id, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Subscription', targetId: sub.id, before: { planId: before?.planId ?? null }, after: { planId: dto.planId, planPriceId: dto.planPriceId ?? null }, ip: actor.ip, userAgent: actor.userAgent });
    return this.subscriptions.current(id);
  }

  async setOverrides(id: string, dto: LimitOverridesDto, actor: Actor) {
    await this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.tenantLimitOverride.deleteMany({ where: { tenantId: id, featureKey: { notIn: dto.overrides.map((o) => o.featureKey) } } });
      for (const o of dto.overrides) {
        const data = { enabled: o.enabled, limitValue: o.limitValue === undefined || o.limitValue === null ? null : BigInt(o.limitValue), reason: o.reason, setById: actor.userId };
        await tx.tenantLimitOverride.upsert({ where: { tenantId_featureKey: { tenantId: id, featureKey: o.featureKey } }, update: data, create: { tenantId: id, featureKey: o.featureKey, ...data } });
      }
    });
    await this.entitlements.invalidate(id);
    await this.audit.record({ action: 'tenant.limits_update', tenantId: id, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Tenant', targetId: id, after: { overrides: dto.overrides }, ip: actor.ip, userAgent: actor.userAgent });
    return this.entitlements.get(id);
  }

  private async invalidateHosts(id: string) {
    const domains = await this.prisma.tenantDomain.findMany({ where: { tenantId: id }, select: { hostname: true } });
    await this.hosts.invalidate(...domains.map((d) => d.hostname));
  }
}
