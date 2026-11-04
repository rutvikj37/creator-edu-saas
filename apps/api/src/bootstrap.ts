import { INestApplication, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppConfig } from './config/app-config.service.js';
import { createValidationPipe } from './common/validation.js';

/**
 * Applies HTTP-level configuration. Shared by main.ts and e2e tests so tests exercise
 * exactly the production pipeline (prefix, versioning, validation, security headers).
 */
export function configureApp(app: NestExpressApplication): INestApplication {
  const config = app.get(AppConfig);
  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.get('TRUSTED_PROXIES'));
  app.disable('x-powered-by');
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.useGlobalPipes(createValidationPipe());

  // Phase 1: platform app origin only. Phase 2 extends this with verified tenant domains.
  const root = config.get('PLATFORM_ROOT_DOMAIN').replace(/\./g, '\\.');
  const allowed = new RegExp(`^https?://([a-z0-9-]+\\.)*${root}(:\\d+)?$`, 'i');
  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || allowed.test(origin)),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  });

  if (config.swaggerEnabled) {
    const doc = new DocumentBuilder()
      .setTitle(`${config.get('APP_NAME')} API`)
      .setDescription('REST API v1. Responses use the { success, data, meta } / { success, error } envelope.')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, doc));
  }
  app.enableShutdownHooks();
  return app;
}
