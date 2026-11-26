import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@ce/shared';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { MailService } from '../../../core/mail/mail.service.js';
import { emailTemplates } from '../../../core/mail/templates.js';
import { randomToken, sha256 } from '../../../core/crypto/crypto.service.js';
import { AppException } from '../../../common/errors/app-exception.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

const TTL_MS = 30 * 60_000;

import { AcademyPreferencesService } from '../../../core/settings/academy-preferences.service.js';
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly prefs: AcademyPreferencesService,
  ) {}

  /** Always succeeds from the caller's perspective so accounts cannot be enumerated. */
  async request(email: string, realmKey: string, origin: string, brand: string, tenantIdForStaff?: string) {
    let user = await this.prisma.user.findUnique({ where: { realmKey_email: { realmKey, email } } });
    // Agency staff may reset from their academy domain even though the account lives in the platform realm.
    if ((!user || user.status !== 'ACTIVE' || user.deletedAt) && tenantIdForStaff && realmKey !== 'platform') {
      const staff = await this.prisma.user.findUnique({ where: { realmKey_email: { realmKey: 'platform', email } } });
      if (staff && staff.status === 'ACTIVE' && !staff.deletedAt) {
        const member = await this.prisma.tenantMember.findUnique({
          where: { tenantId_userId: { tenantId: tenantIdForStaff, userId: staff.id } },
          select: { status: true },
        });
        if (member?.status === 'ACTIVE') user = staff;
      }
    }
    if (!user || user.status !== 'ACTIVE' || user.deletedAt) {
      this.logger.log({ realmKey }, 'password reset requested for unknown account');
      return;
    }
    await this.prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    const token = randomToken(32);
    await this.prisma.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MS) } });
    const url = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
    await this.mail.send({ to: user.email, tenantId: user.tenantId, tag: 'password-reset', ...emailTemplates.passwordReset({ brand, name: user.fullName, url }) });
  }

  async reset(token: string, newPassword: string, realmKey: string, brand: string, meta: { ip?: string; userAgent?: string }, tenantIdForStaff?: string) {
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    const realmOk =
      row &&
      (row.user.realmKey === realmKey ||
        (row.user.realmKey === 'platform' &&
          tenantIdForStaff &&
          realmKey === tenantIdForStaff));
    if (!row || row.usedAt || row.expiresAt < new Date() || !realmOk) {
      throw new AppException(ERROR_CODES.INVALID_TOKEN, 'This reset link is invalid or has expired. Request a new one.', HttpStatus.BAD_REQUEST);
    }
    if (row.user.realmKey === 'platform' && tenantIdForStaff) {
      const member = await this.prisma.tenantMember.findUnique({
        where: { tenantId_userId: { tenantId: tenantIdForStaff, userId: row.userId } },
        select: { status: true },
      });
      if (!member || member.status !== 'ACTIVE') {
        throw new AppException(ERROR_CODES.INVALID_TOKEN, 'This reset link is invalid or has expired. Request a new one.', HttpStatus.BAD_REQUEST);
      }
    }
    if (row.user.realm === 'TENANT') await this.prefs.assertPasswordAllowed(row.user.tenantId, newPassword);
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: row.userId },
        // A successful reset also proves control of the email address and clears lockouts.
        data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: row.user.emailVerifiedAt ?? new Date() },
      }),
    ]);
    await this.sessions.revokeAllForUser(row.userId, 'password_reset');
    await this.audit.record({ action: 'auth.password_reset', actorUserId: row.userId, actorRealm: row.user.realm, tenantId: row.user.tenantId, targetType: 'User', targetId: row.userId, ip: meta.ip, userAgent: meta.userAgent });
    await this.mail.send({ to: row.user.email, tenantId: row.user.tenantId, tag: 'password-changed', ...emailTemplates.passwordChanged({ brand, name: row.user.fullName }) });
  }
}
