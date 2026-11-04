import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { MailService } from '../../../core/mail/mail.service.js';
import { emailTemplates } from '../../../core/mail/templates.js';
import { randomToken, sha256 } from '../../../core/crypto/crypto.service.js';
import { AppException } from '../../../common/errors/app-exception.js';
import { ERROR_CODES } from '@ce/shared';
import { HttpStatus } from '@nestjs/common';
import { OtpService } from './otp.service.js';

const TTL_MS = 24 * 3600_000;

/** Email verification by link (token) or 6-digit code; both are single-use and hashed at rest. */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly otp: OtpService,
  ) {}

  async send(user: { id: string; email: string; fullName: string; tenantId: string | null }, origin: string, brand: string) {
    const token = randomToken(32);
    await this.prisma.emailVerification.create({
      data: { userId: user.id, email: user.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MS) },
    });
    const code = await this.otp.issue({ userId: user.id, channel: 'email', target: user.email, purpose: 'EMAIL_VERIFY', ttlMs: TTL_MS });
    const url = `${origin}/verify-email?token=${encodeURIComponent(token)}`;
    await this.mail.send({ to: user.email, tenantId: user.tenantId, tag: 'verify-email', ...emailTemplates.verifyEmail({ brand, name: user.fullName, url, code }) });
  }

  async verifyToken(token: string, realmKey: string) {
    const row = await this.prisma.emailVerification.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!row || row.usedAt || row.expiresAt < new Date() || row.user.realmKey !== realmKey || row.email !== row.user.email) {
      throw new AppException(ERROR_CODES.INVALID_TOKEN, 'This verification link is invalid or has expired.', HttpStatus.BAD_REQUEST);
    }
    await this.prisma.$transaction([
      this.prisma.emailVerification.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: row.user.emailVerifiedAt ?? new Date() } }),
    ]);
    return { userId: row.userId };
  }

  async verifyCode(user: { id: string; email: string }, code: string) {
    await this.otp.verify({ userId: user.id, target: user.email, purpose: 'EMAIL_VERIFY', code });
    await this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }
}
