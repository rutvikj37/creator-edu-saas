import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { createId } from './id.js';
import { AppConfig } from '../../../config/app-config.service.js';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../../core/redis/redis.constants.js';
import { randomToken, sha256 } from '../../../core/crypto/crypto.service.js';
import { AppException } from '../../../common/errors/app-exception.js';
import type { AuthContext } from '../../../core/tenancy/request-context.js';
import { TokenService } from './token.service.js';
import { ERROR_CODES } from '@ce/shared';
import { HttpStatus } from '@nestjs/common';

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresAt: Date;
  auth: AuthContext;
}

/**
 * A rotated token presented again within this window is treated as a benign race
 * (two tabs refreshing at once), not theft. Overridable for tests.
 */
const reuseGraceMs = () => Number(process.env.REFRESH_REUSE_GRACE_MS ?? 10_000);

/**
 * Refresh-token sessions with rotation and reuse detection.
 * - Each refresh creates a new row in the same family and marks the old one rotated.
 * - Presenting an old (rotated) token after the grace window revokes the whole family.
 * - Revoked families are also flagged in Redis so outstanding access tokens stop working
 *   immediately instead of at expiry.
 */
@Injectable()
export class SessionService {
  private readonly refreshTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    config: AppConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.refreshTtlMs = config.get('REFRESH_TOKEN_TTL_DAYS') * 86_400_000;
  }

  private revokedKey(familyId: string) {
    return `revoked-session:${familyId}`;
  }

  async isRevoked(familyId: string): Promise<boolean> {
    return (await this.redis.exists(this.revokedKey(familyId))) === 1;
  }

  async issue(
    user: { id: string; realm: 'PLATFORM' | 'TENANT'; realmKey: string },
    opts: { tenantId: string | null; mfaSetupRequired: boolean; familyId?: string },
    meta: ClientMeta,
  ): Promise<IssuedSession> {
    const familyId = opts.familyId ?? createId();
    const refreshToken = randomToken(32);
    const expiresAt = new Date(Date.now() + this.refreshTtlMs);
    await this.prisma.userSession.create({
      data: {
        userId: user.id,
        familyId,
        refreshTokenHash: sha256(refreshToken),
        activeTenantId: opts.tenantId,
        ip: meta.ip?.slice(0, 45),
        userAgent: meta.userAgent?.slice(0, 512),
        expiresAt,
      },
    });
    const auth: AuthContext = {
      userId: user.id,
      realm: user.realm,
      realmKey: user.realmKey,
      sessionId: familyId,
      tenantId: opts.tenantId,
      mfaSetupRequired: opts.mfaSetupRequired,
    };
    return { accessToken: await this.tokens.signAccess(auth), refreshToken, expiresIn: this.tokens.accessTtl, refreshExpiresAt: expiresAt, auth };
  }

  /** Validates and rotates a refresh token. Returns the session row data needed to mint a new access token. */
  async rotate(refreshToken: string, expectedRealmKey: string, meta: ClientMeta) {
    const invalid = () => new AppException(ERROR_CODES.INVALID_TOKEN, 'Your session has expired. Please sign in again.', HttpStatus.UNAUTHORIZED);
    const hash = sha256(refreshToken);
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: hash },
      include: { user: { select: { id: true, realm: true, realmKey: true, status: true, deletedAt: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw invalid();
    if (session.user.realmKey !== expectedRealmKey) throw invalid();
    if (session.user.status !== 'ACTIVE' || session.user.deletedAt) {
      await this.revokeFamily(session.familyId, 'user_inactive');
      throw invalid();
    }
    if (session.rotatedAt) {
      if (Date.now() - session.rotatedAt.getTime() >= reuseGraceMs()) {
        await this.revokeFamily(session.familyId, 'refresh_token_reuse');
      }
      throw invalid();
    }

    // Atomic claim: only one concurrent request can rotate this row.
    const claimed = await this.prisma.userSession.updateMany({
      where: { id: session.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date(), lastUsedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalid();

    const newToken = randomToken(32);
    await this.prisma.userSession.create({
      data: {
        userId: session.userId,
        familyId: session.familyId,
        refreshTokenHash: sha256(newToken),
        activeTenantId: session.activeTenantId,
        ip: meta.ip?.slice(0, 45) ?? session.ip,
        userAgent: meta.userAgent?.slice(0, 512) ?? session.userAgent,
        expiresAt: session.expiresAt, // absolute lifetime does not extend on rotation
      },
    });
    return { user: session.user, familyId: session.familyId, activeTenantId: session.activeTenantId, refreshToken: newToken, refreshExpiresAt: session.expiresAt };
  }

  async revokeFamily(familyId: string, reason: string) {
    await this.prisma.userSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
    await this.redis.set(this.revokedKey(familyId), reason, 'EX', this.tokens.accessTtl + 60);
  }

  async revokeAllForUser(userId: string, reason: string, exceptFamilyId?: string) {
    const families = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, ...(exceptFamilyId ? { familyId: { not: exceptFamilyId } } : {}) },
      distinct: ['familyId'],
      select: { familyId: true },
    });
    for (const f of families) await this.revokeFamily(f.familyId, reason);
    return families.length;
  }

  /** Active devices: the current (unrotated, unrevoked, unexpired) row of each family. */
  async listActive(userId: string) {
    return this.prisma.userSession.findMany({
      where: { userId, rotatedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { familyId: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
  }

  async setActiveTenant(familyId: string, tenantId: string | null) {
    await this.prisma.userSession.updateMany({ where: { familyId, rotatedAt: null, revokedAt: null }, data: { activeTenantId: tenantId } });
  }
}
