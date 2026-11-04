import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AppRequest, AuthContext } from '../../core/tenancy/request-context.js';

export const ALLOW_MFA_SETUP_KEY = 'allowMfaSetup';
/** Route stays reachable while an admin still has to enrol in two-factor authentication. */
export const AllowMfaSetup = () => SetMetadata(ALLOW_MFA_SETUP_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
/** Requires ALL listed permissions (default-deny RBAC). */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export const TENANT_SCOPE_KEY = 'tenantScope';
export type TenantScope = 'workspace' | 'academy';
/**
 * 'workspace': creator/staff panel — tenant comes from the user's verified membership.
 * 'academy':   academy host (public site, students) — tenant comes from the verified host.
 */
export const TenantScoped = (scope: TenantScope) => SetMetadata(TENANT_SCOPE_KEY, scope);

export const REALM_KEY = 'requiredRealm';
export const RequireRealm = (realm: 'PLATFORM' | 'TENANT') => SetMetadata(REALM_KEY, realm);

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  return ctx.switchToHttp().getRequest<AppRequest>().auth!;
});

export const ClientMetaParam = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  return { ip: req.ip, userAgent: req.get('user-agent') ?? undefined };
});
