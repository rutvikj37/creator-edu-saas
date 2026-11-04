import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CoreModule } from './core/core.module.js';
import { AppConfig } from './config/app-config.service.js';
import { RedisThrottlerStorage } from './core/throttle/redis-throttler.storage.js';
import { ThrottleStorageModule } from './core/throttle/throttle-storage.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor.js';
import { HealthModule } from './modules/health/health.module.js';
import { SystemModule } from './modules/system/system.module.js';

@Module({
  imports: [
    CoreModule,
    ThrottlerModule.forRootAsync({
      imports: [ThrottleStorageModule],
      inject: [AppConfig, RedisThrottlerStorage],
      useFactory: (config: AppConfig, storage: RedisThrottlerStorage) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: config.get('RATE_LIMIT_PER_MINUTE') }],
        storage,
      }),
    }),
    HealthModule,
    SystemModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class AppModule {}
