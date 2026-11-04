import type { Request } from 'express';

/** Which realm the request's host belongs to. */
export type HostRealm =
  | { kind: 'platform' }
  | { kind: 'tenant'; tenantId: string; slug: string; status: string; hostname: string };

export interface AuthContext {
  userId: string;
  realm: 'PLATFORM' | 'TENANT';
  realmKey: string;
  /** Session family id (stable across refresh rotation). */
  sessionId: string;
  /** Active workspace tenant for platform users; the academy for tenant users. */
  tenantId: string | null;
  /** Set when an admin must finish 2FA enrolment before using anything else. */
  mfaSetupRequired: boolean;
}

export type AppRequest = Request & { id?: string; hostRealm?: HostRealm; auth?: AuthContext };

export const CLS_TENANT_ID = 'tenantId';
export const CLS_BYPASS_TENANT = 'bypassTenant';
export const CLS_AUTH = 'auth';

export function realmKeyOf(host: HostRealm): string {
  return host.kind === 'platform' ? 'platform' : host.tenantId;
}
