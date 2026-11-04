/**
 * Idempotent seed: safe to run repeatedly. Phase 1 seeds default platform settings only.
 * Later phases add roles/permissions, the initial super admin and default plans.
 */
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { poolOptionsFromUrl } from '../src/core/prisma/prisma.service.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(poolOptionsFromUrl(url)) });

const defaults: Array<{ group: string; key: string; value: unknown }> = [
  { group: 'branding', key: 'branding.name', value: process.env.APP_NAME ?? 'Creator Education' },
  { group: 'branding', key: 'branding.tagline', value: 'Launch your academy. Teach. Grow.' },
  { group: 'general', key: 'general.defaultCurrency', value: 'INR' },
  { group: 'general', key: 'general.defaultTimezone', value: 'Asia/Kolkata' },
  { group: 'general', key: 'general.defaultLocale', value: 'en' },
  { group: 'registration', key: 'registration.creatorSignupEnabled', value: true },
  { group: 'system', key: 'system.maintenanceMode', value: false },
];

async function main() {
  for (const s of defaults) {
    // create-only: never overwrite values an administrator has changed
    await prisma.platformSetting.upsert({
      where: { key: s.key },
      update: {},
      create: { group: s.group, key: s.key, value: s.value as never },
    });
  }
  console.log(`Seeded ${defaults.length} platform settings`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
