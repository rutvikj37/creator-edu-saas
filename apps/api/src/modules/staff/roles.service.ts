import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PERMISSIONS, ROLE_PERMISSIONS } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { AuthzService } from '../authz/authz.service.js';
import { ASSIGNABLE_ROLES } from './staff.service.js';

/** What each permission lets a team member do (shown when building a role). */
export const PERMISSION_CATALOG: { group: string; items: { key: string; label: string }[] }[] = [
  { group: 'Academy', items: [{ key: PERMISSIONS.ACADEMY_MANAGE, label: 'Edit academy profile and branding' }, { key: PERMISSIONS.SETTINGS_MANAGE, label: 'Change academy settings' }, { key: PERMISSIONS.INTEGRATIONS_MANAGE, label: 'Connect payments, Zoom, Google and other integrations' }, { key: PERMISSIONS.STAFF_MANAGE, label: 'Invite team members and manage roles' }] },
  { group: 'Courses & content', items: [{ key: PERMISSIONS.COURSES_READ, label: 'View courses, products and bundles' }, { key: PERMISSIONS.COURSES_MANAGE, label: 'Create and edit courses, products, bundles and question bank' }, { key: PERMISSIONS.CERTIFICATES_MANAGE, label: 'Manage certificates' }, { key: PERMISSIONS.ASSESSMENTS_GRADE, label: 'Grade quizzes and assignments' }] },
  { group: 'Students', items: [{ key: PERMISSIONS.STUDENTS_READ, label: 'View students and progress' }, { key: PERMISSIONS.STUDENTS_MANAGE, label: 'Enrol, remove and manage students' }, { key: PERMISSIONS.COMMUNITY_MANAGE, label: 'Moderate communities and discussions' }, { key: PERMISSIONS.SUPPORT_MANAGE, label: 'Answer student support and chat' }] },
  { group: 'Live', items: [{ key: PERMISSIONS.LIVE_MANAGE, label: 'Schedule and host live classes and webinars' }] },
  { group: 'Sales', items: [{ key: PERMISSIONS.ORDERS_READ, label: 'View orders and transactions' }, { key: PERMISSIONS.REFUNDS_MANAGE, label: 'Issue refunds' }, { key: PERMISSIONS.COUPONS_MANAGE, label: 'Create coupons' }, { key: PERMISSIONS.AFFILIATES_MANAGE, label: 'Manage affiliates and payouts' }] },
  { group: 'Growth', items: [{ key: PERMISSIONS.MARKETING_MANAGE, label: 'Send campaigns and automations' }, { key: PERMISSIONS.ANALYTICS_READ, label: 'View analytics and reports' }] },
  { group: 'Website', items: [{ key: PERMISSIONS.WEBSITE_MANAGE, label: 'Edit website pages' }, { key: PERMISSIONS.DOMAINS_MANAGE, label: 'Manage domains' }] },
];
/** Billing (the academy's own plan and payment method) stays with the owner. */
const GRANTABLE = new Set(ROLE_PERMISSIONS.ADMIN as readonly string[]);

/**
 * Custom team roles: an academy defines roles with the permissions it chooses, next to the
 * built-in ones. Nobody can grant a permission they do not hold themselves, and changes apply to
 * every member with the role within seconds (permission cache invalidated).
 */
@Injectable()
export class RolesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
  ) {}

  catalog() {
    return PERMISSION_CATALOG.map((g) => ({ ...g, items: g.items.filter((i) => GRANTABLE.has(i.key)) }));
  }

  async list() {
    const tenantId = this.ctx.requireTenantId();
    const roles = await this.prisma.role.findMany({
      where: { OR: [{ uniqueKey: { in: ASSIGNABLE_ROLES.map((k) => `system:${k}`) } }, { tenantId, scope: 'TENANT' }] },
      include: { permissions: { include: { permission: { select: { key: true } } } } }, orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    const counts = await this.prisma.tenantMember.groupBy({ by: ['roleId'], where: { tenantId, status: 'ACTIVE' }, _count: { _all: true } });
    return roles.map((r) => ({
      id: r.id, key: r.key, name: r.name, custom: !r.isSystem, permissions: r.permissions.map((p) => p.permission.key).filter((k) => GRANTABLE.has(k)).sort(),
      members: counts.find((c) => c.roleId === r.id)?._count._all ?? 0,
    }));
  }

  private async validate(name: string | undefined, permissions: string[] | undefined, actorUserId: string, excludeId?: string) {
    const errors: { field: string; message: string }[] = [];
    if (name !== undefined) {
      if (!name.trim() || name.trim().length > 60) errors.push({ field: 'name', message: '1–60 characters' });
      const clash = await this.prisma.role.findFirst({ where: { OR: [{ tenantId: this.ctx.requireTenantId() }, { isSystem: true, scope: 'TENANT' }], name: name.trim(), ...(excludeId ? { id: { not: excludeId } } : {}) } });
      if (clash) errors.push({ field: 'name', message: 'A role with this name already exists' });
    }
    if (permissions !== undefined) {
      if (!permissions.length) errors.push({ field: 'permissions', message: 'Choose at least one permission' });
      const bad = permissions.filter((p) => !GRANTABLE.has(p));
      if (bad.length) errors.push({ field: 'permissions', message: `These cannot be given to a team role: ${bad.join(', ')}` });
      const mine = await this.authz.permissions({ userId: actorUserId, realm: 'PLATFORM', tenantId: this.ctx.requireTenantId() });
      const above = permissions.filter((p) => GRANTABLE.has(p) && !mine.has(p));
      if (above.length) errors.push({ field: 'permissions', message: `You cannot give permissions you do not have: ${above.join(', ')}` });
    }
    if (errors.length) throw AppException.validation(errors);
  }

  private async setPermissions(roleId: string, keys: string[]) {
    const perms = await this.prisma.permission.findMany({ where: { key: { in: [...new Set(keys)] } }, select: { id: true } });
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) }),
    ]);
  }

  private async custom(id: string) {
    const r = await this.prisma.role.findFirst({ where: { id, tenantId: this.ctx.requireTenantId(), isSystem: false } });
    if (!r) throw AppException.notFound('Role not found');
    return r;
  }

  private async refreshMembers(roleId: string) {
    const members = await this.prisma.tenantMember.findMany({ where: { roleId, tenantId: this.ctx.requireTenantId() }, select: { userId: true } });
    for (const m of members) await this.authz.invalidate(m.userId);
  }

  async create(input: { name: string; permissions: string[] }, actorUserId: string) {
    await this.validate(input.name, input.permissions, actorUserId);
    const tenantId = this.ctx.requireTenantId();
    const key = `custom_${randomBytes(6).toString('hex')}`;
    const r = await this.prisma.role.create({ data: { tenantId, key, name: input.name.trim(), scope: 'TENANT', isSystem: false, uniqueKey: `${tenantId}:${key}` } });
    await this.setPermissions(r.id, input.permissions);
    await this.audit.record({ action: 'role.create', tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Role', targetId: r.id, after: { name: r.name, permissions: input.permissions } });
    return (await this.list()).find((x) => x.id === r.id);
  }

  async update(id: string, input: { name?: string; permissions?: string[] }, actorUserId: string) {
    const r = await this.custom(id);
    await this.validate(input.name, input.permissions, actorUserId, id);
    if (input.name !== undefined) await this.prisma.role.update({ where: { id }, data: { name: input.name.trim() } });
    if (input.permissions) await this.setPermissions(id, input.permissions);
    await this.refreshMembers(id);
    await this.audit.record({ action: 'role.update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Role', targetId: r.id, after: input as never });
    return (await this.list()).find((x) => x.id === id);
  }

  async remove(id: string, actorUserId: string) {
    const r = await this.custom(id);
    const tenantId = this.ctx.requireTenantId();
    const [members, invites] = await Promise.all([
      this.prisma.tenantMember.count({ where: { roleId: id, tenantId } }),
      this.db.staffInvitation.count({ where: { roleId: id, acceptedAt: null, revokedAt: null } as never }),
    ]);
    if (members || invites) throw AppException.conflict(`Move the ${members + invites} team member${members + invites === 1 ? '' : 's'} or invitation${members + invites === 1 ? '' : 's'} with this role to another role first.`);
    await this.prisma.role.delete({ where: { id } });
    await this.audit.record({ action: 'role.delete', tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Role', targetId: r.id, after: { name: r.name } });
    return { deleted: true };
  }
}
