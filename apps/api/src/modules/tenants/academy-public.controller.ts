import { Controller, Get, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { TenantScoped } from '../../common/decorators/auth.decorators.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { AppRequest } from '../../core/tenancy/request-context.js';

/** Minimal public academy info for the academy host (branding expands in Phase 4/8). */
@ApiTags('Academy (public)')
@Public()
@TenantScoped('academy')
@Controller({ path: 'public', version: '1' })
export class AcademyPublicController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('site')
  @ApiOperation({ summary: 'Academy identity for the current host' })
  async site(@Req() req: AppRequest) {
    const host = req.hostRealm!;
    if (host.kind !== 'tenant') return null;
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: host.tenantId }, select: { name: true, slug: true, status: true, locale: true } });
    return { name: t.name, slug: t.slug, isLive: t.status === 'ACTIVE', acceptingRegistrations: t.status === 'ACTIVE', locale: t.locale };
  }
}
