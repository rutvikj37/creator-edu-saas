import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Redis } from 'ioredis';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants.js';

describe('Foundation (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await app.get<Redis>(REDIS_CLIENT).flushdb();
    await prisma.platformSetting.deleteMany();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/health reports database, redis and queue up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.info).toMatchObject({ database: { status: 'up' }, redis: { status: 'up' }, queue: { status: 'up' } });
  });

  it('GET /api/v1/system/info reads branding from MySQL', async () => {
    await prisma.platformSetting.create({ data: { group: 'branding', key: 'branding.name', value: 'Test Platform' } });
    await prisma.platformSetting.create({ data: { group: 'branding', key: 'branding.apiKey', value: 'hidden', isSecret: true } });
    const res = await request(app.getHttpServer()).get('/api/v1/system/info').expect(200);
    expect(res.body.data.name).toBe('Test Platform');
    expect(res.body.data.locales).toEqual(['en', 'hi', 'gu']);
    expect(res.body.data.branding.apiKey).toBeUndefined();
  });

  it('unknown routes return the standard error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('CORS allows platform subdomains and rejects foreign origins', async () => {
    const ok = await request(app.getHttpServer()).get('/api/v1/health/live').set('Origin', 'http://academy1.lvh.me:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://academy1.lvh.me:5173');
    const bad = await request(app.getHttpServer()).get('/api/v1/health/live').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits through Redis (limit 5/min in tests)', async () => {
    await app.get<Redis>(REDIS_CLIENT).flushdb();
    const server = app.getHttpServer();
    for (let i = 0; i < 5; i++) await request(server).get('/api/v1/system/info').expect(200);
    const res = await request(server).get('/api/v1/system/info').expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
