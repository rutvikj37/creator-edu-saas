import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { ClientMetaParam, CurrentAuth, RequirePermissions, RequireRealm } from '../../common/decorators/auth.decorators.js';
import { AppException } from '../../common/errors/app-exception.js';
import { Paginated } from '../../common/interceptors/response-envelope.interceptor.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { HostResolverService } from '../../core/tenancy/host-resolver.service.js';
import { AppConfig } from '../../config/app-config.service.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import type { ClientMeta } from '../auth/services/session.service.js';
import { DnsVerifier } from '../tenants/dns-verifier.js';

class DomainsQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['PENDING', 'VERIFIED', 'FAILED']) status?: 'PENDING' | 'VERIFIED' | 'FAILED';
  @ApiPropertyOptional() @IsOptional() @IsIn(['SUBDOMAIN', 'CUSTOM']) type?: 'SUBDOMAIN' | 'CUSTOM';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

/** Every academy's hostnames: custom-domain verification status, re-checks and removal of abusive domains. */
@ApiTags('Platform · Domains')
@ApiBearerAuth()
@RequireRealm('PLATFORM')
@Controller({ path: 'platform/domains', version: '1' })
export class PlatformDomainsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dns: DnsVerifier,
    private readonly hosts: HostResolverService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_READ)
  @ApiOperation({ summary: 'All academy domains' })
  async list(@Query() q: DomainsQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const search = q.q?.trim();
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(search ? { OR: [{ hostname: { contains: search.toLowerCase() } }, { tenant: { name: { contains: search } } }, { tenant: { slug: { contains: search.toLowerCase() } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.tenantDomain.findMany({
        where, orderBy: [{ type: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, hostname: true, type: true, isPrimary: true, status: true, verifiedAt: true, lastCheckedAt: true, lastCheckError: true, createdAt: true, tenant: { select: { id: true, name: true, slug: true, status: true } } },
      }),
      this.prisma.tenantDomain.count({ where }),
    ]);
    return new Paginated(rows, { page, pageSize, total });
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_READ)
  @ApiOperation({ summary: 'Domain counts by type and verification status' })
  async summary() {
    const rows = await this.prisma.tenantDomain.groupBy({ by: ['type', 'status'], _count: { _all: true } });
    const n = (type: string, status?: string) => rows.filter((r) => r.type === type && (!status || r.status === status)).reduce((s, r) => s + r._count._all, 0);
    return {
      subdomains: n('SUBDOMAIN'), custom: n('CUSTOM'), customVerified: n('CUSTOM', 'VERIFIED'), customPending: n('CUSTOM', 'PENDING'), customFailed: n('CUSTOM', 'FAILED'),
      rootDomain: this.config.get('PLATFORM_ROOT_DOMAIN'), cnameTarget: `tenants.${this.config.get('PLATFORM_ROOT_DOMAIN')}`,
    };
  }

  @Post(':id/verify')
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  @ApiOperation({ summary: 'Re-check the DNS ownership record of a custom domain now' })
  async verify(@Param('id') id: string) {
    const d = await this.prisma.tenantDomain.findUnique({ where: { id } });
    if (!d) throw AppException.notFound('Domain not found');
    if (d.type !== 'CUSTOM') throw AppException.validation([{ field: 'id', message: 'Platform subdomains do not need verification' }]);
    const result = await this.dns.hasToken(d.hostname, d.verificationToken);
    const updated = await this.prisma.tenantDomain.update({
      where: { id },
      data: result.ok
        ? { status: 'VERIFIED', verifiedAt: d.verifiedAt ?? new Date(), lastCheckedAt: new Date(), lastCheckError: null }
        : { status: d.status === 'VERIFIED' ? 'VERIFIED' : 'FAILED', lastCheckedAt: new Date(), lastCheckError: result.error?.slice(0, 255) },
      select: { id: true, hostname: true, status: true, verifiedAt: true, lastCheckedAt: true, lastCheckError: true },
    });
    await this.hosts.invalidate(d.hostname);
    return { ...updated, ok: result.ok };
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  @ApiOperation({ summary: 'Detach a custom domain from its academy (e.g. abuse or a dispute)' })
  async remove(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    const d = await this.prisma.tenantDomain.findUnique({ where: { id }, include: { tenant: { select: { slug: true } } } });
    if (!d) throw AppException.notFound('Domain not found');
    if (d.type !== 'CUSTOM') throw AppException.validation([{ field: 'id', message: 'Only custom domains can be detached here' }]);
    await this.prisma.$transaction(async (tx) => {
      await tx.tenantDomain.delete({ where: { id } });
      if (d.isPrimary) await tx.tenantDomain.updateMany({ where: { tenantId: d.tenantId, hostname: `${d.tenant.slug}.${this.config.get('PLATFORM_ROOT_DOMAIN')}` }, data: { isPrimary: true } });
    });
    await this.hosts.invalidate(d.hostname);
    await this.audit.record({ action: 'domain.detach', tenantId: d.tenantId, actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'TenantDomain', targetId: id, before: { hostname: d.hostname, status: d.status }, ip: meta.ip, userAgent: meta.userAgent });
    return { removed: true };
  }
}
