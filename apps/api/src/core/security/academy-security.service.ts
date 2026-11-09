import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.constants.js';

export const SECURITY_KEY = 'security';

export interface AcademySecurity {
  /** Devices a learner can be signed in on at once; 0 = no limit. */
  deviceLimit: number;
  /** Team members must use two-factor authentication to open the workspace. */
  teamTwoFactor: boolean;
  pdfWatermark: { enabled: boolean; color: string; fixedPosition: boolean };
  videoWatermark: { mode: 'off' | 'static' | 'dynamic'; showForSec: number; everySec: number };
}

export const DEFAULT_SECURITY: AcademySecurity = {
  deviceLimit: 0,
  teamTwoFactor: false,
  pdfWatermark: { enabled: false, color: '#100F0F', fixedPosition: false },
  videoWatermark: { mode: 'off', showForSec: 10, everySec: 20 },
};

const CACHE_TTL = 60;
const int = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Per-academy content and account security settings (stored as a tenant setting, cached briefly). */
@Injectable()
export class AcademySecurityService {
  constructor(private readonly prisma: PrismaService, @Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(tenantId: string) {
    return `academy-security:${tenantId}`;
  }

  async get(tenantId: string): Promise<AcademySecurity> {
    const cached = await this.redis.get(this.key(tenantId));
    if (cached) return JSON.parse(cached) as AcademySecurity;
    const row = await this.prisma.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: SECURITY_KEY } } });
    const v = (row?.value ?? {}) as Partial<AcademySecurity>;
    const merged: AcademySecurity = {
      ...DEFAULT_SECURITY, ...v,
      pdfWatermark: { ...DEFAULT_SECURITY.pdfWatermark, ...(v.pdfWatermark ?? {}) },
      videoWatermark: { ...DEFAULT_SECURITY.videoWatermark, ...(v.videoWatermark ?? {}) },
    };
    await this.redis.set(this.key(tenantId), JSON.stringify(merged), 'EX', CACHE_TTL);
    return merged;
  }

  async save(tenantId: string, input: Partial<AcademySecurity>, actor: { twoFactorEnabled: boolean }) {
    const cur = await this.get(tenantId);
    // Only fields that were sent change (DTOs may carry undefined for the rest).
    const defined = <T extends object>(o: T | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
    const patch = { ...defined(input), pdfWatermark: defined(input.pdfWatermark), videoWatermark: defined(input.videoWatermark) } as Partial<AcademySecurity>;
    const next: AcademySecurity = {
      ...cur, ...patch,
      pdfWatermark: { ...cur.pdfWatermark, ...(patch.pdfWatermark ?? {}) },
      videoWatermark: { ...cur.videoWatermark, ...(patch.videoWatermark ?? {}) },
    };
    const errors: { field: string; message: string }[] = [];
    if (!int(next.deviceLimit, 0, 20)) errors.push({ field: 'deviceLimit', message: '0 (no limit) to 20 devices' });
    if (!/^#[0-9A-Fa-f]{6}$/.test(next.pdfWatermark.color)) errors.push({ field: 'pdfWatermark.color', message: 'Use a hex colour like #100F0F' });
    if (!['off', 'static', 'dynamic'].includes(next.videoWatermark.mode)) errors.push({ field: 'videoWatermark.mode', message: 'Choose off, static or dynamic' });
    if (!int(next.videoWatermark.showForSec, 1, 600) || !int(next.videoWatermark.everySec, 1, 3600)) errors.push({ field: 'videoWatermark', message: 'Seconds must be whole numbers (show 1–600, every 1–3600)' });
    if (patch.teamTwoFactor && !cur.teamTwoFactor && !actor.twoFactorEnabled) errors.push({ field: 'teamTwoFactor', message: 'Turn on two-factor authentication for your own account first, so you don’t lock yourself out.' });
    if (errors.length) throw AppException.validation(errors);
    await this.prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: SECURITY_KEY } },
      create: { tenantId, key: SECURITY_KEY, value: next as never },
      update: { value: next as never },
    });
    await this.redis.del(this.key(tenantId));
    return next;
  }
}

@Global()
@Module({ providers: [AcademySecurityService], exports: [AcademySecurityService] })
export class AcademySecurityModule {}
