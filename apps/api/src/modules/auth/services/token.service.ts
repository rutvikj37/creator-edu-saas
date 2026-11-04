import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { AppConfig } from '../../../config/app-config.service.js';
import type { AuthContext } from '../../../core/tenancy/request-context.js';

const ISSUER = 'ce-api';
const AUDIENCE = 'ce-app';

interface AccessClaims {
  realm: 'PLATFORM' | 'TENANT';
  rk: string;
  sid: string;
  tid?: string | null;
  mfa?: 'setup';
  typ: 'access';
}

/** Signs and verifies short-lived JWTs (HS256). Access tokens live only in SPA memory. */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;
  readonly accessTtl: number;

  constructor(config: AppConfig) {
    this.key = new TextEncoder().encode(config.get('JWT_ACCESS_SECRET'));
    this.accessTtl = config.get('JWT_ACCESS_TTL');
  }

  signAccess(ctx: AuthContext): Promise<string> {
    const claims: AccessClaims = { realm: ctx.realm, rk: ctx.realmKey, sid: ctx.sessionId, tid: ctx.tenantId, typ: 'access' };
    if (ctx.mfaSetupRequired) claims.mfa = 'setup';
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ctx.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtl}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AuthContext | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
      if (payload.typ !== 'access' || !payload.sub) return null;
      return {
        userId: payload.sub,
        realm: payload.realm as AuthContext['realm'],
        realmKey: String(payload.rk),
        sessionId: String(payload.sid),
        tenantId: (payload.tid as string | null | undefined) ?? null,
        mfaSetupRequired: payload.mfa === 'setup',
      };
    } catch {
      return null;
    }
  }

  /** Short-lived token proving the password step succeeded; exchanged with a TOTP code. */
  signMfaChallenge(userId: string, realmKey: string): Promise<string> {
    return new SignJWT({ typ: 'mfa', rk: realmKey })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.key);
  }

  async verifyMfaChallenge(token: string): Promise<{ userId: string; realmKey: string } | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
      return payload.typ === 'mfa' && payload.sub ? { userId: payload.sub, realmKey: String(payload.rk) } : null;
    } catch {
      return null;
    }
  }
}
