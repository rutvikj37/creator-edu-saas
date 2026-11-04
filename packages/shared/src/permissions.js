/**
 * Permission catalog. Seeded into the `Permission` table; roles map to these keys.
 * scope 'PLATFORM' = platform administration, 'TENANT' = inside one academy workspace.
 */
export const PERMISSIONS = Object.freeze({
  // Platform administration
  PLATFORM_TENANTS_READ: 'platform.tenants.read',
  PLATFORM_TENANTS_MANAGE: 'platform.tenants.manage',
  PLATFORM_TENANTS_DELETE: 'platform.tenants.delete',
  PLATFORM_PLANS_MANAGE: 'platform.plans.manage',
  PLATFORM_SETTINGS_MANAGE: 'platform.settings.manage',
  PLATFORM_ADMINS_MANAGE: 'platform.admins.manage',
  PLATFORM_AUDIT_READ: 'platform.audit.read',
  PLATFORM_FINANCE_READ: 'platform.finance.read',
  PLATFORM_FINANCE_MANAGE: 'platform.finance.manage',
  PLATFORM_SUPPORT_MANAGE: 'platform.support.manage',
  PLATFORM_CONTENT_MANAGE: 'platform.content.manage',
  PLATFORM_SYSTEM_READ: 'platform.system.read',
  // Academy workspace
  ACADEMY_MANAGE: 'academy.manage',
  COURSES_READ: 'courses.read',
  COURSES_MANAGE: 'courses.manage',
  STUDENTS_READ: 'students.read',
  STUDENTS_MANAGE: 'students.manage',
  ASSESSMENTS_GRADE: 'assessments.grade',
  ORDERS_READ: 'orders.read',
  REFUNDS_MANAGE: 'refunds.manage',
  COUPONS_MANAGE: 'coupons.manage',
  LIVE_MANAGE: 'live.manage',
  WEBSITE_MANAGE: 'website.manage',
  DOMAINS_MANAGE: 'domains.manage',
  MARKETING_MANAGE: 'marketing.manage',
  AFFILIATES_MANAGE: 'affiliates.manage',
  COMMUNITY_MANAGE: 'community.manage',
  CERTIFICATES_MANAGE: 'certificates.manage',
  ANALYTICS_READ: 'analytics.read',
  STAFF_MANAGE: 'staff.manage',
  INTEGRATIONS_MANAGE: 'integrations.manage',
  BILLING_MANAGE: 'billing.manage',
  SETTINGS_MANAGE: 'settings.manage',
  SUPPORT_MANAGE: 'support.manage',
});

const P = PERMISSIONS;
const all = Object.values(P);
const platformAll = all.filter((k) => k.startsWith('platform.'));
const tenantAll = all.filter((k) => !k.startsWith('platform.'));

export function permissionScope(key) {
  return key.startsWith('platform.') ? 'PLATFORM' : 'TENANT';
}

/** Default permissions for system roles (custom tenant roles are configured in-app). */
export const ROLE_PERMISSIONS = Object.freeze({
  SUPER_ADMIN: platformAll,
  PLATFORM_ADMIN: [P.PLATFORM_TENANTS_READ, P.PLATFORM_TENANTS_MANAGE, P.PLATFORM_CONTENT_MANAGE, P.PLATFORM_SETTINGS_MANAGE, P.PLATFORM_AUDIT_READ, P.PLATFORM_SYSTEM_READ],
  FINANCE_ADMIN: [P.PLATFORM_TENANTS_READ, P.PLATFORM_FINANCE_READ, P.PLATFORM_FINANCE_MANAGE],
  SUPPORT_ADMIN: [P.PLATFORM_TENANTS_READ, P.PLATFORM_SUPPORT_MANAGE],
  OWNER: tenantAll,
  ADMIN: tenantAll.filter((k) => k !== P.BILLING_MANAGE),
  INSTRUCTOR: [P.COURSES_READ, P.COURSES_MANAGE, P.STUDENTS_READ, P.ASSESSMENTS_GRADE, P.LIVE_MANAGE, P.COMMUNITY_MANAGE, P.ANALYTICS_READ],
  CONTENT_MANAGER: [P.COURSES_READ, P.COURSES_MANAGE, P.WEBSITE_MANAGE, P.CERTIFICATES_MANAGE],
  SALES_MANAGER: [P.ORDERS_READ, P.COUPONS_MANAGE, P.MARKETING_MANAGE, P.AFFILIATES_MANAGE, P.ANALYTICS_READ, P.STUDENTS_READ],
  SUPPORT_AGENT: [P.STUDENTS_READ, P.ORDERS_READ, P.SUPPORT_MANAGE],
  STUDENT: [],
  AFFILIATE: [],
});

/** Platform roles that must use two-factor authentication. */
export const MFA_REQUIRED_ROLES = Object.freeze(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN']);
