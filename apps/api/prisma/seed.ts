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

  // Starter plans are seeded only into an empty catalogue; afterwards Super Admin owns all plan data.
  if ((await client.subscriptionPlan.count()) === 0) {
    const plans = [
      { code: 'trial', name: 'Free Trial', description: 'Everything you need to launch, free for 14 days.', isDefault: true, trialDays: 14, sortOrder: 0,
        prices: [],
        features: { 'courses.max': 3, 'students.max': 100, 'staff.max': 1, 'storage.gb': 5, 'bandwidth.gb': 20, 'domains.custom': 0, website_builder: true, marketing: false, affiliates: false, live_classes: true, 'analytics.advanced': false, 'ai.credits': 50, white_label: false, 'commission.percent': 5 } },
      { code: 'growth', name: 'Growth', description: 'For growing academies selling every month.', isDefault: false, trialDays: 0, sortOrder: 1,
        prices: [{ interval: 'MONTH', currency: 'INR', amount: 2999 }, { interval: 'YEAR', currency: 'INR', amount: 29990 }, { interval: 'MONTH', currency: 'USD', amount: 49 }, { interval: 'YEAR', currency: 'USD', amount: 490 }],
        features: { 'courses.max': 50, 'students.max': 10000, 'staff.max': 5, 'storage.gb': 200, 'bandwidth.gb': 1000, 'domains.custom': 1, website_builder: true, marketing: true, affiliates: true, live_classes: true, 'analytics.advanced': true, 'ai.credits': 1000, white_label: false, 'commission.percent': 2 } },
      { code: 'pro', name: 'Pro', description: 'Unlimited scale with white-label branding.', isDefault: false, trialDays: 0, sortOrder: 2,
        prices: [{ interval: 'MONTH', currency: 'INR', amount: 7999 }, { interval: 'YEAR', currency: 'INR', amount: 79990 }, { interval: 'MONTH', currency: 'USD', amount: 129 }, { interval: 'YEAR', currency: 'USD', amount: 1290 }],
        features: { 'courses.max': null, 'students.max': null, 'staff.max': 25, 'storage.gb': 1000, 'bandwidth.gb': 5000, 'domains.custom': 5, website_builder: true, marketing: true, affiliates: true, live_classes: true, 'analytics.advanced': true, 'ai.credits': 5000, white_label: true, 'commission.percent': 0 } },
    ] as const;
    for (const p of plans) {
      await client.subscriptionPlan.create({
        data: {
          code: p.code, name: p.name, description: p.description, status: 'ACTIVE', isPublic: true, isDefault: p.isDefault, trialDays: p.trialDays, sortOrder: p.sortOrder,
          prices: { create: p.prices.map((x) => ({ interval: x.interval, currency: x.currency, amount: x.amount })) },
          features: {
            create: Object.entries(p.features).map(([featureKey, v]) =>
              typeof v === 'boolean' ? { featureKey, enabled: v } : { featureKey, enabled: true, limitValue: v === null ? null : BigInt(v) },
            ),
          },
        },
      });
    }
  }

  // Backfill: academies created before plans existed get the default plan.
  const defaultPlan = await client.subscriptionPlan.findFirst({ where: { isDefault: true, status: 'ACTIVE' }, include: { features: true } });
  if (defaultPlan) {
    const orphans = await client.tenant.findMany({ where: { status: { not: 'DELETED' }, subscriptions: { none: { currentKey: 'current' } } }, select: { id: true } });
    const snapshot = Object.fromEntries(defaultPlan.features.map((f) => [f.featureKey, { enabled: f.enabled, limit: f.limitValue === null ? null : f.limitValue.toString() }]));
    for (const t of orphans) {
      await client.subscription.create({
        data: { tenantId: t.id, planId: defaultPlan.id, status: 'ACTIVE', currentKey: 'current', currentPeriodStart: new Date(), featureSnapshot: snapshot as never, source: 'backfill' },
      });
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
