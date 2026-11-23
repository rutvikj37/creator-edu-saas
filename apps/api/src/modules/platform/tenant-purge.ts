import type { PrismaService } from '../../core/prisma/prisma.service.js';
import type { AuditService } from '../../core/audit/audit.service.js';
import type { HostResolverService } from '../../core/tenancy/host-resolver.service.js';

export interface PurgeDeps {
  prisma: PrismaService;
  hosts: HostResolverService;
  audit: AuditService;
  /** Revokes every session of a user. Defaults to marking DB sessions revoked (refresh tokens stop working). */
  revokeUserSessions?: (userId: string, reason: string) => Promise<unknown>;
}

export interface PurgeActor {
  userId: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Finalizes tenants whose deletion retention window has passed: releases their hostnames,
 * marks them DELETED and signs out their students. Financial records are never deleted.
 * Shared by the manual Super Admin endpoint and the scheduled maintenance job.
 */
export async function purgeExpiredTenants(deps: PurgeDeps, actor?: PurgeActor) {
  const { prisma, hosts, audit } = deps;
  const revoke =
    deps.revokeUserSessions ??
    ((userId: string, reason: string) => prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } }));

  const expired = await prisma.tenant.findMany({
    where: { status: 'PENDING_DELETION', deletionScheduledAt: { lte: new Date() } },
    select: { id: true, slug: true },
  });

  for (const t of expired) {
    const domains = await prisma.tenantDomain.findMany({ where: { tenantId: t.id }, select: { hostname: true } });
    await prisma.$transaction([prisma.tenantDomain.deleteMany({ where: { tenantId: t.id } }), prisma.tenant.update({ where: { id: t.id }, data: { status: 'DELETED' } })]);
    await hosts.invalidate(...domains.map((d) => d.hostname));

    const students = await prisma.user.findMany({ where: { tenantId: t.id }, select: { id: true } });
    for (const s of students) await revoke(s.id, 'tenant_purged');

    await audit.record({
      action: 'tenant.purged',
      tenantId: t.id,
      actorUserId: actor?.userId ?? null,
      actorRealm: actor ? 'PLATFORM' : 'SYSTEM',
      targetType: 'Tenant',
      targetId: t.id,
      after: { status: 'DELETED', slug: t.slug },
      ip: actor?.ip,
      userAgent: actor?.userAgent,
    });
  }

  return { purgedCount: expired.length, tenants: expired.map((e) => e.slug) };
}
