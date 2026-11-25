import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TENANT_ROLES } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { Paginated } from '../../common/interceptors/response-envelope.interceptor.js';
import { PaginationQueryDto, toOrderBy, toSkipTake } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { HostResolverService } from '../../core/tenancy/host-resolver.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { SessionService } from '../auth/services/session.service.js';
import { AppConfig } from '../../config/app-config.service.js';
import { PasswordService } from '../auth/services/password.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { isValidSlug, slugify } from '../tenants/slug.js';
import { escapeHtml } from '../../core/mail/templates.js';
import { academyOrigin } from '../tenants/academy-origin.js';
import { purgeExpiredTenants } from './tenant-purge.js';
import type { AssignPlanDto, CreateTenantDto, LimitOverridesDto, TenantListQuery, UpdateTenantDto } from './dto/platform.dto.js';

/** Days a tenant stays restorable after a deletion request (data is retained; financial records are never deleted). */
export const DELETION_RETENTION_DAYS = 30;

interface Actor {
  userId: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Cross-tenant administration. Uses the root Prisma client intentionally: these endpoints are
 * restricted to platform roles by permission guards and every mutation is audited.
 */
@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly hosts: HostResolverService,
    private readonly subscriptions: SubscriptionsService,
    private readonly entitlements: EntitlementsService,
    private readonly sessions: SessionService,
    private readonly config: AppConfig,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly tenants: TenantsService,
  ) {}

  async createTenant(dto: CreateTenantDto, actor: Actor) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { realmKey_email: { realmKey: 'platform', email } },
    });

    const tempPassword = `Pass@${randomBytes(4).toString('hex')}!`;
    const passwordHash = await this.passwords.hash(tempPassword);

    const result = await this.prisma.$transaction(async (tx) => {
      let user = existing;
      let isNewUser = false;
      if (!user) {
        user = await tx.user.create({
          data: {
            realm: 'PLATFORM',
            realmKey: 'platform',
            email,
            fullName: dto.ownerName,
            phone: dto.phone ?? null,
            country: dto.country ?? 'IN',
            passwordHash,
            emailVerifiedAt: new Date(),
            passwordChangedAt: new Date(),
          },
        });
        isNewUser = true;
      }

      const slugBase = dto.subdomain ? slugify(dto.subdomain) : slugify(dto.name);
      const slug = await this.tenants.uniqueSlug(tx, slugBase);

      const ownerRole = await tx.role.findUniqueOrThrow({
        where: { uniqueKey: `system:${TENANT_ROLES.OWNER}` },
      });

      const isLater = dto.paymentType === 'LATER';
      const tenant = await tx.tenant.create({
        data: {
          slug,
          name: dto.name,
          ownerUserId: user.id,
          country: dto.country ?? user.country ?? 'IN',
          defaultCurrency: (dto.country ?? user.country) === 'IN' || !dto.country ? 'INR' : 'USD',
          status: isLater ? 'ONBOARDING' : 'ACTIVE',
        },
      });

      await tx.tenantMember.create({
        data: { tenantId: tenant.id, userId: user.id, roleId: ownerRole.id, status: 'ACTIVE' },
      });

      const rootDomain = this.config.get('PLATFORM_ROOT_DOMAIN');
      await tx.tenantDomain.create({
        data: {
          tenantId: tenant.id,
          hostname: `${slug}.${rootDomain}`,
          type: 'SUBDOMAIN',
          isPrimary: !dto.customDomain,
          status: 'VERIFIED',
          verificationToken: randomBytes(16).toString('hex'),
          verifiedAt: new Date(),
        },
      });

      if (dto.customDomain) {
        await tx.tenantDomain.create({
          data: {
            tenantId: tenant.id,
            hostname: dto.customDomain.trim().toLowerCase(),
            type: 'CUSTOM',
            isPrimary: true,
            status: 'PENDING',
            verificationToken: randomBytes(16).toString('hex'),
          },
        });
      }

      let planId = dto.planId;
      if (!planId) {
        const defaultPlan = await tx.subscriptionPlan.findFirst({
          where: { isDefault: true, status: 'ACTIVE' },
        });
        planId = defaultPlan?.id;
      }

      if (!isLater && planId) {
        const plan = await tx.subscriptionPlan.findUniqueOrThrow({
          where: { id: planId },
          include: { prices: true },
        });
        const now = new Date();
        const isPaid = dto.paymentType === 'PAID';
        const isTrial = dto.paymentType === 'TRIAL' || (!dto.paymentType && plan.trialDays > 0);

        let currentPeriodEnd: Date | null = null;
        if (isPaid) {
          currentPeriodEnd = new Date(now);
          const months = dto.billingMonths && dto.billingMonths > 0 ? dto.billingMonths : 12;
          currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + months);
        } else if (isTrial) {
          const days = dto.trialDays && dto.trialDays > 0 ? dto.trialDays : (plan.trialDays || 14);
          currentPeriodEnd = new Date(now.getTime() + days * 86_400_000);
        }

        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: plan.id,
            planPriceId: dto.planPriceId ?? null,
            status: isTrial ? 'TRIALING' : 'ACTIVE',
            currentKey: 'current',
            currentPeriodStart: now,
            currentPeriodEnd,
            trialEndsAt: isTrial ? currentPeriodEnd : null,
            featureSnapshot: (await this.subscriptions.snapshotOf(tx, plan.id)) as never,
            source: 'admin_created',
          },
        });
      }

      await this.audit.record(
        {
          action: 'tenant.create_by_admin',
          tenantId: tenant.id,
          actorUserId: actor.userId,
          actorRealm: 'PLATFORM',
          targetType: 'Tenant',
          targetId: tenant.id,
          after: {
            name: tenant.name,
            slug: tenant.slug,
            ownerEmail: email,
            paymentType: dto.paymentType,
            planId,
            billingMonths: dto.billingMonths,
            trialDays: dto.trialDays,
            amount: dto.amount,
          },
          ip: actor.ip,
          userAgent: actor.userAgent,
        },
        tx,
      );

      return { tenant, user, isNewUser, tempPassword, slug };
    });

    await this.subscriptions.afterChange(result.tenant.id);

    const { origin: portalUrl } = await academyOrigin(this.prisma, this.config, result.tenant.id);
    const loginUrl = `${portalUrl}/login`;
    const e = escapeHtml;
    const emailBody = `
      <h2>Welcome to ${e(dto.name)}!</h2>
      <p>Hello ${e(dto.ownerName)},</p>
      <p>Your agency portal has been successfully provisioned by the platform administrator.</p>
      <p><strong>Agency Name:</strong> ${e(dto.name)}</p>
      <p><strong>Academy website:</strong> <a href="${e(portalUrl)}">${e(portalUrl)}</a></p>
      <p><strong>Sign in (agency + students):</strong> <a href="${e(loginUrl)}">${e(loginUrl)}</a></p>
      <p><strong>Login Email:</strong> ${e(email)}</p>
      ${result.isNewUser ? `<p><strong>Temporary Password:</strong> <code>${e(result.tempPassword)}</code></p><p>Please change it after your first sign-in.</p>` : `<p>You can sign in using your existing account credentials.</p>`}
      <p>Please sign in on your academy domain to configure courses and branding.</p>
    `;

    try {
      await this.mail.send({
        to: email,
        subject: `Your agency ${dto.name} has been created`,
        html: emailBody,
        text: `Welcome to ${dto.name}. Your portal is ready at ${portalUrl}. Sign in at ${loginUrl} with ${email}.`,
        tag: 'admin-agency-created',
      });
    } catch {
      // Don't fail tenant creation if mail queue is temporarily unreachable
    }

    return {
      tenant: result.tenant,
      owner: { id: result.user.id, email: result.user.email, isNewUser: result.isNewUser, tempPassword: result.isNewUser ? result.tempPassword : null },
    };
  }

  async list(q: TenantListQuery) {
    const where: Prisma.TenantWhereInput = {
      ...(q.status ? { status: q.status as never } : { status: { not: 'DELETED' } }),
      ...(q.q ? { OR: [{ name: { contains: q.q } }, { slug: { contains: q.q } }, { owner: { email: { contains: q.q } } }] } : {}),
      ...(q.planId ? { subscriptions: { some: { currentKey: 'current', planId: q.planId } } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        orderBy: toOrderBy(q.sort, ['createdAt', 'name', 'status'] as const, { createdAt: 'desc' }),
        ...toSkipTake(q),
        select: {
          id: true, name: true, slug: true, status: true, country: true, createdAt: true,
          owner: { select: { id: true, fullName: true, email: true } },
          subscriptions: { where: { currentKey: 'current' }, select: { status: true, plan: { select: { id: true, name: true } } } },
          _count: { select: { users: true, members: true } },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return new Paginated(
      rows.map(({ subscriptions, _count, ...t }) => ({ ...t, subscription: subscriptions[0] ?? null, studentCount: _count.users, staffCount: _count.members })),
      { page: q.page, pageSize: q.pageSize, total },
    );
  }

  async listCreators(q: PaginationQueryDto) {
    const where: Prisma.UserWhereInput = {
      realm: 'PLATFORM',
      memberships: { some: { role: { key: 'OWNER' } } },
      ...(q.q
        ? {
            OR: [
              { fullName: { contains: q.q } },
              { email: { contains: q.q } },
              { phone: { contains: q.q } },
              { memberships: { some: { tenant: { name: { contains: q.q } } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: toOrderBy(q.sort, ['createdAt', 'fullName', 'email'] as const, { createdAt: 'desc' }),
        ...toSkipTake(q),
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          status: true,
          country: true,
          createdAt: true,
          lastLoginAt: true,
          memberships: {
            where: { role: { key: 'OWNER' } },
            select: {
              tenant: { select: { id: true, name: true, slug: true, status: true } },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return new Paginated(
      rows.map((u) => ({
        ...u,
        academies: u.memberships.map((m) => m.tenant),
      })),
      { page: q.page, pageSize: q.pageSize, total },
    );
  }

  private async get(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t || t.status === 'DELETED') throw AppException.notFound('Tenant not found');
    return t;
  }

  async detail(id: string) {
    await this.get(id);
    const t = await this.prisma.tenant.findUniqueOrThrow({
      where: { id },
      include: {
        owner: { select: { id: true, fullName: true, email: true, phone: true, emailVerifiedAt: true, lastLoginAt: true } },
        domains: { orderBy: { createdAt: 'asc' }, select: { id: true, hostname: true, type: true, status: true, isPrimary: true, createdAt: true } },
        members: { select: { id: true, status: true, createdAt: true, role: { select: { key: true, name: true } }, user: { select: { id: true, fullName: true, email: true } } } },
        limitOverrides: true,
      },
    });
    const [subscription, entitlements, studentCount, recentActivity, subscriptionHistory] = await Promise.all([
      this.subscriptions.current(id),
      this.entitlements.get(id),
      this.prisma.user.count({ where: { tenantId: id, deletedAt: null } }),
      this.prisma.auditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, action: true, actorUserId: true, createdAt: true, targetType: true } }),
      this.prisma.subscription.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, status: true, source: true, createdAt: true, canceledAt: true, plan: { select: { name: true } } } }),
    ]);
    return {
      ...t,
      limitOverrides: t.limitOverrides.map((o) => ({ ...o, limitValue: o.limitValue === null ? null : Number(o.limitValue) })),
      subscription,
      entitlements,
      subscriptionHistory,
      usage: {
        students: studentCount,
        staff: t.members.length,
        customDomains: t.domains.filter((d) => d.type === 'CUSTOM').length,
      },
      recentActivity,
    };
  }

  async updateTenant(id: string, dto: UpdateTenantDto, actor: Actor) {
    const t = await this.get(id);

    if (dto.slug !== undefined) dto.slug = slugify(dto.slug);
    if (dto.slug && dto.slug !== t.slug) {
      if (!isValidSlug(dto.slug)) throw AppException.validation([{ field: 'slug', message: 'Use 3–40 lowercase letters, numbers or hyphens (some names are reserved)' }]);
      const existing = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
      if (existing) {
        throw AppException.conflict('An agency with this slug already exists');
      }
    }

    const before = { name: t.name, slug: t.slug, country: t.country, timezone: t.timezone };

    await this.prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.slug ? { slug: dto.slug } : {}),
          ...(dto.country ? { country: dto.country } : {}),
          ...(dto.timezone ? { timezone: dto.timezone } : {}),
        },
      });

      if (dto.ownerName || dto.ownerPhone !== undefined) {
        await tx.user.update({
          where: { id: t.ownerUserId },
          data: {
            ...(dto.ownerName ? { fullName: dto.ownerName } : {}),
            ...(dto.ownerPhone !== undefined ? { phone: dto.ownerPhone || null } : {}),
          },
        });
      }

      if (dto.slug && dto.slug !== t.slug) {
        const rootDomain = this.config.get('PLATFORM_ROOT_DOMAIN');
        await tx.tenantDomain.updateMany({
          where: { tenantId: id, type: 'SUBDOMAIN' },
          data: { hostname: `${dto.slug}.${rootDomain}` },
        });
      }

      await this.audit.record(
        {
          action: 'tenant.update',
          tenantId: id,
          actorUserId: actor.userId,
          actorRealm: 'PLATFORM',
          targetType: 'Tenant',
          targetId: id,
          before,
          after: dto,
          ip: actor.ip,
          userAgent: actor.userAgent,
        },
        tx,
      );
    });

    await this.invalidateHosts(id);
    return this.detail(id);
  }

  private async setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED', actor: Actor, reason?: string) {
    const t = await this.get(id);
    if (t.status === 'PENDING_DELETION') throw AppException.conflict('Restore the tenant before changing its status.');
    const updated = await this.prisma.tenant.update({ where: { id }, data: { status, suspendedReason: status === 'SUSPENDED' ? reason : null } });
    await this.invalidateHosts(id);
    await this.audit.record({ action: status === 'SUSPENDED' ? 'tenant.suspend' : 'tenant.activate', tenantId: id, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Tenant', targetId: id, before: { status: t.status }, after: { status, reason }, ip: actor.ip, userAgent: actor.userAgent });
    return updated;
  }

  activate(id: string, actor: Actor) {
    return this.setStatus(id, 'ACTIVE', actor);
  }

  async suspend(id: string, reason: string, actor: Actor) {
    const t = await this.setStatus(id, 'SUSPENDED', actor, reason);
    // Sign students out of the suspended academy immediately.
    const students = await this.prisma.user.findMany({ where: { tenantId: id }, select: { id: true } });
    for (const s of students) await this.sessions.revokeAllForUser(s.id, 'tenant_suspended');
    return t;
  }

  async scheduleDeletion(id: string, confirmSlug: string, actor: Actor) {
    const t = await this.get(id);
    if (confirmSlug !== t.slug) throw AppException.validation([{ field: 'confirmSlug', message: 'Type the academy slug exactly to confirm' }]);
    const at = new Date(Date.now() + DELETION_RETENTION_DAYS * 86_400_000);
    const updated = await this.prisma.tenant.update({ where: { id }, data: { status: 'PENDING_DELETION', deletionScheduledAt: at } });
    await this.invalidateHosts(id);
    await this.audit.record({ action: 'tenant.delete_scheduled', tenantId: id, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Tenant', targetId: id, after: { deletionScheduledAt: at }, ip: actor.ip, userAgent: actor.userAgent });
    return updated;
  }

  async restore(id: string, actor: Actor) {
    const t = await this.get(id);
    if (t.status !== 'PENDING_DELETION') throw AppException.conflict('Tenant is not scheduled for deletion.');
    const updated = await this.prisma.tenant.update({ where: { id }, data: { status: 'ACTIVE', deletionScheduledAt: null } });
    await this.invalidateHosts(id);
    await this.audit.record({ action: 'tenant.restore', tenantId: id, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Tenant', targetId: id, ip: actor.ip, userAgent: actor.userAgent });
    return updated;
  }

  async assignPlan(id: string, dto: AssignPlanDto, actor: Actor) {
    await this.get(id);
    const before = await this.subscriptions.current(id);
    const sub = await this.prisma.$transaction((tx) => this.subscriptions.assignPlan(tx, { tenantId: id, planId: dto.planId, planPriceId: dto.planPriceId, source: 'admin', allowTrial: false }));
    await this.subscriptions.afterChange(id);
    await this.audit.record({ action: 'subscription.change', tenantId: id, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Subscription', targetId: sub.id, before: { planId: before?.planId ?? null }, after: { planId: dto.planId, planPriceId: dto.planPriceId ?? null }, ip: actor.ip, userAgent: actor.userAgent });
    return this.subscriptions.current(id);
  }

  async setOverrides(id: string, dto: LimitOverridesDto, actor: Actor) {
    await this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.tenantLimitOverride.deleteMany({ where: { tenantId: id, featureKey: { notIn: dto.overrides.map((o) => o.featureKey) } } });
      for (const o of dto.overrides) {
        const data = { enabled: o.enabled, limitValue: o.limitValue === undefined || o.limitValue === null ? null : BigInt(o.limitValue), reason: o.reason, setById: actor.userId };
        await tx.tenantLimitOverride.upsert({ where: { tenantId_featureKey: { tenantId: id, featureKey: o.featureKey } }, update: data, create: { tenantId: id, featureKey: o.featureKey, ...data } });
      }
    });
    await this.entitlements.invalidate(id);
    await this.audit.record({ action: 'tenant.limits_update', tenantId: id, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Tenant', targetId: id, after: { overrides: dto.overrides }, ip: actor.ip, userAgent: actor.userAgent });
    return this.entitlements.get(id);
  }

  async purgeExpiredTenants(actor?: Actor) {
    return purgeExpiredTenants(
      { prisma: this.prisma, hosts: this.hosts, audit: this.audit, revokeUserSessions: (userId, reason) => this.sessions.revokeAllForUser(userId, reason) },
      actor,
    );
  }

  private async invalidateHosts(id: string) {
    const domains = await this.prisma.tenantDomain.findMany({ where: { tenantId: id }, select: { hostname: true } });
    await this.hosts.invalidate(...domains.map((d) => d.hostname));
  }
}
