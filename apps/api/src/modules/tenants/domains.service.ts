import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppConfig } from '../../config/app-config.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { HostResolverService } from '../../core/tenancy/host-resolver.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { DnsVerifier, VERIFY_PREFIX } from './dns-verifier.js';

/**
 * Custom domain management for the current tenant. All reads/writes go through the
 * tenant-scoped client, so a domain id from another tenant simply does not exist here.
 */
@Injectable()
export class DomainsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly dns: DnsVerifier,
    private readonly hosts: HostResolverService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  private present<T extends { hostname: string; verificationToken: string; type: string }>(d: T) {
    const { verificationToken, ...rest } = d;
    const root = this.config.get('PLATFORM_ROOT_DOMAIN');
    return {
      ...rest,
      dnsInstructions:
        d.type === 'CUSTOM'
          ? [
              { type: 'CNAME', name: d.hostname, value: `tenants.${root}`, purpose: 'Routes traffic to your academy' },
              { type: 'TXT', name: `${VERIFY_PREFIX}.${d.hostname}`, value: `ce-verify=${verificationToken}`, purpose: 'Proves you own this domain' },
            ]
          : [],
    };
  }

  async list() {
    const rows = await this.db.tenantDomain.findMany({ orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] });
    return rows.map((d) => this.present(d));
  }

  async add(hostname: string, actorUserId: string) {
    const root = this.config.get('PLATFORM_ROOT_DOMAIN');
    if (hostname === root || hostname.endsWith(`.${root}`)) {
      throw AppException.validation([{ field: 'hostname', message: `Use your own domain, not a ${root} address` }]);
    }
    // Global uniqueness check must look across tenants (without revealing which tenant owns it).
    const taken = await this.prisma.tenantDomain.findUnique({ where: { hostname }, select: { id: true } });
    if (taken) throw AppException.conflict('This domain is already connected to an academy.');
    const domain = await this.db.tenantDomain.create({
      data: { hostname, type: 'CUSTOM', status: 'PENDING', verificationToken: randomBytes(16).toString('hex') } as never,
    });
    await this.audit.record({ action: 'domain.add', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'TenantDomain', targetId: domain.id, after: { hostname } });
    return this.present(domain);
  }

  private async get(id: string) {
    const d = await this.db.tenantDomain.findUnique({ where: { id } });
    if (!d) throw AppException.notFound('Domain not found');
    return d;
  }

  async verify(id: string) {
    const d = await this.get(id);
    if (d.type !== 'CUSTOM') return this.present(d);
    const result = await this.dns.hasToken(d.hostname, d.verificationToken);
    const updated = await this.db.tenantDomain.update({
      where: { id },
      data: result.ok
        ? { status: 'VERIFIED', verifiedAt: d.verifiedAt ?? new Date(), lastCheckedAt: new Date(), lastCheckError: null }
        : { status: d.status === 'VERIFIED' ? 'VERIFIED' : 'FAILED', lastCheckedAt: new Date(), lastCheckError: result.error?.slice(0, 255) },
    });
    await this.hosts.invalidate(d.hostname);
    return this.present(updated);
  }

  async makePrimary(id: string, actorUserId: string) {
    const d = await this.get(id);
    if (d.status !== 'VERIFIED') throw AppException.validation([{ field: 'id', message: 'Verify the domain before making it primary' }]);
    await this.db.tenantDomain.updateMany({ where: { isPrimary: true }, data: { isPrimary: false } });
    const updated = await this.db.tenantDomain.update({ where: { id }, data: { isPrimary: true } });
    await this.audit.record({ action: 'domain.primary', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'TenantDomain', targetId: id });
    return this.present(updated);
  }

  async remove(id: string, actorUserId: string) {
    const d = await this.get(id);
    if (d.type === 'SUBDOMAIN') throw AppException.validation([{ field: 'id', message: 'The default subdomain cannot be removed' }]);
    await this.db.tenantDomain.delete({ where: { id } });
    if (d.isPrimary) await this.db.tenantDomain.updateMany({ where: { type: 'SUBDOMAIN' }, data: { isPrimary: true } });
    await this.hosts.invalidate(d.hostname);
    await this.audit.record({ action: 'domain.remove', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'TenantDomain', targetId: id, before: { hostname: d.hostname } });
    return { removed: true };
  }
}
