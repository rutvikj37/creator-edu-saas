import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CoreModule } from './core/core.module.js';
import { AppConfig } from './config/app-config.service.js';
import { RedisThrottlerStorage } from './core/throttle/redis-throttler.storage.js';
import { ThrottleStorageModule } from './core/throttle/throttle-storage.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor.js';
import { HostResolverMiddleware } from './core/tenancy/host-resolver.middleware.js';
import { HealthModule } from './modules/health/health.module.js';
import { SystemModule } from './modules/system/system.module.js';
import { AuthzModule } from './modules/authz/authz.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { TenantsModule } from './modules/tenants/tenants.module.js';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard.js';
import { TenantGuard } from './modules/auth/guards/tenant.guard.js';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard.js';

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
    AuthzModule,
    AuthModule,
    TenantsModule,
    HealthModule,
    SystemModule,
  ],
  providers: [
    // Guard order matters: rate limit → authenticate → tenant context → permissions.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: TenantGuard },
    { provide: APP_GUARD, useExisting: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HostResolverMiddleware).forRoutes('{*path}');
  }
}
