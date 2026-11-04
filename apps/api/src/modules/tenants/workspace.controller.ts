import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { DomainsService } from './domains.service.js';
import { AddDomainDto } from './dto/domain.dto.js';

@ApiTags('Creator workspace')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator', version: '1' })
export class WorkspaceController {
  constructor(
    private readonly domains: DomainsService,
    private readonly prisma: PrismaService,
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly ctx: TenantContext,
  ) {}

  @Get('workspace')
  @ApiOperation({ summary: 'Current academy workspace summary' })
  async workspace() {
    const tenantId = this.ctx.requireTenantId();
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true, status: true, country: true, defaultCurrency: true, timezone: true, locale: true, onboardingStep: true, onboardingCompletedAt: true, createdAt: true },
    });
    const primary = await this.db.tenantDomain.findFirst({ where: { isPrimary: true }, select: { hostname: true } });
    return { ...tenant, primaryHostname: primary?.hostname ?? null };
  }

  @Get('members')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @ApiOperation({ summary: 'Workspace members (owner and staff)' })
  async members() {
    const rows = await this.db.tenantMember.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, createdAt: true, role: { select: { key: true, name: true } }, user: { select: { id: true, fullName: true, email: true } } },
    });
    return rows;
  }

  @Get('domains')
  @RequirePermissions(PERMISSIONS.DOMAINS_MANAGE)
  listDomains() {
    return this.domains.list();
  }

  @Post('domains')
  @RequirePermissions(PERMISSIONS.DOMAINS_MANAGE)
  @ApiOperation({ summary: 'Connect a custom domain (pending until DNS is verified)' })
  addDomain(@Body() dto: AddDomainDto, @CurrentAuth() auth: AuthContext) {
    return this.domains.add(dto.hostname, auth.userId);
  }

  @Post('domains/:id/verify')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DOMAINS_MANAGE)
  @ApiOperation({ summary: 'Check DNS TXT record and mark the domain verified' })
  verifyDomain(@Param('id') id: string) {
    return this.domains.verify(id);
  }

  @Patch('domains/:id/primary')
  @RequirePermissions(PERMISSIONS.DOMAINS_MANAGE)
  makePrimary(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.domains.makePrimary(id, auth.userId);
  }

  @Delete('domains/:id')
  @RequirePermissions(PERMISSIONS.DOMAINS_MANAGE)
  removeDomain(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.domains.remove(id, auth.userId);
  }
}
