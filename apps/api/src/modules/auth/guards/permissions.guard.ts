import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../../common/decorators/auth.decorators.js';
import { AppException } from '../../../common/errors/app-exception.js';
import type { AppRequest } from '../../../core/tenancy/request-context.js';
import { AuthzService } from '../../authz/authz.service.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthzService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.auth) throw AppException.unauthenticated();
    const granted = await this.authz.permissions(req.auth);
    if (!required.every((p) => granted.has(p))) throw AppException.forbidden();
    return true;
  }
}
