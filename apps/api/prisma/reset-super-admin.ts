/**
 * Makes SUPER_ADMIN_EMAIL a Super Admin whose password is SUPER_ADMIN_INITIAL_PASSWORD (from .env):
 * creates the account if needed, otherwise resets its password and clears any login lockout.
 * Outside production a password shorter than 12 characters is accepted with a warning.
 * Usage: pnpm --filter @ce/api db:reset-admin
 */
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import argon2 from 'argon2';
import { PLATFORM_ROLES } from '@ce/shared';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { poolOptionsFromUrl } from '../src/core/prisma/prisma.service.js';

const url = process.env.DATABASE_URL;
const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SUPER_ADMIN_INITIAL_PASSWORD;
if (!url || !email || !password) throw new Error('DATABASE_URL, SUPER_ADMIN_EMAIL and SUPER_ADMIN_INITIAL_PASSWORD are required');
if (password.length < 12) {
  if (process.env.NODE_ENV === 'production') throw new Error('SUPER_ADMIN_INITIAL_PASSWORD must be at least 12 characters');
  console.warn('Warning: SUPER_ADMIN_INITIAL_PASSWORD is shorter than 12 characters — fine for local development only.');
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(poolOptionsFromUrl(url)) });
try {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const existing = await prisma.user.findUnique({ where: { realmKey_email: { realmKey: 'platform', email } } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
    console.log(`Password updated for ${email}`);
  } else {
    const user = await prisma.user.create({
      data: { realm: 'PLATFORM', realmKey: 'platform', email, fullName: 'Super Admin', emailVerifiedAt: new Date(), passwordChangedAt: new Date(), passwordHash },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { uniqueKey: `system:${PLATFORM_ROLES.SUPER_ADMIN}` } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    console.log(`Created super admin ${email} (two-factor setup is required at first sign-in)`);
  }
} finally {
  await prisma.$disconnect();
}
