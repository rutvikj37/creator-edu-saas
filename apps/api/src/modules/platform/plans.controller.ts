import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FEATURES, PERMISSIONS } from '@ce/shared';
import { ClientMetaParam, CurrentAuth, RequirePermissions, RequireRealm } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import type { ClientMeta } from '../auth/services/session.service.js';
import { PlanDto } from './dto/platform.dto.js';
import type { Prisma } from '../../generated/prisma/client.js';

const FEATURE_KEYS = new Set(Object.values(FEATURES).map((f) => f.key));

function present(plan: Prisma.SubscriptionPlanGetPayload<{ include: { features: true; prices: true; _count: { select: { subscriptions: true } } } }>) {
  return {
    ...plan,
    features: plan.features.map((f) => ({ featureKey: f.featureKey, enabled: f.enabled, limitValue: f.limitValue === null ? null : Number(f.limitValue) })),
    prices: plan.prices.map((p) => ({ id: p.id, interval: p.interval, currency: p.currency, amount: p.amount.toString(), active: p.active })),
  };
}

const include = { features: true, prices: { orderBy: [{ currency: 'asc' }, { interval: 'asc' }] }, _count: { select: { subscriptions: { where: { currentKey: 'current' } } } } } as const;

@ApiTags('Platform · Plans')
@ApiBearerAuth()
@Controller({ version: '1' })
export class PlansController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('platform/features')
  @RequireRealm('PLATFORM')
  @RequirePermissions(PERMISSIONS.PLATFORM_PLANS_MANAGE)
  @ApiOperation({ summary: 'Catalogue of configurable plan features' })
  features() {
    return Object.values(FEATURES);
  }

  @Get('platform/plans')
  @RequireRealm('PLATFORM')
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_READ)
  async list() {
    const plans = await this.prisma.subscriptionPlan.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: include as never });
    return plans.map((p) => present(p as never));
  }

  @Get('platform/plans/:id')
  @RequireRealm('PLATFORM')
  @RequirePermissions(PERMISSIONS.PLATFORM_PLANS_MANAGE)
  async get(@Param('id') id: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id }, include: include as never });
    if (!plan) throw AppException.notFound('Plan not found');
    return present(plan as never);
  }

  private validate(dto: PlanDto) {
    const bad = dto.features.filter((f) => !FEATURE_KEYS.has(f.featureKey));
    if (bad.length) throw AppException.validation(bad.map((f) => ({ field: 'features', message: `Unknown feature ${f.featureKey}` })));
    const seen = new Set<string>();
    for (const p of dto.prices) {
      const k = `${p.interval}:${p.currency}`;
      if (seen.has(k)) throw AppException.validation([{ field: 'prices', message: `Duplicate ${p.interval.toLowerCase()} price in ${p.currency}` }]);
      seen.add(k);
    }
  }

  private async write(tx: Prisma.TransactionClient, planId: string, dto: PlanDto) {
    if (dto.isDefault) await tx.subscriptionPlan.updateMany({ where: { id: { not: planId }, isDefault: true }, data: { isDefault: false } });
    await tx.planFeature.deleteMany({ where: { planId } });
    if (dto.features.length) {
      await tx.planFeature.createMany({ data: dto.features.map((f) => ({ planId, featureKey: f.featureKey, enabled: f.enabled, limitValue: f.limitValue === undefined || f.limitValue === null ? null : BigInt(f.limitValue) })) });
    }
    // Prices are deactivated rather than deleted so existing subscriptions keep their reference.
    const existing = await tx.planPrice.findMany({ where: { planId } });
    for (const p of dto.prices) {
      const match = existing.find((e) => e.interval === p.interval && e.currency === p.currency);
      if (match) await tx.planPrice.update({ where: { id: match.id }, data: { amount: p.amount, active: p.active ?? true } });
      else await tx.planPrice.create({ data: { planId, interval: p.interval, currency: p.currency, amount: p.amount, active: p.active ?? true } });
    }
    const keep = new Set(dto.prices.map((p) => `${p.interval}:${p.currency}`));
    for (const e of existing) if (!keep.has(`${e.interval}:${e.currency}`)) await tx.planPrice.update({ where: { id: e.id }, data: { active: false } });
  }

  @Post('platform/plans')
  @RequireRealm('PLATFORM')
  @RequirePermissions(PERMISSIONS.PLATFORM_PLANS_MANAGE)
  async create(@Body() dto: PlanDto, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    this.validate(dto);
    const plan = await this.prisma.$transaction(async (tx) => {
      const p = await tx.subscriptionPlan.create({ data: { code: dto.code, name: dto.name, description: dto.description, status: dto.status, isPublic: dto.isPublic, isDefault: false, trialDays: dto.trialDays, sortOrder: dto.sortOrder } });
      await this.write(tx, p.id, dto);
      if (dto.isDefault) await tx.subscriptionPlan.update({ where: { id: p.id }, data: { isDefault: true } });
      return p;
    });
    await this.audit.record({ action: 'plan.create', actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'SubscriptionPlan', targetId: plan.id, after: dto, ip: meta.ip, userAgent: meta.userAgent });
    return this.get(plan.id);
  }

  @Put('platform/plans/:id')
  @RequireRealm('PLATFORM')
  @RequirePermissions(PERMISSIONS.PLATFORM_PLANS_MANAGE)
  @ApiOperation({ summary: 'Update a plan. Existing subscriptions keep their feature snapshot until changed.' })
  async update(@Param('id') id: string, @Body() dto: PlanDto, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    this.validate(dto);
    const before = await this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionPlan.update({ where: { id }, data: { code: dto.code, name: dto.name, description: dto.description, status: dto.status, isPublic: dto.isPublic, isDefault: dto.isDefault, trialDays: dto.trialDays, sortOrder: dto.sortOrder } });
      await this.write(tx, id, dto);
    });
    await this.audit.record({ action: 'plan.update', actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'SubscriptionPlan', targetId: id, before, after: dto, ip: meta.ip, userAgent: meta.userAgent });
    return this.get(id);
  }

  @Public()
  @Get('public/plans')
  @ApiOperation({ summary: 'Active public plans (pricing page, creator billing)' })
  async publicPlans() {
    const plans = await this.prisma.subscriptionPlan.findMany({ where: { status: 'ACTIVE', isPublic: true }, orderBy: { sortOrder: 'asc' }, include: { features: true, prices: { where: { active: true } } } });
    return plans.map((p) => ({
      id: p.id, code: p.code, name: p.name, description: p.description, trialDays: p.trialDays, isDefault: p.isDefault,
      features: p.features.map((f) => ({ featureKey: f.featureKey, enabled: f.enabled, limitValue: f.limitValue === null ? null : Number(f.limitValue) })),
      prices: p.prices.map((x) => ({ id: x.id, interval: x.interval, currency: x.currency, amount: x.amount.toString() })),
    }));
  }
}
