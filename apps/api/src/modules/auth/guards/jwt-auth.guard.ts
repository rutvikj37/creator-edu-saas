import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { ERROR_CODES } from '@ce/shared';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator.js';
import { ALLOW_MFA_SETUP_KEY, REALM_KEY } from '../../../common/decorators/auth.decorators.js';
import { AppException } from '../../../common/errors/app-exception.js';
import { CLS_AUTH, CLS_TENANT_ID, realmKeyOf, type AppRequest } from '../../../core/tenancy/request-context.js';
import { TokenService } from '../services/token.service.js';
import { SessionService } from '../services/session.service.js';
import { AuthzService } from '../../authz/authz.service.js';

/**
 * Global, default-deny authentication. Every route requires a valid access token unless
 * marked @Public(). A token is only valid on hosts of its own realm: platform tokens on
 * platform hosts, academy tokens on that academy's hosts.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly cls: ClsService,
    private readonly authz: AuthzService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.hostRealm) throw AppException.notFound();

    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw AppException.unauthenticated();
    const auth = await this.tokens.verifyAccess(token);
    if (!auth) throw new AppException(ERROR_CODES.INVALID_TOKEN, 'Your session has expired. Please sign in again.', HttpStatus.UNAUTHORIZED);
    if (auth.realmKey !== realmKeyOf(req.hostRealm)) throw AppException.unauthenticated();
    if (await this.sessions.isRevoked(auth.sessionId)) {
      throw new AppException(ERROR_CODES.INVALID_TOKEN, 'This session was signed out. Please sign in again.', HttpStatus.UNAUTHORIZED);
    }
    // The token's setup flag can be stale when the requirement was lifted (role removed or ADMIN_MFA_REQUIRED=false).
    if (auth.mfaSetupRequired && !(await this.authz.requiresMfa(auth.userId))) auth.mfaSetupRequired = false;
    if (auth.mfaSetupRequired && !this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_SETUP_KEY, targets)) {
      throw new AppException(ERROR_CODES.MFA_SETUP_REQUIRED, 'Set up two-factor authentication to continue.', HttpStatus.FORBIDDEN);
    }
    const requiredRealm = this.reflector.getAllAndOverride<string>(REALM_KEY, targets);
    if (requiredRealm && requiredRealm !== auth.realm) throw AppException.forbidden();

    req.auth = auth;
    this.cls.set(CLS_AUTH, auth);
    if (auth.realm === 'TENANT') this.cls.set(CLS_TENANT_ID, auth.realmKey);
    return true;
  }
}
