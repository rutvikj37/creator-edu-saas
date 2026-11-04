import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../../generated/prisma/client.js';
import { AppConfig } from '../../config/app-config.service.js';

/** Builds mariadb-driver pool options from a mysql:// URL (driver works with MySQL 8). */
export function poolOptionsFromUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: Number(url.searchParams.get('connection_limit') ?? 10),
    // All timestamps are stored and read as UTC.
    timezone: 'Z',
    allowPublicKeyRetrieval: url.searchParams.get('allowPublicKeyRetrieval') !== 'false',
  };
}

/**
 * Root Prisma client. In Phase 2 a tenant-scoping extension is layered on top of this
 * (see docs/MULTI_TENANCY.md); repositories will use the extended client.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfig) {
    super({ adapter: new PrismaMariaDb(poolOptionsFromUrl(config.get('DATABASE_URL'))) });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
