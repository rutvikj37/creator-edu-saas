/**
 * Idempotent seed — safe to run on every deploy.
 *  - default platform settings (create-only; never overwrites admin changes)
 *  - permission catalog and system roles (kept in sync with packages/shared)
 *  - initial super admin from SUPER_ADMIN_EMAIL / SUPER_ADMIN_INITIAL_PASSWORD (created once)
 */
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import argon2 from 'argon2';
import { PERMISSIONS, ROLE_PERMISSIONS, PLATFORM_ROLES, TENANT_ROLES, permissionScope } from '@ce/shared';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { poolOptionsFromUrl } from '../src/core/prisma/prisma.service.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(poolOptionsFromUrl(url)) });

const settings: Array<{ group: string; key: string; value: unknown }> = [
  { group: 'branding', key: 'branding.name', value: process.env.APP_NAME ?? 'Creator Education' },
  { group: 'branding', key: 'branding.tagline', value: 'Launch your academy. Teach. Grow.' },
  { group: 'general', key: 'general.defaultCurrency', value: 'INR' },
  { group: 'general', key: 'general.defaultTimezone', value: 'Asia/Kolkata' },
  { group: 'general', key: 'general.defaultLocale', value: 'en' },
  { group: 'registration', key: 'registration.creatorSignupEnabled', value: true },
  { group: 'system', key: 'system.maintenanceMode', value: false },
];

const ROLE_NAMES: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', PLATFORM_ADMIN: 'Platform Admin', FINANCE_ADMIN: 'Finance Admin', SUPPORT_ADMIN: 'Support Admin',
  OWNER: 'Owner', ADMIN: 'Admin', INSTRUCTOR: 'Instructor', CONTENT_MANAGER: 'Content Manager', SALES_MANAGER: 'Sales Manager',
  SUPPORT_AGENT: 'Support Agent', STUDENT: 'Student', AFFILIATE: 'Affiliate',
};

export async function seed(client: PrismaClient = prisma) {
  for (const s of settings) {
    await client.platformSetting.upsert({ where: { key: s.key }, update: {}, create: { group: s.group, key: s.key, value: s.value as never } });
  }

  const permIds = new Map<string, string>();
  for (const key of Object.values(PERMISSIONS)) {
    const p = await client.permission.upsert({ where: { key }, update: { scope: permissionScope(key) }, create: { key, scope: permissionScope(key) } });
    permIds.set(key, p.id);
  }

  const platformKeys = new Set(Object.values(PLATFORM_ROLES));
  for (const key of [...Object.values(PLATFORM_ROLES), ...Object.values(TENANT_ROLES)]) {
    const scope = platformKeys.has(key) ? 'PLATFORM' : 'TENANT';
    const role = await client.role.upsert({
      where: { uniqueKey: `system:${key}` },
      update: { name: ROLE_NAMES[key], scope },
      create: { uniqueKey: `system:${key}`, key, name: ROLE_NAMES[key] ?? key, scope, isSystem: true },
    });
    // Sync system role permissions exactly with the catalog.
    const wanted = (ROLE_PERMISSIONS[key] ?? []).map((k) => permIds.get(k)!);
    await client.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: wanted } } });
    for (const permissionId of wanted) {
      await client.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId } }, update: {}, create: { roleId: role.id, permissionId } });
    }
  }

  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_INITIAL_PASSWORD;
  if (email && password) {
    if (password.length < 12) throw new Error('SUPER_ADMIN_INITIAL_PASSWORD must be at least 12 characters');
    const existing = await client.user.findUnique({ where: { realmKey_email: { realmKey: 'platform', email } } });
    if (!existing) {
      const user = await client.user.create({
        data: {
          realm: 'PLATFORM', realmKey: 'platform', email, fullName: 'Super Admin', emailVerifiedAt: new Date(), passwordChangedAt: new Date(),
          passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
        },
      });
      const role = await client.role.findUniqueOrThrow({ where: { uniqueKey: `system:${PLATFORM_ROLES.SUPER_ADMIN}` } });
      await client.userRole.create({ data: { userId: user.id, roleId: role.id } });
      console.log(`Created super admin ${email} (two-factor setup is required at first sign-in)`);
    }
  }
  console.log(`Seeded ${settings.length} settings, ${permIds.size} permissions, ${platformKeys.size + Object.keys(TENANT_ROLES).length} roles`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
