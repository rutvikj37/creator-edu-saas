import { Controller, Get, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { AppConfig } from '../../config/app-config.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import type { AppRequest } from '../../core/tenancy/request-context.js';
import { FilesService } from '../files/files.service.js';
import { apiOrigin } from '../files/files.controller.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { parseTracking, TRACKING_KEY } from '../sales/tracking.js';
import { AcademyPreferencesService } from '../../core/settings/academy-preferences.service.js';
import { fieldView } from '../academy/custom-fields.js';
import { PlatformStudentLoginService } from '../auth/services/platform-student-login.service.js';

/**
 * Public academy identity for the current host.
 *
 * Academy hosts always resolve their tenant. The platform LMS host has no Website/Site row;
 * when PLATFORM_STUDENT_LOGIN_TENANT is set we return that academy's branding so /learn
 * and other shells keep working. Otherwise we return soft platform defaults (200) so the
 * SPA never hard-404s on every page.
 */
@ApiTags('Academy (public)')
@Public()
@Controller({ path: 'public', version: '1' })
export class AcademyPublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly entitlements: EntitlementsService,
    private readonly prefs: AcademyPreferencesService,
    private readonly platformStudents: PlatformStudentLoginService,
    private readonly ctx: TenantContext,
    private readonly config: AppConfig,
  ) {}

  /** Settings that shape the public site and sign-up: cookie notice, default form, Google, password rule, sign-up fields. */
  private async experience(tenantId: string) {
    const [ux, signup, fields] = await Promise.all([
      this.prefs.get(tenantId, 'experience'), this.prefs.get(tenantId, 'signup'),
      this.prisma.customField.findMany({ where: { tenantId, showInSignup: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    return {
      cookieBanner: ux.cookieBanner, defaultForm: ux.defaultForm,
      signup: { googleEnabled: signup.googleEnabled, securePasswordPolicy: signup.securePasswordPolicy, fields: fields.map(fieldView) },
    };
  }

  private async academyPayload(tenantId: string, req: AppRequest) {
    const t = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { name: true, slug: true, status: true, locale: true, defaultCurrency: true, academy: true },
    });
    const a = t.academy;
    const gateway = (await this.entitlements.get(tenantId)).active
      ? await this.prisma.paymentGatewayAccount.count({ where: { tenantId, isActive: true, status: 'VERIFIED' } })
      : 0;
    const tracking = await this.prisma.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: TRACKING_KEY } } });
    // Logo/favicon URLs need tenant-scoped file reads.
    this.ctx.set(tenantId);
    return {
      paymentsEnabled: gateway > 0,
      gstInputCredit: (await this.prisma.tenantBusinessProfile.findUnique({ where: { tenantId }, select: { gstInputCredit: true } }))?.gstInputCredit ?? true,
      tracking: parseTracking(tracking?.value),
      name: t.name, slug: t.slug, isLive: t.status === 'ACTIVE', acceptingRegistrations: t.status === 'ACTIVE', locale: t.locale, currency: t.defaultCurrency,
      tagline: a?.tagline ?? null, description: a?.description ?? null, supportEmail: a?.supportEmail ?? null, socialLinks: a?.socialLinks ?? {},
      theme: { primaryColor: a?.primaryColor ?? '#4f46e5', accentColor: a?.accentColor ?? '#0d9488', fontHeading: a?.fontHeading ?? 'Inter', fontBody: a?.fontBody ?? 'Inter' },
      logoUrl: await this.files.urlFor(a?.logoFileId, apiOrigin(req), 86_400),
      faviconUrl: await this.files.urlFor(a?.faviconFileId, apiOrigin(req), 86_400),
      ...(await this.experience(tenantId)),
    };
  }

  /** Soft defaults when the platform host has no bridged academy — keeps the SPA shell on 200. */
  private async platformDefaults() {
    const rows = await this.prisma.platformSetting.findMany({
      where: { group: 'branding', isSecret: false },
      select: { key: true, value: true },
    });
    const branding = Object.fromEntries(rows.map((r) => [r.key.replace(/^branding\./, ''), r.value]));
    const name = (branding.name as string | undefined) ?? this.config.get('APP_NAME');
    return {
      paymentsEnabled: false,
      gstInputCredit: true,
      tracking: { metaPixelId: null, ga4Id: null, gtmId: null },
      name,
      slug: null,
      isLive: true,
      acceptingRegistrations: false,
      locale: 'en',
      currency: 'INR',
      tagline: (branding.tagline as string | undefined) ?? null,
      description: null,
      supportEmail: null,
      socialLinks: {},
      theme: { primaryColor: '#4f46e5', accentColor: '#0d9488', fontHeading: 'Inter', fontBody: 'Inter' },
      logoUrl: null,
      faviconUrl: null,
      cookieBanner: false,
      defaultForm: 'login',
      signup: { googleEnabled: false, securePasswordPolicy: false, fields: [] },
      platformHost: true,
    };
  }

  @Get('site')
  @ApiOperation({ summary: 'Academy identity for the current host' })
  async site(@Req() req: AppRequest) {
    const host = req.hostRealm!;
    if (host.kind === 'tenant') {
      return this.academyPayload(host.tenantId, req);
    }
    if (host.kind === 'platform') {
      const bridged = await this.platformStudents.allowedTenantId();
      if (bridged) return this.academyPayload(bridged, req);
      return this.platformDefaults();
    }
    return this.platformDefaults();
  }
}
