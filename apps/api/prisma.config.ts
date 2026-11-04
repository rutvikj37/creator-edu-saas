import { defineConfig } from 'prisma/config';
import { existsSync } from 'node:fs';

// Load the monorepo-root .env for CLI commands (migrate, generate, studio).
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Not required for `prisma generate` (Docker/CI builds); commands that connect fail clearly without it.
    url: process.env.DATABASE_URL ?? '',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
