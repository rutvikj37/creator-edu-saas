import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { MFA_REQUIRED_ROLES } from '@ce/shared';
import { AppConfig } from '../../config/app-config.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../core/redis/redis.constants.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';

const TTL_SECONDS = 60;

/**
 * Resolves effective permissions: platform role grants + the role of the user's membership
 * in the active tenant workspace. Cached briefly in Redis; call invalidate() on role changes.
 */
@Injectable()
export class AuthzService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: AppConfig,
  ) {}

  private key(userId: string, tenantId: string | null) {
    return `perms:${userId}:${tenantId ?? '-'}`;
  }

  async invalidate(userId: string) {
    const keys = await this.redis.keys(`perms:${userId}:*`);
    if (keys.length) await this.redis.del(...keys);
  }

  async platformRoleKeys(userId: string): Promise<string[]> {
    const roles = await this.prisma.userRole.findMany({ where: { userId }, select: { role: { select: { key: true } } } });
    return roles.map((r) => r.role.key);
  }

  async requiresMfa(userId: string): Promise<boolean> {
    if (!this.config.isProduction && this.config.get('ADMIN_MFA_REQUIRED') === false) return false;
    const keys = await this.platformRoleKeys(userId);
    return keys.some((k) => MFA_REQUIRED_ROLES.includes(k));
  }

  async permissions(auth: Pick<AuthContext, 'userId' | 'realm' | 'tenantId'>): Promise<Set<string>> {
    if (auth.realm !== 'PLATFORM') return new Set(); // students/affiliates: no administrative permissions
    const cacheKey = this.key(auth.userId, auth.tenantId);
    const cached = await this.redis.get(cacheKey);
    if (cached) return new Set(JSON.parse(cached) as string[]);

    const perms = new Set<string>();
    const platform = await this.prisma.userRole.findMany({
      where: { userId: auth.userId },
      select: { role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } },
    });
    platform.forEach((r) => r.role.permissions.forEach((p) => perms.add(p.permission.key)));

    if (auth.tenantId) {
      const member = await this.prisma.tenantMember.findUnique({
        where: { tenantId_userId: { tenantId: auth.tenantId, userId: auth.userId } },
        select: { status: true, role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } },
      });
      if (member?.status === 'ACTIVE') member.role.permissions.forEach((p) => perms.add(p.permission.key));
    }
    await this.redis.set(cacheKey, JSON.stringify([...perms]), 'EX', TTL_SECONDS);
    return perms;
  }
}
