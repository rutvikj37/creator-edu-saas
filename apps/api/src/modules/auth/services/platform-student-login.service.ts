import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../../config/app-config.service.js';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import type { AuthContext, HostRealm } from '../../../core/tenancy/request-context.js';

/**
 * Temporary TechX bridge: when PLATFORM_STUDENT_LOGIN_TENANT is set (academy slug or
 * verified custom domain), learners of that academy may sign in and use /learn on the
 * platform host (e.g. lms.techxsolutions.io) as well as on their academy domain.
 *
 * Unset = feature off (platform host stays platform-realm only). Do not open arbitrary
 * cross-tenant login — only this configured academy is eligible.
 */
@Injectable()
export class PlatformStudentLoginService {
  private cache: { key: string; id: string | null; at: number } | null = null;
  private testOverride: string | null | undefined = undefined;
  private readonly ttlMs = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** Configured academy tenant id, or null when the bridge is disabled / not found. */
  async allowedTenantId(): Promise<string | null> {
    if (this.testOverride !== undefined) return this.testOverride;
    const key = (this.config.get('PLATFORM_STUDENT_LOGIN_TENANT') ?? '').trim().toLowerCase();
    if (!key) return null;
    if (this.cache && this.cache.key === key && Date.now() - this.cache.at < this.ttlMs) {
      return this.cache.id;
    }
    const bySlug = await this.prisma.tenant.findFirst({
      where: { slug: key, status: { not: 'DELETED' } },
      select: { id: true },
    });
    if (bySlug) {
      this.cache = { key, id: bySlug.id, at: Date.now() };
      return bySlug.id;
    }
    const byDomain = await this.prisma.tenantDomain.findFirst({
      where: { hostname: key, status: 'VERIFIED', tenant: { status: { not: 'DELETED' } } },
      select: { tenantId: true },
    });
    // Misses are not cached long — tenant may be provisioned right after deploy.
    this.cache = { key, id: byDomain?.tenantId ?? null, at: Date.now() - (byDomain ? 0 : this.ttlMs - 5_000) };
    return byDomain?.tenantId ?? null;
  }

  /** True when a TENANT session for the configured academy may call APIs on the platform host. */
  async studentAllowedOnPlatformHost(
    auth: Pick<AuthContext, 'realm' | 'realmKey'>,
    host: HostRealm,
  ): Promise<boolean> {
    if (host.kind !== 'platform' || auth.realm !== 'TENANT') return false;
    const allowed = await this.allowedTenantId();
    return Boolean(allowed && auth.realmKey === allowed);
  }

  /** Test helper: pin the allowlist without waiting for env/slug resolution. */
  setAllowedTenantIdForTests(tenantId: string | null) {
    this.testOverride = tenantId;
  }
}
