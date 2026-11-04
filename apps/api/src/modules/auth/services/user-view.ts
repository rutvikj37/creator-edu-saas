/** Fields safe to return to clients. Never include hashes, secrets or counters. */
export const PUBLIC_USER_SELECT = {
  id: true,
  realm: true,
  tenantId: true,
  email: true,
  emailVerifiedAt: true,
  phone: true,
  phoneVerifiedAt: true,
  fullName: true,
  country: true,
  locale: true,
  timezone: true,
  twoFactorEnabledAt: true,
  createdAt: true,
} as const;
