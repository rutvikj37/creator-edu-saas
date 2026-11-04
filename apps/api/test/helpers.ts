import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Redis } from 'ioredis';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants.js';
import { QUEUES } from '../src/core/queue/queue.constants.js';
import { seed } from '../prisma/seed.js';
import { totp } from '../src/core/crypto/totp.js';

export const PLATFORM = 'app.lvh.me';
export const tenantHost = (slug: string) => `${slug}.lvh.me`;

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app);
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
    delete: (url: string) => wrap(request(server).delete(url)),
  };
}

let counter = 0;
export function uniqueEmail(prefix = 'user') {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@example.test`;
}

export async function registerCreator(app: NestExpressApplication, overrides: Partial<Record<string, string>> = {}) {
  const body = { fullName: 'Asha Creator', email: uniqueEmail('creator'), password: 'correct-horse-battery', country: 'IN', businessName: `Academy ${++counter}`, ...overrides };
  const res = await api(app).post('/api/v1/auth/register/creator').set('Host', PLATFORM).send(body).expect(201);
  return { body, res, session: parseSession(res, PLATFORM), tenant: res.body.data.tenant as { id: string; slug: string; name: string } };
}

export async function login(app: NestExpressApplication, host: string, email: string, password: string) {
  const res = await api(app).post('/api/v1/auth/login').set('Host', host).send({ email, password });
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
