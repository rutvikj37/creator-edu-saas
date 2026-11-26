import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { AppConfig } from './config/app-config.service.js';
import { RedisIoAdapter } from './core/redis/redis-io.adapter.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  configureApp(app);
  const config = app.get(AppConfig);
  const redisIo = new RedisIoAdapter(app, config.get('REDIS_URL'));
  await redisIo.connectToRedis();
  app.useWebSocketAdapter(redisIo);
  const port = config.get('API_PORT');
  await app.listen(port, '0.0.0.0');
}
await bootstrap();
