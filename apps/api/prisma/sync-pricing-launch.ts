/** CLI: node --import tsx prisma/sync-pricing-launch.ts */
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { poolOptionsFromUrl } from '../src/core/prisma/prisma.service.js';
import { syncPricingLaunch } from './pricing-launch.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(poolOptionsFromUrl(url)) });

syncPricingLaunch(prisma)
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
