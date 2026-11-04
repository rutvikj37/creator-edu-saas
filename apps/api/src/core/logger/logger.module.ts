import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import { AppConfig } from '../../config/app-config.service.js';

/** Absolute path to pino-pretty (dev dependency), or undefined when not installed (production). */
function prettyTarget(): string | undefined {
  try {
    return createRequire(import.meta.url).resolve('pino-pretty');
  } catch {
    return undefined;
  }
}

/** Paths redacted from every log line so secrets and credentials never reach log storage. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.secret',
  '*.apiKey',
];

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.isTest ? 'silent' : config.get('LOG_LEVEL'),
          redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
          genReqId: (req: IncomingMessage) => {
            const incoming = req.headers['x-request-id'];
            return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
          },
          customProps: () => ({ service: 'api' }),
          // Log the essentials only; full headers are noisy and risk leaking data.
          serializers: {
            req: (req: { id?: string; method?: string; url?: string }) => ({ id: req.id, method: req.method, url: req.url }),
            res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
          },
          autoLogging: { ignore: (req: IncomingMessage) => req.url?.startsWith('/api/v1/health') ?? false },
          transport: (() => {
            const target = !config.isProduction && !config.isTest ? prettyTarget() : undefined;
            return target ? { target, options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } } : undefined;
          })(),
        },
      }),
    }),
  ],
})
export class AppLoggerModule {}
