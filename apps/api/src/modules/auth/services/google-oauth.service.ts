import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createHash } from 'node:crypto';
import { ERROR_CODES } from '@ce/shared';
import { AppConfig } from '../../../config/app-config.service.js';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../../core/redis/redis.constants.js';
import { randomToken } from '../../../core/crypto/crypto.service.js';
import { AppException } from '../../../common/errors/app-exception.js';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

interface OAuthState {
  realmKey: string;
  returnOrigin: string;
  verifier: string;
  nonce: string;
}

/**
 * Google sign-in (OpenID Connect, authorization code + PKCE).
 * One redirect URI on the platform host serves every academy: after the callback the user
 * is sent back to the originating host with a single-use hand-off code, which that host
 * exchanges for a session (so cookies stay host-scoped and custom domains work).
 */
@Injectable()
export class GoogleOAuthService {
  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  isConfigured() {
    return Boolean(this.config.get('GOOGLE_CLIENT_ID') && this.config.get('GOOGLE_CLIENT_SECRET'));
  }

  private redirectUri() {
    return `${this.config.get('WEB_PUBLIC_URL')}/api/v1/auth/google/callback`;
  }

  async authorizationUrl(realmKey: string, returnOrigin: string): Promise<string> {
    if (!this.isConfigured()) throw AppException.integrationNotConfigured('Google sign-in');
    const state = randomToken(24);
    const verifier = randomToken(48);
    const nonce = randomToken(16);
    await this.redis.set(`oauth-state:${state}`, JSON.stringify({ realmKey, returnOrigin, verifier, nonce } satisfies OAuthState), 'EX', 600);
    const url = new URL(GOOGLE_AUTH);
    url.search = new URLSearchParams({
      client_id: this.config.get('GOOGLE_CLIENT_ID')!,
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  /** Exchanges the code, verifies the ID token and returns where to send the browser. */
  async handleCallback(code: string, stateParam: string): Promise<string> {
    const raw = await this.redis.getdel(`oauth-state:${stateParam}`);
    if (!raw) throw new AppException(ERROR_CODES.INVALID_TOKEN, 'Sign-in expired. Please try again.', HttpStatus.BAD_REQUEST);
    const state = JSON.parse(raw) as OAuthState;

    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.get('GOOGLE_CLIENT_ID')!,
        client_secret: this.config.get('GOOGLE_CLIENT_SECRET')!,
        redirect_uri: this.redirectUri(),
        grant_type: 'authorization_code',
        code_verifier: state.verifier,
      }),
    });
    if (!res.ok) throw new AppException(ERROR_CODES.BAD_REQUEST, 'Google sign-in failed. Please try again.', HttpStatus.BAD_GATEWAY);
    const { id_token: idToken } = (await res.json()) as { id_token?: string };
    if (!idToken) throw new AppException(ERROR_CODES.BAD_REQUEST, 'Google sign-in failed. Please try again.', HttpStatus.BAD_GATEWAY);

    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: this.config.get('GOOGLE_CLIENT_ID')! });
    if (payload.nonce !== state.nonce || !payload.email || payload.email_verified !== true || !payload.sub) {
      throw new AppException(ERROR_CODES.INVALID_TOKEN, 'Google did not confirm this email address.', HttpStatus.BAD_REQUEST);
    }
    const email = String(payload.email).toLowerCase();
    const userId = await this.findOrCreate(state.realmKey, String(payload.sub), email, String(payload.name ?? email.split('@')[0]));
    if (!userId) return `${state.returnOrigin}/login?error=google_no_account`;

    const handoff = randomToken(24);
    await this.redis.set(`oauth-handoff:${handoff}`, JSON.stringify({ userId, realmKey: state.realmKey }), 'EX', 60);
    return `${state.returnOrigin}/auth/callback?handoff=${encodeURIComponent(handoff)}`;
  }

  async consumeHandoff(code: string, realmKey: string): Promise<string> {
    const raw = await this.redis.getdel(`oauth-handoff:${code}`);
    const data = raw ? (JSON.parse(raw) as { userId: string; realmKey: string }) : null;
    if (!data || data.realmKey !== realmKey) throw new AppException(ERROR_CODES.INVALID_TOKEN, 'Sign-in expired. Please try again.', HttpStatus.UNAUTHORIZED);
    return data.userId;
  }

  /**
   * Links Google to an existing account in the realm. Academy students are created on first
   * sign-in; platform (creator) accounts must sign up first because they need an academy name.
   */
  private async findOrCreate(realmKey: string, sub: string, email: string, name: string): Promise<string | null> {
    const linked = await this.prisma.oAuthAccount.findUnique({ where: { provider_providerAccountId_realmKey: { provider: 'google', providerAccountId: sub, realmKey } } });
    if (linked) return linked.userId;
    let user = await this.prisma.user.findUnique({ where: { realmKey_email: { realmKey, email } } });
    if (!user && realmKey !== 'platform') {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: realmKey }, select: { status: true } });
      if (tenant?.status !== 'ACTIVE') return null;
      user = await this.prisma.user.create({ data: { realm: 'TENANT', realmKey, tenantId: realmKey, email, fullName: name.slice(0, 120), emailVerifiedAt: new Date() } });
    }
    if (!user) return null;
    await this.prisma.oAuthAccount.create({ data: { userId: user.id, provider: 'google', providerAccountId: sub, realmKey } });
    if (!user.emailVerifiedAt) await this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    return user.id;
  }
}
