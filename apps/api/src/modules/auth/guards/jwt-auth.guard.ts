import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { ERROR_CODES } from '@ce/shared';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator.js';
import { REALM_KEY } from '../../../common/decorators/auth.decorators.js';
import { AppException } from '../../../common/errors/app-exception.js';
import { CLS_AUTH, CLS_TENANT_ID, platformStaffAllowedOnHost, realmKeyOf, type AppRequest } from '../../../core/tenancy/request-context.js';
import { TokenService } from '../services/token.service.js';
import { SessionService } from '../services/session.service.js';
import { PlatformStudentLoginService } from '../services/platform-student-login.service.js';
/**
 * Global, default-deny authentication. Every route requires a valid access token unless
 * marked @Public(). Tokens are host-bound: academy students on that academy's hosts,
 * platform tokens on platform hosts, platform staff also on their active academy host,
 * and (when configured) that academy's students on the platform host.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly cls: ClsService,
    private readonly platformStudents: PlatformStudentLoginService,
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
    const hostOk =
      auth.realmKey === realmKeyOf(req.hostRealm) ||
      platformStaffAllowedOnHost(auth, req.hostRealm) ||
      (await this.platformStudents.studentAllowedOnPlatformHost(auth, req.hostRealm));
    if (!hostOk) {
      throw AppException.unauthenticated();
    }
    if (await this.sessions.isRevoked(auth.sessionId)) {
      throw new AppException(ERROR_CODES.INVALID_TOKEN, 'This session was signed out. Please sign in again.', HttpStatus.UNAUTHORIZED);
    }
    auth.mfaSetupRequired = false;
    const requiredRealm = this.reflector.getAllAndOverride<string>(REALM_KEY, targets);
    if (requiredRealm && requiredRealm !== auth.realm) throw AppException.forbidden();

    req.auth = auth;
    this.cls.set(CLS_AUTH, auth);
    if (auth.realm === 'TENANT') this.cls.set(CLS_TENANT_ID, auth.realmKey);
    return true;
  }
}
