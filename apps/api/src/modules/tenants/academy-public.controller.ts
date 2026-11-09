import { Controller, Get, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { TenantScoped } from '../../common/decorators/auth.decorators.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { AppRequest } from '../../core/tenancy/request-context.js';
import { FilesService } from '../files/files.service.js';
import { apiOrigin } from '../files/files.controller.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { parseTracking, TRACKING_KEY } from '../sales/tracking.js';

/** Minimal public academy info for the academy host (branding expands in Phase 4/8). */
@ApiTags('Academy (public)')
@Public()
@TenantScoped('academy')
@Controller({ path: 'public', version: '1' })
export class AcademyPublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Get('site')
  @ApiOperation({ summary: 'Academy identity for the current host' })
  async site(@Req() req: AppRequest) {
    const host = req.hostRealm!;
    if (host.kind !== 'tenant') return null;
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: host.tenantId }, select: { name: true, slug: true, status: true, locale: true, defaultCurrency: true, academy: true } });
    const a = t.academy;
    const gateway = (await this.entitlements.get(host.tenantId)).active ? await this.prisma.paymentGatewayAccount.count({ where: { tenantId: host.tenantId, isActive: true, status: 'VERIFIED' } }) : 0;
    const tracking = await this.prisma.tenantSetting.findUnique({ where: { tenantId_key: { tenantId: host.tenantId, key: TRACKING_KEY } } });
    return {
      paymentsEnabled: gateway > 0,
      tracking: parseTracking(tracking?.value),
      name: t.name, slug: t.slug, isLive: t.status === 'ACTIVE', acceptingRegistrations: t.status === 'ACTIVE', locale: t.locale, currency: t.defaultCurrency,
      tagline: a?.tagline ?? null, description: a?.description ?? null, supportEmail: a?.supportEmail ?? null, socialLinks: a?.socialLinks ?? {},
      theme: { primaryColor: a?.primaryColor ?? '#4f46e5', accentColor: a?.accentColor ?? '#0d9488', fontHeading: a?.fontHeading ?? 'Inter', fontBody: a?.fontBody ?? 'Inter' },
      logoUrl: await this.files.urlFor(a?.logoFileId, apiOrigin(req), 86_400),
      faviconUrl: await this.files.urlFor(a?.faviconFileId, apiOrigin(req), 86_400),
    };
  }
}
