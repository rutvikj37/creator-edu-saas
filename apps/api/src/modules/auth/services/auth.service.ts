import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@ce/shared';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { AppException } from '../../../common/errors/app-exception.js';
import { realmKeyOf, type AuthContext, type HostRealm } from '../../../core/tenancy/request-context.js';
import { MailService } from '../../../core/mail/mail.service.js';
import { emailTemplates } from '../../../core/mail/templates.js';
import { AuthzService } from '../../authz/authz.service.js';
import { TenantsService } from '../../tenants/tenants.service.js';
import type { ChangePasswordDto, LoginDto, RegisterCreatorDto, RegisterStudentDto } from '../dto/auth.dto.js';
import { PasswordService } from './password.service.js';
import { SessionService, type ClientMeta, type IssuedSession } from './session.service.js';
import { TokenService } from './token.service.js';
import { TwoFactorService } from './two-factor.service.js';
import { PUBLIC_USER_SELECT } from './user-view.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export type LoginResult = { kind: 'session'; session: IssuedSession } | { kind: 'mfa'; mfaToken: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly twoFactor: TwoFactorService,
    private readonly authz: AuthzService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** Creator sign-up: platform user + tenant (ONBOARDING) + owner membership + subdomain, atomically. */
  async registerCreator(dto: RegisterCreatorDto, meta: ClientMeta) {
    const existing = await this.prisma.user.findUnique({ where: { realmKey_email: { realmKey: 'platform', email: dto.email } } });
    if (existing) throw AppException.conflict('An account with this email already exists. Sign in instead.');
    const passwordHash = await this.passwords.hash(dto.password);

    const { user, tenant } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { realm: 'PLATFORM', realmKey: 'platform', email: dto.email, phone: dto.phone, passwordHash, fullName: dto.fullName, country: dto.country, passwordChangedAt: new Date() },
      });
      const tenant = await this.tenants.createForOwner(tx, user, dto.businessName);
      await this.audit.record({ action: 'tenant.create', tenantId: tenant.id, actorUserId: user.id, actorRealm: 'PLATFORM', targetType: 'Tenant', targetId: tenant.id, after: { slug: tenant.slug, name: tenant.name }, ip: meta.ip, userAgent: meta.userAgent }, tx);
      return { user, tenant };
    });

    const session = await this.sessions.issue(user, { tenantId: tenant.id, mfaSetupRequired: false }, meta);
    await this.recordLogin(user.id, 'platform', dto.email, true, null, 'register', meta);
    return { user, tenant, session };
  }

  /** Student sign-up on an academy host. The academy must be live. */
  async registerStudent(dto: RegisterStudentDto, host: HostRealm, meta: ClientMeta) {
    if (host.kind !== 'tenant') throw AppException.notFound();
    if (host.status !== 'ACTIVE') throw AppException.forbidden('This academy is not accepting registrations yet.');
    const existing = await this.prisma.user.findUnique({ where: { realmKey_email: { realmKey: host.tenantId, email: dto.email } } });
    if (existing) throw AppException.conflict('An account with this email already exists. Sign in instead.');
    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.prisma.user.create({
      data: { realm: 'TENANT', realmKey: host.tenantId, tenantId: host.tenantId, email: dto.email, phone: dto.phone, passwordHash, fullName: dto.fullName, passwordChangedAt: new Date() },
    });
    const session = await this.sessions.issue(user, { tenantId: host.tenantId, mfaSetupRequired: false }, meta);
    await this.recordLogin(user.id, host.tenantId, dto.email, true, null, 'register', meta);
    return { user, session };
  }

  async login(dto: LoginDto, host: HostRealm, meta: ClientMeta): Promise<LoginResult> {
    const realmKey = realmKeyOf(host);
    const user = await this.prisma.user.findUnique({ where: { realmKey_email: { realmKey, email: dto.email } } });
    const invalid = new AppException(ERROR_CODES.INVALID_CREDENTIALS, 'Incorrect email or password.', HttpStatus.UNAUTHORIZED);

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await this.recordLogin(user.id, realmKey, dto.email, false, 'locked', 'password', meta);
      throw new AppException(ERROR_CODES.ACCOUNT_LOCKED, `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes or reset your password.`, HttpStatus.TOO_MANY_REQUESTS);
    }

    const ok = await this.passwords.verify(user?.passwordHash, dto.password);
    if (!user || !ok) {
      if (user) {
        const failed = user.failedLoginCount + 1;
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
        });
      }
      await this.recordLogin(user?.id ?? null, realmKey, dto.email, false, user ? 'bad_password' : 'unknown_user', 'password', meta);
      throw invalid;
    }
    if (user.status !== 'ACTIVE' || user.deletedAt) {
      await this.recordLogin(user.id, realmKey, dto.email, false, 'inactive', 'password', meta);
      throw AppException.forbidden('This account is not active. Contact support.');
    }
    if (host.kind === 'tenant' && host.status === 'SUSPENDED') throw AppException.forbidden('This academy is temporarily unavailable.');

    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });

    if (user.twoFactorEnabledAt) {
      return { kind: 'mfa', mfaToken: await this.tokens.signMfaChallenge(user.id, realmKey) };
    }
    return { kind: 'session', session: await this.startSession(user, realmKey, meta, 'password') };
  }

  mfaChallenge(userId: string, realmKey: string) {
    return this.tokens.signMfaChallenge(userId, realmKey);
  }

  async completeMfaLogin(mfaToken: string, code: string, host: HostRealm, meta: ClientMeta): Promise<IssuedSession> {
    const challenge = await this.tokens.verifyMfaChallenge(mfaToken);
    const realmKey = realmKeyOf(host);
    if (!challenge || challenge.realmKey !== realmKey) {
      throw new AppException(ERROR_CODES.INVALID_TOKEN, 'Your sign-in attempt expired. Please sign in again.', HttpStatus.UNAUTHORIZED);
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: challenge.userId } });
    if (!(await this.twoFactor.verify(user, code))) {
      await this.recordLogin(user.id, realmKey, user.email, false, 'bad_totp', 'totp', meta);
      throw new AppException(ERROR_CODES.INVALID_TOKEN, 'The code is incorrect. Try again.', HttpStatus.UNAUTHORIZED);
    }
    return this.startSession(user, realmKey, meta, 'totp');
  }

  /** Issues a session after all factors passed. Admins without 2FA get a restricted session. */
  async startSession(user: { id: string; realm: 'PLATFORM' | 'TENANT'; realmKey: string; email: string; twoFactorEnabledAt: Date | null }, realmKey: string, meta: ClientMeta, method: string) {
    let tenantId: string | null = null;
    let mfaSetupRequired = false;
    if (user.realm === 'PLATFORM') {
      const membership = await this.prisma.tenantMember.findFirst({ where: { userId: user.id, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { tenantId: true } });
      tenantId = membership?.tenantId ?? null;
      mfaSetupRequired = !user.twoFactorEnabledAt && (await this.authz.requiresMfa(user.id));
    } else {
      tenantId = user.realmKey;
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.recordLogin(user.id, realmKey, user.email, true, null, method, meta);
    if (user.realm === 'PLATFORM' && (await this.authz.platformRoleKeys(user.id)).length) {
      await this.audit.record({ action: 'auth.admin_login', actorUserId: user.id, actorRealm: 'PLATFORM', targetType: 'User', targetId: user.id, ip: meta.ip, userAgent: meta.userAgent, after: { method } });
    }
    return this.sessions.issue(user, { tenantId, mfaSetupRequired }, meta);
  }

  async refresh(refreshToken: string, host: HostRealm, meta: ClientMeta) {
    const rotated = await this.sessions.rotate(refreshToken, realmKeyOf(host), meta);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: rotated.user.id }, select: { twoFactorEnabledAt: true, realm: true } });
    const mfaSetupRequired = user.realm === 'PLATFORM' && !user.twoFactorEnabledAt && (await this.authz.requiresMfa(rotated.user.id));
    const auth: AuthContext = {
      userId: rotated.user.id,
      realm: rotated.user.realm,
      realmKey: rotated.user.realmKey,
      sessionId: rotated.familyId,
      tenantId: rotated.activeTenantId,
      mfaSetupRequired,
    };
    return { accessToken: await this.tokens.signAccess(auth), expiresIn: this.tokens.accessTtl, refreshToken: rotated.refreshToken, refreshExpiresAt: rotated.refreshExpiresAt, auth };
  }

  async me(auth: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: PUBLIC_USER_SELECT });
    const [platformRoles, permissions, memberships] = await Promise.all([
      this.authz.platformRoleKeys(auth.userId),
      this.authz.permissions(auth),
      auth.realm === 'PLATFORM'
        ? this.prisma.tenantMember.findMany({
            where: { userId: auth.userId, status: 'ACTIVE', tenant: { status: { not: 'DELETED' } } },
            select: { role: { select: { key: true, name: true } }, tenant: { select: { id: true, name: true, slug: true, status: true } } },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([]),
    ]);
    return {
      user,
      realm: auth.realm,
      activeTenantId: auth.tenantId,
      platformRoles,
      permissions: [...permissions].sort(),
      mfaSetupRequired: auth.mfaSetupRequired,
      memberships: memberships.map((m) => ({ ...m.tenant, role: m.role })),
    };
  }

  async switchTenant(auth: AuthContext, tenantId: string) {
    if (auth.realm !== 'PLATFORM') throw AppException.forbidden();
    const member = await this.prisma.tenantMember.findUnique({ where: { tenantId_userId: { tenantId, userId: auth.userId } }, select: { status: true, tenant: { select: { status: true } } } });
    if (!member || member.status !== 'ACTIVE' || member.tenant.status === 'DELETED') throw AppException.notFound('Workspace not found');
    await this.sessions.setActiveTenant(auth.sessionId, tenantId);
    const next: AuthContext = { ...auth, tenantId };
    return { accessToken: await this.tokens.signAccess(next), expiresIn: this.tokens.accessTtl };
  }

  async changePassword(auth: AuthContext, dto: ChangePasswordDto, meta: ClientMeta, brand: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!(await this.passwords.verify(user.passwordHash, dto.currentPassword))) {
      throw AppException.validation([{ field: 'currentPassword', message: 'Current password is incorrect' }]);
    }
    if (dto.currentPassword === dto.newPassword) throw AppException.validation([{ field: 'newPassword', message: 'Choose a password you have not used here' }]);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.passwords.hash(dto.newPassword), passwordChangedAt: new Date() } });
    const revoked = await this.sessions.revokeAllForUser(user.id, 'password_change', auth.sessionId);
    await this.audit.record({ action: 'auth.password_change', actorUserId: user.id, actorRealm: user.realm, tenantId: user.tenantId, targetType: 'User', targetId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    await this.mail.send({ to: user.email, tenantId: user.tenantId, tag: 'password-changed', ...emailTemplates.passwordChanged({ brand, name: user.fullName }) });
    return { otherSessionsSignedOut: revoked };
  }

  async recordLogin(userId: string | null, realmKey: string, email: string, success: boolean, failureReason: string | null, method: string, meta: ClientMeta) {
    await this.prisma.loginHistory.create({
      data: { userId, realmKey, emailTried: email.slice(0, 191), success, failureReason, method, ip: meta.ip?.slice(0, 45), userAgent: meta.userAgent?.slice(0, 512) },
    });
  }
}

