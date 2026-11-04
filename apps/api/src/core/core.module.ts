import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module.js';
import { AppLoggerModule } from './logger/logger.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { QueueModule } from './queue/queue.module.js';
import { AuditModule } from './audit/audit.module.js';
import { CryptoModule } from './crypto/crypto.module.js';
import { MailModule } from './mail/mail.module.js';
import { SmsModule } from './sms/sms.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';
import { StorageModule } from './storage/storage.module.js';

/** Infrastructure shared by the API and the worker processes. */
@Module({
  imports: [AppConfigModule, AppLoggerModule, PrismaModule, RedisModule, QueueModule, AuditModule, CryptoModule, MailModule, SmsModule, TenancyModule, StorageModule],
})
export class CoreModule {}
