import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FEATURES, PERMISSIONS } from '@ce/shared';
import { AllowWhenSuspended, RequirePermissions, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';

/** Creator view of the current plan, features and usage. Paid plan changes arrive with payments (Phase 7). */
@ApiTags('Creator · Billing')
@ApiBearerAuth()
@TenantScoped('workspace')
@AllowWhenSuspended()
@Controller({ path: 'creator/billing', version: '1' })
export class BillingController {
  constructor(
    private readonly ctx: TenantContext,
    private readonly subscriptions: SubscriptionsService,
    private readonly entitlements: EntitlementsService,
    private readonly prisma: PrismaService,
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  @ApiOperation({ summary: 'Current subscription, effective features and usage' })
  async overview() {
    const tenantId = this.ctx.requireTenantId();
    const [subscription, entitlements, customDomains, staff, students] = await Promise.all([
      this.subscriptions.current(tenantId),
      this.entitlements.get(tenantId),
      this.db.tenantDomain.count({ where: { type: 'CUSTOM' } }),
      this.db.tenantMember.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { tenantId, deletedAt: null } }),
    ]);
    const usage: Record<string, number> = {
      [FEATURES.CUSTOM_DOMAINS.key]: customDomains,
      [FEATURES.STAFF_MAX.key]: staff,
      [FEATURES.STUDENTS_MAX.key]: students,
    };
    return {
      subscription: subscription && { ...subscription, planPrice: subscription.planPrice && { ...subscription.planPrice, amount: subscription.planPrice.amount.toString() } },
      entitlements,
      usage,
      catalog: Object.values(FEATURES),
    };
  }
}
