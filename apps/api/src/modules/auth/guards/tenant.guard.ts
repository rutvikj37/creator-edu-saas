import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { ERROR_CODES } from '@ce/shared';
import { ALLOW_WHEN_SUSPENDED_KEY, FEATURE_KEY, TENANT_SCOPE_KEY, type TenantScope } from '../../../common/decorators/auth.decorators.js';
import { EntitlementsService } from '../../subscriptions/entitlements.service.js';
import { AppException } from '../../../common/errors/app-exception.js';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { CLS_TENANT_ID, type AppRequest } from '../../../core/tenancy/request-context.js';
import { PlatformStudentLoginService } from '../services/platform-student-login.service.js';

/**
 * Establishes the tenant context for tenant-scoped routes. The tenant is NEVER taken from
 * the request body/query: it comes from a verified membership (workspace) or verified host (academy).
 * Failures return 404 so tenant existence is not revealed.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly entitlements: EntitlementsService,
    private readonly platformStudents: PlatformStudentLoginService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.getAllAndOverride<TenantScope>(TENANT_SCOPE_KEY, [context.getHandler(), context.getClass()]);
    if (!scope) return true;
    const req = context.switchToHttp().getRequest<AppRequest>();

    if (scope === 'academy') {
      if (req.hostRealm?.kind === 'tenant') {
        this.cls.set(CLS_TENANT_ID, req.hostRealm.tenantId);
        return true;
      }
      // Platform LMS host bridge (PLATFORM_STUDENT_LOGIN_TENANT):
      // - Authenticated TENANT JWT (host-checked by JwtAuthGuard) → learner's academy
      // - Public academy APIs (no JWT attached) → same configured academy, so catalog /
      //   memberships / checkout work on lms.* without per-controller patches
      if (req.hostRealm?.kind === 'platform') {
        const auth = req.auth;
        if (auth?.realm === 'TENANT' && auth.realmKey) {
          this.cls.set(CLS_TENANT_ID, auth.realmKey);
          return true;
        }
        const bridged = await this.platformStudents.allowedTenantId();
        if (bridged) {
          this.cls.set(CLS_TENANT_ID, bridged);
          return true;
        }
      }
      throw AppException.notFound();
    }

    // workspace — platform app host, or the academy's own domain when the active tenant matches
    const auth = req.auth;
    if (!auth || auth.realm !== 'PLATFORM' || !req.hostRealm) throw AppException.notFound();
    if (req.hostRealm.kind === 'tenant') {
      if (auth.tenantId !== req.hostRealm.tenantId) throw AppException.notFound();
    } else if (req.hostRealm.kind !== 'platform') {
      throw AppException.notFound();
    }
    if (!auth.tenantId) throw new AppException(ERROR_CODES.NOT_FOUND, 'Select a workspace first.', HttpStatus.NOT_FOUND);
    const member = await this.prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId: auth.tenantId, userId: auth.userId } },
      select: { status: true, tenant: { select: { status: true } } },
    });
    if (!member || member.status !== 'ACTIVE' || member.tenant.status === 'DELETED') throw AppException.notFound();
    const targets = [context.getHandler(), context.getClass()];
    // Suspended / scheduled-for-deletion academies are read-only, except billing and support.
    if (
      (member.tenant.status === 'SUSPENDED' || member.tenant.status === 'PENDING_DELETION') &&
      req.method !== 'GET' &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_SUSPENDED_KEY, targets)
    ) {
      throw new AppException(ERROR_CODES.TENANT_SUSPENDED, 'This academy is suspended. Contact support to restore access.', HttpStatus.FORBIDDEN);
    }
    this.cls.set(CLS_TENANT_ID, auth.tenantId);
    const feature = this.reflector.getAllAndOverride<string>(FEATURE_KEY, targets);
    if (feature) await this.entitlements.assertFeature(auth.tenantId, feature);
    return true;
  }
}
