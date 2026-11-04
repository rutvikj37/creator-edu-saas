import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@ce/shared';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../../core/redis/redis.constants.js';
import { randomDigits, safeEqual, sha256 } from '../../../core/crypto/crypto.service.js';
import { AppException } from '../../../common/errors/app-exception.js';
import type { OtpPurpose } from '../../../generated/prisma/client.js';

const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

/** 6-digit one-time codes: hashed, expiring, attempt-limited and resend-throttled. */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async issue(p: { userId?: string; channel: 'email' | 'sms'; target: string; purpose: OtpPurpose; ttlMs?: number }): Promise<string> {
    // Keyed per account: the same email may belong to separate accounts in different academies.
    const cooldownKey = `otp-cooldown:${p.purpose}:${p.userId ?? p.target}`;
    const ok = await this.redis.set(cooldownKey, '1', 'EX', RESEND_COOLDOWN_SECONDS, 'NX');
    if (!ok) throw new AppException(ERROR_CODES.RATE_LIMITED, 'Please wait a minute before requesting another code.', HttpStatus.TOO_MANY_REQUESTS);
    const code = randomDigits(6);
    // Invalidate earlier unconsumed codes for the same purpose/target.
    await this.prisma.otpCode.updateMany({ where: { target: p.target, purpose: p.purpose, consumedAt: null, ...(p.userId ? { userId: p.userId } : {}) }, data: { consumedAt: new Date() } });
    await this.prisma.otpCode.create({
      data: { userId: p.userId, channel: p.channel, target: p.target, purpose: p.purpose, codeHash: sha256(code), expiresAt: new Date(Date.now() + (p.ttlMs ?? 600_000)) },
    });
    return code;
  }

  async verify(p: { userId?: string; target: string; purpose: OtpPurpose; code: string }): Promise<void> {
    const invalid = new AppException(ERROR_CODES.INVALID_TOKEN, 'The code is incorrect or has expired.', HttpStatus.BAD_REQUEST);
    const row = await this.prisma.otpCode.findFirst({
      where: { target: p.target, purpose: p.purpose, consumedAt: null, ...(p.userId ? { userId: p.userId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    if (!row || row.expiresAt < new Date() || row.attempts >= MAX_ATTEMPTS) throw invalid;
    if (!safeEqual(row.codeHash, sha256(p.code))) {
      await this.prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      throw invalid;
    }
    await this.prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  }
}
