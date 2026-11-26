import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Redis } from 'ioredis';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { AppConfig } from '../src/config/app-config.service.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants.js';
import { RedisIoAdapter } from '../src/core/redis/redis-io.adapter.js';
import { QUEUES } from '../src/core/queue/queue.constants.js';
import { seed } from '../prisma/seed.js';
import { totp } from '../src/core/crypto/totp.js';

export const PLATFORM = 'app.lvh.me';
export const tenantHost = (slug: string) => `${slug}.lvh.me`;

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true, rawBody: true });
  configureApp(app);
  const redisIo = new RedisIoAdapter(app, app.get(AppConfig).get('REDIS_URL'));
  await redisIo.connectToRedis();
  app.useWebSocketAdapter(redisIo);
  await app.init();
  return app;
}

/** Empties every data table (keeps migrations) and re-seeds reference data. */
export async function resetDatabase(app: NestExpressApplication) {
  const prisma = app.get(PrismaService);
  const tables = await prisma.$queryRawUnsafe<{ t: string }[]>(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> '_prisma_migrations'",
  );
  // FOREIGN_KEY_CHECKS is per connection, so everything must run on one pooled connection.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
      for (const { t } of tables) await tx.$executeRawUnsafe(`DELETE FROM \`${t}\``);
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    },
    { timeout: 30_000 },
  );
  await app.get<Redis>(REDIS_CLIENT).flushdb();
  await seed(prisma as never);
  await app.get<Queue>(getQueueToken(QUEUES.NOTIFICATIONS)).obliterate({ force: true });
}

export interface Session {
  accessToken: string;
  cookies: string[];
  csrf: string;
  host: string;
}

export function parseSession(res: request.Response, host: string): Session {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookies = (raw ?? []).map((c) => c.split(';')[0]);
  const csrf = cookies.find((c) => c.startsWith('csrf='))?.slice(5) ?? '';
  return { accessToken: res.body.data?.accessToken, cookies, csrf, host };
}

export const api = (app: NestExpressApplication) => request(app.getHttpServer());

export function authed(app: NestExpressApplication, s: Pick<Session, 'accessToken' | 'host'>) {
  const server = app.getHttpServer();
  const wrap = (r: request.Test) => r.set('Host', s.host).set('Authorization', `Bearer ${s.accessToken}`);
  return {
    get: (url: string) => wrap(request(server).get(url)),
    post: (url: string) => wrap(request(server).post(url)),
    patch: (url: string) => wrap(request(server).patch(url)),
    put: (url: string) => wrap(request(server).put(url)),
    delete: (url: string) => wrap(request(server).delete(url)),
  };
}

let counter = 0;
export function uniqueEmail(prefix = 'user') {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@example.test`;
}

/**
 * Provisions a creator (platform user + academy) the way a Super Admin would, then signs them in.
 * Public creator sign-up is closed, so tests create the account directly instead of via the API.
 */
export async function registerCreator(app: NestExpressApplication, overrides: Partial<Record<string, string>> = {}) {
  const body: Record<string, string> & { phone?: string } = { fullName: 'Asha Creator', email: uniqueEmail('creator'), password: 'correct-horse-battery', country: 'IN', businessName: `Academy ${++counter}`, ...overrides };
  const prisma = app.get(PrismaService);
  const { PasswordService } = await import('../src/modules/auth/services/password.service.js');
  const { TenantsService } = await import('../src/modules/tenants/tenants.service.js');
  const passwordHash = await app.get(PasswordService).hash(body.password);
  const tenant = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { realm: 'PLATFORM', realmKey: 'platform', email: body.email, phone: body.phone, passwordHash, fullName: body.fullName, country: body.country, passwordChangedAt: new Date() },
    });
    const t = await app.get(TenantsService).createForOwner(tx as never, user, body.businessName);
    await tx.auditLog.create({ data: { action: 'tenant.create', tenantId: t.id, actorUserId: user.id, actorRealm: 'PLATFORM', targetType: 'Tenant', targetId: t.id } });
    return t;
  });
  const res = await api(app).post('/api/v1/auth/login').set('Host', PLATFORM).send({ email: body.email, password: body.password }).expect(200);
  const session = parseSession(res, PLATFORM);
  // Sign-up used to send the verification email; keep that so verification flows can be exercised.
  await authed(app, session).post('/api/v1/auth/email/resend').expect(200);
  return { body, res, session, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } };
}

export async function login(
  app: NestExpressApplication,
  host: string,
  email: string,
  password: string,
  opts?: { userAgent?: string },
) {
  let req = api(app).post('/api/v1/auth/login').set('Host', host);
  if (opts?.userAgent) req = req.set('User-Agent', opts.userAgent);
  const res = await req.send({ email, password });
  return { res, session: parseSession(res, host) };
}

/** Latest queued email for an address (emails are delivered by the worker; tests read the queue). */
export async function lastEmail(app: NestExpressApplication, to: string) {
  const queue = app.get<Queue>(getQueueToken(QUEUES.NOTIFICATIONS));
  const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
  const mine = jobs.filter((j) => j.data.to === to).sort((a, b) => b.timestamp - a.timestamp);
  return mine[0]?.data as { subject: string; html: string; text: string; tag: string } | undefined;
}

export async function emailCount(app: NestExpressApplication, to: string) {
  const queue = app.get<Queue>(getQueueToken(QUEUES.NOTIFICATIONS));
  const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
  return jobs.filter((j) => j.data.to === to).length;
}

export function tokenFromEmail(text: string, param = 'token'): string {
  const m = text.match(new RegExp(`[?&]${param}=([^\\s&]+)`));
  if (!m) throw new Error(`No ${param} in email`);
  return decodeURIComponent(m[1]);
}

export function codeFromEmail(text: string): string {
  const m = text.match(/\b(\d{6})\b/);
  if (!m) throw new Error('No code in email');
  return m[1];
}

/** A TOTP for the next time step (avoids replay protection rejecting the code just used). */
export const nextTotp = (secret: string, stepOffset = 1) => totp(secret, Date.now() + stepOffset * 30_000);
export const currentTotp = (secret: string) => totp(secret);

/** Signs in the seeded super admin and completes mandatory 2FA enrolment. */
export async function superAdmin(app: NestExpressApplication) {
  const { session } = await login(app, PLATFORM, 'root@platform.test', 'Sup3r-Admin-Passw0rd!');
  const setup = await authed(app, session).post('/api/v1/auth/2fa/setup').expect(200);
  const enabled = await authed(app, session).post('/api/v1/auth/2fa/enable').send({ code: nextTotp(setup.body.data.secret, 0) }).expect(200);
  return { session: parseSession(enabled, PLATFORM), secret: setup.body.data.secret as string };
}

/** Creates a platform admin with the given roles and an enrolled 2FA, returning a full session. */
export async function adminWithRoles(app: NestExpressApplication, roles: string[]) {
  const prisma = app.get(PrismaService);
  const { PasswordService } = await import('../src/modules/auth/services/password.service.js');
  const email = uniqueEmail('admin');
  const user = await prisma.user.create({ data: { realm: 'PLATFORM', realmKey: 'platform', email, fullName: 'Admin User', passwordHash: await app.get(PasswordService).hash('admin-password-1') } });
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { uniqueKey: `system:${key}` } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  const { session } = await login(app, PLATFORM, email, 'admin-password-1');
  const setup = await authed(app, session).post('/api/v1/auth/2fa/setup').expect(200);
  const enabled = await authed(app, session).post('/api/v1/auth/2fa/enable').send({ code: nextTotp(setup.body.data.secret, 0) }).expect(200);
  return { session: parseSession(enabled, PLATFORM), userId: user.id, email };
}

/** Uploads bytes through the real two-step flow (begin → PUT to signed URL → complete). */
export async function uploadFile(app: NestExpressApplication, s: Session, purpose: string, fileName: string, mimeType: string, bytes: Buffer) {
  const begin = await authed(app, s).post('/api/v1/creator/files').send({ purpose, fileName, mimeType, sizeBytes: bytes.length }).expect(201);
  const url = new URL(begin.body.data.upload.url);
  await request(app.getHttpServer()).put(url.pathname).set('Host', s.host).set('Content-Type', mimeType).send(bytes).expect(200);
  return authed(app, s).post(`/api/v1/creator/files/${begin.body.data.fileId}/complete`);
}

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 1)]);
export const PDF = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
