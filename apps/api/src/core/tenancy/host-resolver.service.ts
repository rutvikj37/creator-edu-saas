import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AppConfig } from '../../config/app-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import type { HostRealm } from './request-context.js';

const CACHE_TTL_SECONDS = 60;
const NOT_FOUND = '__none__';

/** Subdomains that can never be tenant slugs. */
export const RESERVED_SLUGS = new Set([
  'app', 'api', 'www', 'admin', 'mail', 'smtp', 'static', 'assets', 'cdn', 'help', 'support', 'status', 'docs', 'blog',
  'billing', 'auth', 'login', 'signup', 'dashboard', 'platform', 'tenants', 'media', 'files', 'webhooks', 'dev', 'staging', 'test',
]);

/**
 * Maps a request hostname to the platform or to a tenant:
 *   app.<root>, api.<root>, <root>, www.<root>, localhost → platform
 *   <slug>.<root>                                           → tenant by slug
 *   any other host                                          → tenant by VERIFIED custom domain
 * Results (including misses) are cached in Redis and invalidated on domain/tenant changes.
 */
@Injectable()
export class HostResolverService {
  private readonly root: string;
  private readonly platformHosts: Set<string>;

  constructor(
    config: AppConfig,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.root = config.get('PLATFORM_ROOT_DOMAIN').toLowerCase();
    this.platformHosts = new Set([
      config.get('APP_HOST').toLowerCase(),
      this.root,
      `www.${this.root}`,
      `api.${this.root}`,
      `admin.${this.root}`,
      'localhost',
      '127.0.0.1',
    ]);
  }

  static cacheKey(hostname: string) {
    return `host:${hostname}`;
  }

  async invalidate(...hostnames: string[]) {
    if (hostnames.length) await this.redis.del(...hostnames.map((h) => HostResolverService.cacheKey(h.toLowerCase())));
  }

  async resolve(rawHostname: string | undefined): Promise<HostRealm | null> {
    const hostname = (rawHostname ?? '').toLowerCase().replace(/\.$/, '');
    if (!hostname || this.platformHosts.has(hostname)) return { kind: 'platform' };

    const cached = await this.redis.get(HostResolverService.cacheKey(hostname));
    if (cached) return cached === NOT_FOUND ? null : (JSON.parse(cached) as HostRealm);

    const result = await this.lookup(hostname);
    await this.redis.set(HostResolverService.cacheKey(hostname), result ? JSON.stringify(result) : NOT_FOUND, 'EX', CACHE_TTL_SECONDS);
    return result;
  }

  private async lookup(hostname: string): Promise<HostRealm | null> {
    const suffix = `.${this.root}`;
    if (hostname.endsWith(suffix)) {
      const slug = hostname.slice(0, -suffix.length);
      if (slug.includes('.') || RESERVED_SLUGS.has(slug)) return null;
      const t = await this.prisma.tenant.findUnique({ where: { slug }, select: { id: true, slug: true, status: true } });
      return t && t.status !== 'DELETED' ? { kind: 'tenant', tenantId: t.id, slug: t.slug, status: t.status, hostname } : null;
    }
    const domain = await this.prisma.tenantDomain.findUnique({
      where: { hostname },
      select: { status: true, tenant: { select: { id: true, slug: true, status: true } } },
    });
    if (!domain || domain.status !== 'VERIFIED' || domain.tenant.status === 'DELETED') return null;
    return { kind: 'tenant', tenantId: domain.tenant.id, slug: domain.tenant.slug, status: domain.tenant.status, hostname };
  }
}
