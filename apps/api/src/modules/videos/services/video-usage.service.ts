import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../../core/redis/redis.constants.js';
import { VIDEO_PROVIDER, type ProviderUsage, type VideoProvider } from '../providers/video-provider.interface.js';

const GB = 1024 ** 3;
const RATE_KEYS = ['video.storageRatePerGbMonth', 'video.deliveryRatePerGb', 'video.rateCurrency', 'video.displayCurrency', 'video.exchangeRate', 'video.fairUseStorageGb', 'video.fairUseDeliveryGbMonth'];
const MAX_STAT_CALLS = 500;

export function billingPeriod(d: Date) {
  return d.toISOString().slice(0, 7);
}

export interface Rates { storagePerGbMonth: number | null; deliveryPerGb: number | null; rateCurrency: string; displayCurrency: string; exchangeRate: number; fairUseStorageGb: number; fairUseDeliveryGbMonth: number }

/** Estimated provider cost; null when the administrator has not configured rates. Never hardcoded. */
export function estimateCost(storageBytes: number, deliveryBytes: number, r: Rates) {
  if (r.storagePerGbMonth === null || r.deliveryPerGb === null) return null;
  const inRate = (storageBytes / GB) * r.storagePerGbMonth + (deliveryBytes / GB) * r.deliveryPerGb;
  return { amount: Math.round(inRate * r.exchangeRate * 100) / 100, currency: r.displayCurrency };
}

/**
 * Video usage for administrators (nothing is charged automatically). Storage is the provider's
 * per-video `storageSize`. Delivery: Bunny reports traffic for the whole library this month, so it is
 * allocated to videos in proportion to their watch time from Bunny statistics — an estimate,
 * labelled as such (`deliverySource = ALLOCATED_BY_WATCH_TIME`).
 */
@Injectable()
export class VideoUsageService {
  private readonly log = new Logger(VideoUsageService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(VIDEO_PROVIDER) private readonly provider: VideoProvider,
  ) {}

  async rates(): Promise<Rates> {
    const rows = await this.prisma.platformSetting.findMany({ where: { key: { in: RATE_KEYS } } });
    const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const num = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : null);
    return {
      storagePerGbMonth: num('video.storageRatePerGbMonth'), deliveryPerGb: num('video.deliveryRatePerGb'),
      rateCurrency: typeof v['video.rateCurrency'] === 'string' ? (v['video.rateCurrency'] as string) : 'USD',
      displayCurrency: typeof v['video.displayCurrency'] === 'string' ? (v['video.displayCurrency'] as string) : (typeof v['video.rateCurrency'] === 'string' ? (v['video.rateCurrency'] as string) : 'USD'),
      exchangeRate: num('video.exchangeRate') ?? 1,
      fairUseStorageGb: num('video.fairUseStorageGb') ?? 0, fairUseDeliveryGbMonth: num('video.fairUseDeliveryGbMonth') ?? 0,
    };
  }

  /** Library totals from the provider (cached 10 min). Null without an account API key. */
  async providerUsage(force = false): Promise<ProviderUsage | null> {
    if (!this.provider.isConfigured()) return null;
    const key = 'video:provider-usage';
    if (!force) {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached);
    }
    const u = await this.provider.libraryUsage().catch((e) => { this.log.warn(`Provider usage unavailable: ${e.message}`); return null; });
    if (u) await this.redis.set(key, JSON.stringify(u), 'EX', 600);
    return u;
  }

  /** Snapshot for the current month (worker, every 6 h). */
  async recordMonth(now = new Date()) {
    const period = billingPeriod(now);
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const videos = await this.prisma.videoAsset.findMany({ where: { provider: 'BUNNY', providerAssetId: { not: null }, deletedAt: null, status: { in: ['UPLOADED', 'PROCESSING', 'READY'] } }, select: { id: true, tenantId: true, providerAssetId: true, storageSize: true } });
    if (!videos.length || !this.provider.isConfigured()) return { period, videos: 0 };
    const watched = new Set((await this.prisma.videoPlaybackSession.findMany({ where: { createdAt: { gte: from }, videoAssetId: { in: videos.map((v) => v.id) } }, select: { videoAssetId: true }, distinct: ['videoAssetId'] })).map((s) => s.videoAssetId));
    const stats = new Map<string, { views: number; watchSeconds: number }>();
    let calls = 0;
    for (const v of videos) {
      if (!watched.has(v.id) || calls >= MAX_STAT_CALLS) continue;
      calls++;
      const s = await this.provider.statistics({ from, to: now, providerVideoId: v.providerAssetId! }).catch(() => null);
      if (s) stats.set(v.id, s);
    }
    const usage = await this.providerUsage(true);
    const totalWatch = [...stats.values()].reduce((a, s) => a + s.watchSeconds, 0);
    for (const v of videos) {
      const s = stats.get(v.id) ?? { views: 0, watchSeconds: 0 };
      const delivery = usage && totalWatch > 0 ? Math.round((usage.trafficBytes * s.watchSeconds) / totalWatch) : 0;
      const data = {
        storageBytes: v.storageSize ?? BigInt(0), deliveryBytes: BigInt(delivery), watchSeconds: BigInt(Math.round(s.watchSeconds)), views: Math.round(s.views),
        deliverySource: usage && totalWatch > 0 ? 'ALLOCATED_BY_WATCH_TIME' : 'NONE', recordedAt: now,
      };
      await this.prisma.videoUsageRecord.upsert({ where: { videoAssetId_billingPeriod: { videoAssetId: v.id, billingPeriod: period } }, create: { tenantId: v.tenantId, videoAssetId: v.id, billingPeriod: period, ...data }, update: data });
    }
    return { period, videos: videos.length, statisticsCalls: calls, trafficBytes: usage?.trafficBytes ?? null };
  }

  /** Super admin dashboard. */
  async dashboard(period = billingPeriod(new Date())) {
    const [y, m] = period.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const [byStatus, storageAgg, uploads, failures, backupsByStatus, backupBytes, usage, tenants, rates, provider] = await Promise.all([
      this.prisma.videoAsset.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.videoAsset.groupBy({ by: ['tenantId', 'provider'], where: { deletedAt: null, status: { not: 'DELETED' } }, _count: { _all: true }, _sum: { storageSize: true, originalSize: true } }),
      this.prisma.videoAsset.aggregate({ where: { createdAt: { gte: from, lt: to } }, _count: { _all: true }, _sum: { originalSize: true } }),
      this.prisma.videoStatusHistory.count({ where: { toStatus: 'FAILED', createdAt: { gte: from, lt: to } } }),
      this.prisma.videoBackup.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.videoBackup.aggregate({ where: { status: 'COMPLETED' }, _sum: { backupSize: true } }),
      this.prisma.videoUsageRecord.groupBy({ by: ['tenantId'], where: { billingPeriod: period }, _sum: { deliveryBytes: true, watchSeconds: true, views: true } }),
      this.prisma.tenant.findMany({ select: { id: true, name: true, slug: true } }),
      this.rates(),
      this.providerUsage(),
    ]);
    const tenantName = new Map(tenants.map((t) => [t.id, t]));
    const perTenant = new Map<string, { videos: number; storageBytes: number; originalBytes: number; deliveryBytes: number; watchSeconds: number; views: number }>();
    for (const r of storageAgg) {
      const t = perTenant.get(r.tenantId) ?? { videos: 0, storageBytes: 0, originalBytes: 0, deliveryBytes: 0, watchSeconds: 0, views: 0 };
      t.videos += r._count._all;
      // Storage videos are kept as uploaded; provider videos report their own storage.
      t.storageBytes += Number(r.provider === 'BUNNY' ? (r._sum.storageSize ?? 0) : (r._sum.originalSize ?? 0));
      t.originalBytes += Number(r._sum.originalSize ?? 0);
      perTenant.set(r.tenantId, t);
    }
    for (const u of usage) {
      const t = perTenant.get(u.tenantId) ?? { videos: 0, storageBytes: 0, originalBytes: 0, deliveryBytes: 0, watchSeconds: 0, views: 0 };
      Object.assign(t, { deliveryBytes: Number(u._sum.deliveryBytes ?? 0), watchSeconds: Number(u._sum.watchSeconds ?? 0), views: u._sum.views ?? 0 });
      perTenant.set(u.tenantId, t);
    }
    const tenantRows = [...perTenant.entries()].map(([id, t]) => ({
      tenant: tenantName.get(id) ?? { id, name: 'Deleted academy', slug: null }, ...t,
      estimatedCost: estimateCost(t.storageBytes, t.deliveryBytes, rates),
      overFairUse: (rates.fairUseStorageGb > 0 && t.storageBytes > rates.fairUseStorageGb * GB) || (rates.fairUseDeliveryGbMonth > 0 && t.deliveryBytes > rates.fairUseDeliveryGbMonth * GB),
    })).sort((a, b) => b.storageBytes - a.storageBytes);
    const totals = tenantRows.reduce((a, t) => ({ storageBytes: a.storageBytes + t.storageBytes, deliveryBytes: a.deliveryBytes + t.deliveryBytes }), { storageBytes: 0, deliveryBytes: 0 });
    const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    return {
      period,
      totals: {
        videos: byStatus.filter((b) => b.status !== 'DELETED').reduce((a, b) => a + b._count._all, 0),
        ready: count('READY'), failed: count('FAILED'), processing: count('PROCESSING') + count('UPLOADED'),
        storageBytes: totals.storageBytes, deliveryBytesThisPeriod: totals.deliveryBytes,
        uploadsThisPeriod: uploads._count._all, uploadBytesThisPeriod: Number(uploads._sum.originalSize ?? 0),
        processingFailuresThisPeriod: failures,
        estimatedCost: estimateCost(totals.storageBytes, totals.deliveryBytes, rates),
      },
      backups: {
        byStatus: Object.fromEntries(backupsByStatus.map((b) => [b.status, b._count._all])),
        storedBytes: Number(backupBytes._sum.backupSize ?? 0),
      },
      provider: provider ? { storageBytes: provider.storageBytes, trafficBytesThisMonth: provider.trafficBytes } : null,
      deliveryNote: 'Delivery per academy is Bunny’s monthly library traffic allocated by watch time (an estimate).',
      rates,
      tenants: tenantRows,
    };
  }
}
