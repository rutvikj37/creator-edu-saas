import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { VideoUsageService, billingPeriod } from '../src/modules/videos/services/video-usage.service.js';
import { authed, createTestApp, registerCreator, resetDatabase, superAdmin, tenantHost, type Session } from './helpers.js';
import { bunnySim, type BunnySim } from './bunny-sim.js';

const GB = 1024 ** 3;

describe('Video usage dashboard (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let sim: BunnySim;
  let admin: Session;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    sim = bunnySim(app);
    admin = (await superAdmin(app)).session;
  });
  afterAll(async () => app?.close());

  async function academyWithVideo(storage: number) {
    const c = await registerCreator(app);
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    const r = (await authed(app, c.session).post('/api/v1/videos/upload/initiate').send({ title: 'Lecture', filename: 'l.mp4', size: 1000, mimeType: 'video/mp4' }).expect(201)).body.data;
    sim.uploaded(r.upload.headers.VideoId, Buffer.alloc(1000));
    sim.finish(r.upload.headers.VideoId, { storageSize: storage });
    await authed(app, c.session).get(`/api/v1/videos/${r.videoId}/processing-status`).expect(200);
    // A playback session this month marks the video as watched (statistics are read only for those).
    const lesson = await prisma.courseLesson.findFirst();
    await prisma.videoPlaybackSession.create({ data: { tenantId: c.tenant.id, videoAssetId: r.videoId, lessonId: lesson?.id ?? 'ckxxxxxxxxxxxxxxxxxxxxxxx', userId: 'ckxxxxxxxxxxxxxxxxxxxxxxx', enrollmentId: 'preview', expiresAt: new Date(Date.now() + 3600_000) } });
    return { c, videoId: r.videoId as string, guid: r.upload.headers.VideoId as string };
  }

  it('15. tenant-wise usage: storage, delivery allocated by watch time, configurable cost, fair use; admins only', async () => {
    const a = await academyWithVideo(3 * GB);
    const b = await academyWithVideo(1 * GB);
    sim.watch.set(a.guid, 3000);
    sim.watch.set(b.guid, 1000);
    sim.library = { storage: 4 * GB, traffic: 40 * GB };
    const snap = await app.get(VideoUsageService).recordMonth();
    expect(snap).toMatchObject({ videos: 2, statisticsCalls: 2, trafficBytes: 40 * GB });
    const rec = await prisma.videoUsageRecord.findFirstOrThrow({ where: { videoAssetId: a.videoId, billingPeriod: billingPeriod(new Date()) } });
    expect(Number(rec.deliveryBytes)).toBe(30 * GB);
    expect(rec.deliverySource).toBe('ALLOCATED_BY_WATCH_TIME');

    // Without rates there is no cost estimate (never hardcoded).
    let u = (await authed(app, admin).get('/api/v1/platform/videos/usage').expect(200)).body.data;
    expect(u.totals.estimatedCost).toBeNull();
    expect(u.provider).toEqual({ storageBytes: 4 * GB, trafficBytesThisMonth: 40 * GB });

    await authed(app, admin).put('/api/v1/platform/settings').send({ items: [
      { key: 'video.storageRatePerGbMonth', value: 0.01 }, { key: 'video.deliveryRatePerGb', value: 0.005 }, { key: 'video.rateCurrency', value: 'USD' },
      { key: 'video.displayCurrency', value: 'INR' }, { key: 'video.exchangeRate', value: 84 }, { key: 'video.fairUseStorageGb', value: 2 },
    ] }).expect(200);
    u = (await authed(app, admin).get('/api/v1/platform/videos/usage').expect(200)).body.data;
    const rowA = u.tenants.find((t: any) => t.tenant.id === a.c.tenant.id);
    const rowB = u.tenants.find((t: any) => t.tenant.id === b.c.tenant.id);
    expect(rowA).toMatchObject({ videos: 1, storageBytes: 3 * GB, deliveryBytes: 30 * GB, watchSeconds: 3000, overFairUse: true });
    // (3 GB × 0.01 + 30 GB × 0.005) USD × 84 = 15.12 INR
    expect(rowA.estimatedCost).toEqual({ amount: 15.12, currency: 'INR' });
    expect(rowB).toMatchObject({ storageBytes: 1 * GB, deliveryBytes: 10 * GB, overFairUse: false });
    expect(u.totals).toMatchObject({ videos: 2, ready: 2, failed: 0, storageBytes: 4 * GB, uploadsThisPeriod: 2 });
    expect(u.totals.estimatedCost).toEqual({ amount: Math.round((4 * 0.01 + 40 * 0.005) * 84 * 100) / 100, currency: 'INR' });

    // Creators cannot see platform usage.
    await authed(app, a.c.session).get('/api/v1/platform/videos/usage').expect((r) => expect([401, 403, 404]).toContain(r.status));
  });
});
