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
import { isValidSlug } from './slug.js';

/** Branded subdomains per academy on the platform domain, including the one created at sign-up. */
export const MAX_SUBDOMAINS = 3;
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { FEATURES } from '@ce/shared';

/**
 * Domains of the current tenant, two kinds:
 *  - SUBDOMAIN: `<name>.<platform root>` — live instantly (covered by wildcard DNS/TLS), up to MAX_SUBDOMAINS.
 *  - CUSTOM: the creator's own domain — live after DNS ownership verification.
 * Domain management for the current tenant. All reads/writes go through the
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
    private readonly entitlements: EntitlementsService,
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
    const original = await this.originalHostname();
    return rows.map((d) => ({ ...this.present(d), isDefault: d.hostname === original }));
  }

  private async originalHostname() {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: this.ctx.requireTenantId() }, select: { slug: true } });
    return `${t.slug}.${this.config.get('PLATFORM_ROOT_DOMAIN')}`;
  }

  /** Why a subdomain name cannot be used, or null when it is free. Never reveals which academy holds it. */
  private async subdomainProblem(name: string): Promise<string | null> {
    if (!isValidSlug(name)) return '3–40 lowercase letters, digits or single hyphens; some names are reserved';
    const hostname = `${name}.${this.config.get('PLATFORM_ROOT_DOMAIN')}`;
    const [slugTaken, hostTaken] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { slug: name }, select: { id: true } }),
      this.prisma.tenantDomain.findUnique({ where: { hostname }, select: { id: true } }),
    ]);
    return slugTaken || hostTaken ? 'This subdomain is already taken' : null;
  }

  async subdomainAvailability(rawName: string) {
    const name = rawName.trim().toLowerCase();
    const problem = await this.subdomainProblem(name);
    return { name, hostname: `${name}.${this.config.get('PLATFORM_ROOT_DOMAIN')}`, available: !problem, reason: problem };
  }

  async addSubdomain(rawName: string, actorUserId: string) {
    const name = rawName.trim().toLowerCase();
    const problem = await this.subdomainProblem(name);
    if (problem) throw AppException.validation([{ field: 'name', message: problem }]);
    if ((await this.db.tenantDomain.count({ where: { type: 'SUBDOMAIN' } })) >= MAX_SUBDOMAINS) {
      throw AppException.validation([{ field: 'name', message: `You can have up to ${MAX_SUBDOMAINS} subdomains. Remove one first.` }]);
    }
    const hostname = `${name}.${this.config.get('PLATFORM_ROOT_DOMAIN')}`;
    let domain;
    try {
      domain = await this.db.tenantDomain.create({
        data: { hostname, type: 'SUBDOMAIN', status: 'VERIFIED', verifiedAt: new Date(), verificationToken: randomBytes(16).toString('hex') } as never,
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw AppException.validation([{ field: 'name', message: 'This subdomain is already taken' }]);
      throw e;
    }
    await this.hosts.invalidate(hostname);
    await this.audit.record({ action: 'domain.subdomain_add', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'TenantDomain', targetId: domain.id, after: { hostname } });
    return { ...this.present(domain), isDefault: false };
  }

  async add(hostname: string, actorUserId: string) {
    const root = this.config.get('PLATFORM_ROOT_DOMAIN');
    if (hostname === root || hostname.endsWith(`.${root}`)) {
      throw AppException.validation([{ field: 'hostname', message: `Use your own domain, not a ${root} address` }]);
    }
    // Global uniqueness check must look across tenants (without revealing which tenant owns it).
    const taken = await this.prisma.tenantDomain.findUnique({ where: { hostname }, select: { id: true } });
    if (taken) throw AppException.conflict('This domain is already connected to an academy.');
    const customCount = await this.db.tenantDomain.count({ where: { type: 'CUSTOM' } });
    await this.entitlements.assertWithinLimit(this.ctx.requireTenantId(), FEATURES.CUSTOM_DOMAINS.key, customCount);
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
    const original = await this.originalHostname();
    if (d.hostname === original) throw AppException.validation([{ field: 'id', message: 'The subdomain created with your academy cannot be removed' }]);
    await this.db.tenantDomain.delete({ where: { id } });
    if (d.isPrimary) await this.db.tenantDomain.updateMany({ where: { hostname: original }, data: { isPrimary: true } });
    await this.hosts.invalidate(d.hostname);
    await this.audit.record({ action: 'domain.remove', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'TenantDomain', targetId: id, before: { hostname: d.hostname } });
    return { removed: true };
  }
}
