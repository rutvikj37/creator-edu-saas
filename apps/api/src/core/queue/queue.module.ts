import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppConfig } from '../../config/app-config.service.js';
import { QUEUES } from './queue.constants.js';

/** Registers the BullMQ connection and producer handles for every queue. */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => {
        const url = new URL(config.get('REDIS_URL'));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            username: url.username || undefined,
            password: url.password ? decodeURIComponent(url.password) : undefined,
            db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
            tls: url.protocol === 'rediss:' ? {} : undefined,
          },
          prefix: config.isTest ? 'ce-test' : 'ce',
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { age: 24 * 3600, count: 1000 },
            removeOnFail: { age: 7 * 24 * 3600 },
          },
        };
      },
    }),
    BullModule.registerQueue(...Object.values(QUEUES).map((name) => ({ name }))),
  ],
  exports: [BullModule],
})
export class QueueModule {}
