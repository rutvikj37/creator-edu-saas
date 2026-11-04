import { Inject, Injectable } from '@nestjs/common';
import { FEATURES, TENANT_ROLES } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { escapeHtml } from '../../core/mail/templates.js';
import { randomToken, sha256 } from '../../core/crypto/crypto.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { AuthzService } from '../authz/authz.service.js';
import { SessionService } from '../auth/services/session.service.js';

/** Staff roles a workspace can assign (OWNER is fixed to the academy owner). */
export const ASSIGNABLE_ROLES = [TENANT_ROLES.ADMIN, TENANT_ROLES.INSTRUCTOR, TENANT_ROLES.CONTENT_MANAGER, TENANT_ROLES.SALES_MANAGER, TENANT_ROLES.SUPPORT_AGENT];
const INVITE_TTL_MS = 7 * 86_400_000;

@Injectable()
export class StaffService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly entitlements: EntitlementsService,
    private readonly authz: AuthzService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  private role(key: string) {
    if (!ASSIGNABLE_ROLES.includes(key as never)) throw AppException.validation([{ field: 'roleKey', message: 'Choose a staff role' }]);
    return this.prisma.role.findUniqueOrThrow({ where: { uniqueKey: `system:${key}` } });
  }

  async list() {
    const [members, invitations] = await Promise.all([
      this.db.tenantMember.findMany({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true, createdAt: true, role: { select: { key: true, name: true } }, user: { select: { id: true, fullName: true, email: true, lastLoginAt: true } } } }),
      this.db.staffInvitation.findMany({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const roles = await this.prisma.role.findMany({ where: { id: { in: invitations.map((i) => i.roleId) } }, select: { id: true, key: true, name: true } });
    return {
      members,
      invitations: invitations.map(({ tokenHash, ...i }) => ({ ...i, role: roles.find((r) => r.id === i.roleId) })),
      assignableRoles: (await this.prisma.role.findMany({ where: { uniqueKey: { in: ASSIGNABLE_ROLES.map((k) => `system:${k}`) } }, select: { key: true, name: true } })),
    };
  }

  async invite(email: string, roleKey: string, actorUserId: string, origin: string) {
    const tenantId = this.ctx.requireTenantId();
    const role = await this.role(roleKey);
    const [members, pending] = await Promise.all([
      this.db.tenantMember.count({ where: { status: 'ACTIVE' } }),
      this.db.staffInvitation.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    await this.entitlements.assertWithinLimit(tenantId, FEATURES.STAFF_MAX.key, members + pending);
    const existingUser = await this.prisma.user.findUnique({ where: { realmKey_email: { realmKey: 'platform', email } } });
    if (existingUser && (await this.db.tenantMember.findFirst({ where: { userId: existingUser.id, status: 'ACTIVE' } }))) {
      throw AppException.conflict('This person is already a member of your academy.');
    }
    await this.db.staffInvitation.updateMany({ where: { email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const token = randomToken(32);
    const inv = await this.db.staffInvitation.create({ data: { email, roleId: role.id, tokenHash: sha256(token), invitedById: actorUserId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) } as never });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
    const url = `${origin}/invite?token=${encodeURIComponent(token)}`;
    await this.mail.send({
      to: email, tenantId, tag: 'staff-invite',
      subject: `You're invited to join ${tenant.name}`,
      html: `<p>You've been invited to join <strong>${escapeHtml(tenant.name)}</strong> as <strong>${escapeHtml(role.name)}</strong>.</p><p><a href="${escapeHtml(url)}">Accept invitation</a></p><p style="color:#64748b;font-size:13px">This invitation expires in 7 days.</p>`,
      text: `You've been invited to join ${tenant.name} as ${role.name}: ${url} (expires in 7 days)`,
    });
    await this.audit.record({ action: 'staff.invite', tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'StaffInvitation', targetId: inv.id, after: { email, role: roleKey } });
    return { id: inv.id, email, expiresAt: inv.expiresAt };
  }

  async revokeInvitation(id: string, actorUserId: string) {
    const inv = await this.db.staffInvitation.findFirst({ where: { id, acceptedAt: null, revokedAt: null } });
    if (!inv) throw AppException.notFound('Invitation not found');
    await this.db.staffInvitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record({ action: 'staff.invite_revoke', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'StaffInvitation', targetId: id });
    return { revoked: true };
  }

  private async member(id: string) {
    const m = await this.db.tenantMember.findFirst({ where: { id, status: 'ACTIVE' }, include: { role: true } });
    if (!m) throw AppException.notFound('Member not found');
    if (m.role.key === TENANT_ROLES.OWNER) throw AppException.forbidden('The academy owner cannot be changed or removed.');
    return m;
  }

  async changeRole(memberId: string, roleKey: string, actorUserId: string) {
    const m = await this.member(memberId);
    const role = await this.role(roleKey);
    await this.db.tenantMember.update({ where: { id: memberId }, data: { roleId: role.id } });
    await this.authz.invalidate(m.userId);
    await this.audit.record({ action: 'staff.role_change', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'TenantMember', targetId: memberId, before: { role: m.role.key }, after: { role: roleKey } });
    return { updated: true };
  }

  async remove(memberId: string, actorUserId: string) {
    const m = await this.member(memberId);
    if (m.userId === actorUserId) throw AppException.forbidden('You cannot remove yourself.');
    await this.db.tenantMember.update({ where: { id: memberId }, data: { status: 'REMOVED' } });
    await this.authz.invalidate(m.userId);
    await this.audit.record({ action: 'staff.remove', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'TenantMember', targetId: memberId });
    return { removed: true };
  }

  // ── invitation acceptance (no tenant context: token identifies the tenant) ─────────
  async lookup(token: string) {
    const inv = await this.prisma.staffInvitation.findUnique({ where: { tokenHash: sha256(token) }, include: { tenant: { select: { name: true } } } });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) throw AppException.notFound('This invitation is invalid or has expired.');
    const role = await this.prisma.role.findUniqueOrThrow({ where: { id: inv.roleId }, select: { name: true } });
    const hasAccount = Boolean(await this.prisma.user.findUnique({ where: { realmKey_email: { realmKey: 'platform', email: inv.email } } }));
    return { inv, view: { academy: inv.tenant.name, role: role.name, email: inv.email, hasAccount } };
  }

  /** Adds the user to the tenant. The signed-in account's email must match the invitation. */
  async accept(token: string, user: { id: string; email: string }) {
    const { inv } = await this.lookup(token);
    if (inv.email !== user.email) throw AppException.forbidden(`This invitation was sent to ${inv.email}. Sign in with that account.`);
    await this.prisma.$transaction([
      this.prisma.tenantMember.upsert({
        where: { tenantId_userId: { tenantId: inv.tenantId, userId: user.id } },
        update: { status: 'ACTIVE', roleId: inv.roleId },
        create: { tenantId: inv.tenantId, userId: user.id, roleId: inv.roleId },
      }),
      this.prisma.staffInvitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
    ]);
    await this.authz.invalidate(user.id);
    await this.audit.record({ action: 'staff.join', tenantId: inv.tenantId, actorUserId: user.id, actorRealm: 'PLATFORM', targetType: 'StaffInvitation', targetId: inv.id });
    return { tenantId: inv.tenantId };
  }
}
