import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module.js';
import { AppLoggerModule } from './logger/logger.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { QueueModule } from './queue/queue.module.js';
import { AuditModule } from './audit/audit.module.js';

/** Infrastructure shared by the API and the worker processes. */
@Module({
  imports: [AppConfigModule, AppLoggerModule, PrismaModule, RedisModule, QueueModule, AuditModule],
})
export class CoreModule {}
