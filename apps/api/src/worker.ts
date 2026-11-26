import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('Worker started');
}

try {
  await bootstrap();
} catch (err) {
  // Nest may leave Redis/Prisma handles open after a DI failure; exit so pm2 restarts instead of a zombie with no processors.
  console.error(err);
  process.exit(1);
}
