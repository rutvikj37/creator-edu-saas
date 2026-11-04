import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants.js';
import { api, createTestApp, PLATFORM, resetDatabase } from './helpers.js';

describe('Foundation (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/health reports database, redis and queue up', async () => {
    const res = await api(app).get('/api/v1/health').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.info).toMatchObject({ database: { status: 'up' }, redis: { status: 'up' }, queue: { status: 'up' } });
  });

  it('GET /api/v1/system/info reads branding from MySQL and hides secrets', async () => {
    await prisma.platformSetting.update({ where: { key: 'branding.name' }, data: { value: 'Test Platform' } });
    await prisma.platformSetting.create({ data: { group: 'branding', key: 'branding.apiKey', value: 'hidden', isSecret: true } });
    const res = await api(app).get('/api/v1/system/info').expect(200);
    expect(res.body.data.name).toBe('Test Platform');
    expect(res.body.data.locales).toEqual(['en', 'hi', 'gu']);
    expect(res.body.data.branding.apiKey).toBeUndefined();
  });

  it('unknown routes return the standard error envelope', async () => {
    const res = await api(app).get('/api/v1/does-not-exist').set('Host', PLATFORM).expect(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('sets security headers and hides the framework', async () => {
    const res = await api(app).get('/api/v1/health/live').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('CORS allows platform subdomains and rejects foreign origins', async () => {
    const ok = await api(app).get('/api/v1/health/live').set('Origin', 'http://academy1.lvh.me:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://academy1.lvh.me:5173');
    const bad = await api(app).get('/api/v1/health/live').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits sign-in attempts through Redis', async () => {
    await app.get<Redis>(REDIS_CLIENT).flushdb();
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = '3';
    try {
      for (let i = 0; i < 3; i++) await api(app).post('/api/v1/auth/login').set('Host', PLATFORM).send({ email: 'x@example.test', password: 'wrong-password' }).expect(401);
      const res = await api(app).post('/api/v1/auth/login').set('Host', PLATFORM).send({ email: 'x@example.test', password: 'wrong-password' }).expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    } finally {
      process.env.AUTH_RATE_LIMIT_PER_MINUTE = '100000';
    }
  });

  it('protected routes require authentication by default', async () => {
    const res = await api(app).get('/api/v1/auth/me').set('Host', PLATFORM).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
