import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@ce/shared';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../../core/redis/redis.constants.js';
import { CryptoService } from '../../../core/crypto/crypto.service.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../../../core/crypto/totp.js';
import { AppException } from '../../../common/errors/app-exception.js';

const invalidCode = () => new AppException(ERROR_CODES.INVALID_TOKEN, 'The code is incorrect. Check your authenticator app and try again.', HttpStatus.BAD_REQUEST);

/** TOTP two-factor authentication. Secrets are encrypted at rest; each code works once. */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async beginSetup(user: { id: string; email: string }, issuer: string) {
    const secret = generateTotpSecret();
    await this.redis.set(`2fa-pending:${user.id}`, this.crypto.encrypt(secret), 'EX', 600);
    return { secret, otpauthUrl: otpauthUri(secret, user.email, issuer) };
  }

  async confirmSetup(userId: string, code: string) {
    const pending = await this.redis.get(`2fa-pending:${userId}`);
    if (!pending) throw new AppException(ERROR_CODES.INVALID_TOKEN, 'Setup expired. Start again.', HttpStatus.BAD_REQUEST);
    const secret = this.crypto.decrypt(pending);
    if (!(await this.consume(userId, secret, code))) throw invalidCode();
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecretEnc: pending, twoFactorEnabledAt: new Date() } });
    await this.redis.del(`2fa-pending:${userId}`);
  }

  async verify(user: { id: string; twoFactorSecretEnc: string | null }, code: string): Promise<boolean> {
    if (!user.twoFactorSecretEnc) return false;
    return this.consume(user.id, this.crypto.decrypt(user.twoFactorSecretEnc), code);
  }

  async disable(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecretEnc: null, twoFactorEnabledAt: null } });
  }

  /** Verifies and blocks replay of the same time-step code. */
  private async consume(userId: string, secret: string, code: string): Promise<boolean> {
    const step = verifyTotp(secret, code);
    if (step === null) return false;
    const fresh = await this.redis.set(`2fa-used:${userId}:${step}`, '1', 'EX', 120, 'NX');
    return fresh === 'OK';
  }
}
