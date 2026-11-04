import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ERROR_CODES, FEATURES } from '@ce/shared';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../core/redis/redis.constants.js';
import { AppException } from '../../common/errors/app-exception.js';

export interface FeatureValue {
  enabled: boolean;
  /** null = unlimited (only meaningful for limit features). */
  limit: number | null;
}

export interface Entitlements {
  active: boolean;
  status: string | null;
  planId: string | null;
  planName: string | null;
  features: Record<string, FeatureValue>;
}

/** Subscription states in which plan features apply. */
export const ENTITLED_STATUSES = new Set(['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE']);
const FEATURE_KINDS = new Map(Object.values(FEATURES).map((f) => [f.key, f.kind]));
const TTL = 60;

export type FeatureSnapshot = Record<string, { enabled: boolean; limit: string | null }>;

/**
 * Effective features of a tenant = current subscription's feature snapshot, overlaid with
 * per-tenant overrides set by Super Admin. No plan logic is hardcoded: everything comes from data.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async invalidate(tenantId: string) {
    await this.redis.del(`entitlements:${tenantId}`);
  }

  async get(tenantId: string): Promise<Entitlements> {
    const cached = await this.redis.get(`entitlements:${tenantId}`);
    if (cached) return JSON.parse(cached) as Entitlements;

    const sub = await this.prisma.subscription.findFirst({
      where: { tenantId, currentKey: 'current' },
      select: { status: true, featureSnapshot: true, plan: { select: { id: true, name: true } } },
    });
    const overrides = await this.prisma.tenantLimitOverride.findMany({ where: { tenantId } });
    const active = Boolean(sub && ENTITLED_STATUSES.has(sub.status));
    const features: Record<string, FeatureValue> = {};
    if (active && sub) {
      for (const [key, v] of Object.entries(sub.featureSnapshot as FeatureSnapshot)) {
        features[key] = { enabled: v.enabled, limit: v.limit === null ? null : Number(v.limit) };
      }
    }
    for (const o of overrides) features[o.featureKey] = { enabled: o.enabled, limit: o.limitValue === null ? null : Number(o.limitValue) };

    const result: Entitlements = { active, status: sub?.status ?? null, planId: sub?.plan.id ?? null, planName: sub?.plan.name ?? null, features };
    await this.redis.set(`entitlements:${tenantId}`, JSON.stringify(result), 'EX', TTL);
    return result;
  }

  async hasFeature(tenantId: string, key: string): Promise<boolean> {
    const e = await this.get(tenantId);
    return e.features[key]?.enabled === true;
  }

  async assertFeature(tenantId: string, key: string) {
    const e = await this.get(tenantId);
    if (!e.active) throw new AppException(ERROR_CODES.NO_ACTIVE_PLAN, 'Your academy has no active plan. Choose a plan in Billing.', HttpStatus.PAYMENT_REQUIRED);
    if (e.features[key]?.enabled !== true) {
      throw new AppException(ERROR_CODES.FEATURE_NOT_IN_PLAN, 'This feature is not included in your current plan. Upgrade in Billing.', HttpStatus.FORBIDDEN);
    }
  }

  /** Throws when adding `adding` more items would exceed the plan limit for `key`. */
  async assertWithinLimit(tenantId: string, key: string, currentCount: number, adding = 1) {
    const e = await this.get(tenantId);
    if (!e.active) throw new AppException(ERROR_CODES.NO_ACTIVE_PLAN, 'Your academy has no active plan. Choose a plan in Billing.', HttpStatus.PAYMENT_REQUIRED);
    const f = e.features[key];
    if (!f || !f.enabled) throw new AppException(ERROR_CODES.FEATURE_NOT_IN_PLAN, 'This feature is not included in your current plan.', HttpStatus.FORBIDDEN);
    if (f.limit !== null && currentCount + adding > f.limit) {
      throw new AppException(ERROR_CODES.PLAN_LIMIT_REACHED, `Your plan allows ${f.limit}. Upgrade to add more.`, HttpStatus.FORBIDDEN);
    }
  }

  static kindOf(key: string) {
    return FEATURE_KINDS.get(key);
  }
}
