import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AppConfig } from '../../../config/app-config.service.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { MailService } from '../../../core/mail/mail.service.js';
import { emailTemplates } from '../../../core/mail/templates.js';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { academyOrigin } from '../../tenants/academy-origin.js';
import { PasswordService } from './password.service.js';

/** 10-character login password from an alphabet without look-alikes (0/O, 1/l/I). */
export function generatePassword(length = 10): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
}

/**
 * Login details for buyers whose account was created at guest checkout (no password yet).
 * Called once access is granted (paid order or free enrolment): generates a password, stores
 * only its hash and emails it. The conditional update makes it once-only; never throws.
 */
@Injectable()
export class AccountCredentialsService {
  private readonly logger = new Logger(AccountCredentialsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  async sendIfPasswordless(tenantId: string, userId: string, items: string[]): Promise<boolean> {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true, passwordHash: true, status: true, deletedAt: true, realm: true } });
      if (!user || user.realm !== 'TENANT' || user.passwordHash || user.status !== 'ACTIVE' || user.deletedAt) return false;
      const password = generatePassword();
      const set = await this.prisma.user.updateMany({ where: { id: userId, passwordHash: null }, data: { passwordHash: await this.passwords.hash(password), passwordChangedAt: new Date() } });
      if (!set.count) return false;
      const { origin, name: brand } = await academyOrigin(this.prisma, this.config, tenantId);
      await this.mail.send({
        to: user.email, tenantId, tag: 'account-credentials', sensitive: true,
        ...emailTemplates.accountCredentials({ brand, name: user.fullName, email: user.email, password, items, url: `${origin}/login` }),
      });
      await this.audit.record({ action: 'student.credentials_issued', tenantId, actorRealm: 'SYSTEM', targetType: 'User', targetId: userId, after: { email: user.email } });
      return true;
    } catch (e) {
      this.logger.warn({ err: (e as Error).message, userId, tenantId }, 'login details email failed');
      return false;
    }
  }
}
