/** System role keys. Tenant-defined custom roles are stored in the database. */
export const PLATFORM_ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  FINANCE_ADMIN: 'FINANCE_ADMIN',
  SUPPORT_ADMIN: 'SUPPORT_ADMIN',
});

export const TENANT_ROLES = Object.freeze({
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  INSTRUCTOR: 'INSTRUCTOR',
  CONTENT_MANAGER: 'CONTENT_MANAGER',
  SALES_MANAGER: 'SALES_MANAGER',
  SUPPORT_AGENT: 'SUPPORT_AGENT',
  STUDENT: 'STUDENT',
  AFFILIATE: 'AFFILIATE',
});

export const REALMS = Object.freeze({ PLATFORM: 'PLATFORM', TENANT: 'TENANT' });
