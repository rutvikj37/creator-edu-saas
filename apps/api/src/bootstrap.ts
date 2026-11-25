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
  // One JSON parser for normal requests and LiveKit webhooks (application/webhook+json); registering it
  // replaces Nest's default JSON parser, so both types must be listed. Raw bodies are kept for signatures.
  app.useBodyParser('json', { type: ['application/json', 'application/*+json'] });
  app.useGlobalPipes(createValidationPipe());

  // Platform / admin hosts + any subdomain of the root (academy sites). Custom domains are same-origin via nginx.
  const root = config.get('PLATFORM_ROOT_DOMAIN').replace(/\./g, '\\.');
  const underRoot = new RegExp(`^https?://([a-z0-9-]+\\.)*${root}(:\\d+)?$`, 'i');
  const extraHosts = [config.get('APP_HOST'), config.get('ADMIN_HOST')].filter(Boolean).map((h) => h.toLowerCase());
  const isAllowedOrigin = (origin: string) => {
    if (underRoot.test(origin)) return true;
    try {
      return extraHosts.includes(new URL(origin).hostname.toLowerCase());
    } catch {
      return false;
    }
  };
  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || isAllowedOrigin(origin)),
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
