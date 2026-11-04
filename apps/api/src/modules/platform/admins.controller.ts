import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, PLATFORM_ROLES } from '@ce/shared';
import { ClientMetaParam, CurrentAuth, RequirePermissions, RequireRealm } from '../../common/decorators/auth.decorators.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { emailTemplates } from '../../core/mail/templates.js';
import { randomToken, sha256 } from '../../core/crypto/crypto.service.js';
import { AppConfig } from '../../config/app-config.service.js';
import type { AppRequest, AuthContext } from '../../core/tenancy/request-context.js';
import type { ClientMeta } from '../auth/services/session.service.js';
import { SessionService } from '../auth/services/session.service.js';
import { AuthzService } from '../authz/authz.service.js';
import { CreateAdminDto, UpdateAdminRolesDto } from './dto/platform.dto.js';

const ADMIN_ROLES = Object.values(PLATFORM_ROLES);

@ApiTags('Platform · Admins')
@ApiBearerAuth()
@RequireRealm('PLATFORM')
@RequirePermissions(PERMISSIONS.PLATFORM_ADMINS_MANAGE)
@Controller({ path: 'platform/admins', version: '1' })
export class AdminsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
    private readonly authz: AuthzService,
    private readonly config: AppConfig,
  ) {}

  @Get()
  async list() {
    const users = await this.prisma.user.findMany({
      where: { realm: 'PLATFORM', roles: { some: { role: { key: { in: ADMIN_ROLES } } } } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fullName: true, email: true, status: true, lastLoginAt: true, twoFactorEnabledAt: true, createdAt: true, roles: { select: { role: { select: { key: true, name: true } } } } },
    });
    return users.map(({ roles, ...u }) => ({ ...u, roles: roles.map((r) => r.role) }));
  }

  private async roleIds(keys: string[]) {
    const roles = await this.prisma.role.findMany({ where: { uniqueKey: { in: keys.map((k) => `system:${k}`) } } });
    return roles.map((r) => r.id);
  }

  private async superAdminCount(excludeUserId?: string) {
    return this.prisma.userRole.count({ where: { role: { key: 'SUPER_ADMIN' }, user: { status: 'ACTIVE' }, ...(excludeUserId ? { userId: { not: excludeUserId } } : {}) } });
  }

  @Post()
  @ApiOperation({ summary: 'Invite an administrator (they set a password via emailed link and must enrol 2FA)' })
  async create(@Body() dto: CreateAdminDto, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta, @Req() req: AppRequest) {
    if (!dto.roles.length) throw AppException.validation([{ field: 'roles', message: 'Choose at least one role' }]);
    const existing = await this.prisma.user.findUnique({ where: { realmKey_email: { realmKey: 'platform', email: dto.email } } });
    const ids = await this.roleIds(dto.roles);
    const user =
      existing ??
      (await this.prisma.user.create({ data: { realm: 'PLATFORM', realmKey: 'platform', email: dto.email, fullName: dto.fullName } }));
    for (const roleId of ids) await this.prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId } }, update: {}, create: { userId: user.id, roleId } });
    await this.authz.invalidate(user.id);

    if (!existing) {
      const token = randomToken(32);
      await this.prisma.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 72 * 3600_000) } });
      const url = `${req.protocol}://${req.get('host')}/reset-password?token=${encodeURIComponent(token)}`;
      const t = emailTemplates.passwordReset({ brand: this.config.get('APP_NAME'), name: user.fullName, url });
      await this.mail.send({ to: user.email, tag: 'admin-invite', subject: `You've been invited as an administrator`, html: t.html, text: t.text });
    }
    await this.audit.record({ action: 'admin.create', actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'User', targetId: user.id, after: { email: dto.email, roles: dto.roles }, ip: meta.ip, userAgent: meta.userAgent });
    return { id: user.id, invited: !existing };
  }

  @Put(':id/roles')
  async setRoles(@Param('id') id: string, @Body() dto: UpdateAdminRolesDto, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    if (id === auth.userId) throw AppException.forbidden('You cannot change your own roles.');
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, realm: true, roles: { select: { role: { select: { key: true } } } } } });
    if (!user || user.realm !== 'PLATFORM') throw AppException.notFound('Administrator not found');
    const wasSuper = user.roles.some((r) => r.role.key === 'SUPER_ADMIN');
    if (wasSuper && !dto.roles.includes('SUPER_ADMIN') && (await this.superAdminCount(id)) === 0) {
      throw AppException.conflict('At least one active super admin is required.');
    }
    const ids = await this.roleIds(dto.roles);
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id, role: { key: { in: ADMIN_ROLES } }, roleId: { notIn: ids } } }),
      ...ids.map((roleId) => this.prisma.userRole.upsert({ where: { userId_roleId: { userId: id, roleId } }, update: {}, create: { userId: id, roleId } })),
    ]);
    await this.authz.invalidate(id);
    await this.audit.record({ action: 'admin.roles_update', actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'User', targetId: id, before: { roles: user.roles.map((r) => r.role.key) }, after: { roles: dto.roles }, ip: meta.ip, userAgent: meta.userAgent });
    return this.list();
  }

  @Post(':id/suspend')
  @HttpCode(200)
  async suspend(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    if (id === auth.userId) throw AppException.forbidden('You cannot suspend yourself.');
    const user = await this.prisma.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
    if (!user || user.realm !== 'PLATFORM') throw AppException.notFound('Administrator not found');
    if (user.roles.some((r) => r.role.key === 'SUPER_ADMIN') && (await this.superAdminCount(id)) === 0) throw AppException.conflict('At least one active super admin is required.');
    await this.prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } });
    await this.sessions.revokeAllForUser(id, 'admin_suspended');
    await this.audit.record({ action: 'admin.suspend', actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'User', targetId: id, ip: meta.ip, userAgent: meta.userAgent });
    return { suspended: true };
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  async reactivate(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.realm !== 'PLATFORM') throw AppException.notFound('Administrator not found');
    await this.prisma.user.update({ where: { id }, data: { status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null } });
    await this.audit.record({ action: 'admin.reactivate', actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'User', targetId: id, ip: meta.ip, userAgent: meta.userAgent });
    return { reactivated: true };
  }
}
