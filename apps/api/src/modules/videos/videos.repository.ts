import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import type { VideoStatus } from '../../generated/prisma/client.js';

export type StatusSource = 'USER' | 'API' | 'WEBHOOK' | 'SYNC' | 'WORKER';

/** Allowed status moves. Provider reads may jump forward (e.g. UPLOAD_AUTHORIZED → READY). */
const TRANSITIONS: Record<VideoStatus, VideoStatus[]> = {
  CREATED: ['UPLOAD_AUTHORIZED', 'FAILED', 'DELETING'],
  UPLOAD_AUTHORIZED: ['UPLOAD_AUTHORIZED', 'UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'DELETING'],
  UPLOADING: ['UPLOAD_AUTHORIZED', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'DELETING'],
  UPLOADED: ['PROCESSING', 'READY', 'FAILED', 'DELETING'],
  PROCESSING: ['READY', 'FAILED', 'DELETING'],
  READY: ['PROCESSING', 'FAILED', 'DELETING'],
  FAILED: ['UPLOAD_AUTHORIZED', 'PROCESSING', 'READY', 'DELETING'],
  DELETING: ['DELETED'],
  DELETED: [],
};

export function canTransition(from: VideoStatus, to: VideoStatus) {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(readonly from: VideoStatus, readonly to: VideoStatus) {
    super(`Video cannot move from ${from} to ${to}`);
  }
}

/**
 * Persistence for videos. Every status change goes through `transition`, which applies a
 * compare-and-set on the current status (so concurrent webhook/sync/user actions cannot
 * overwrite each other) and appends a VideoStatusHistory row in the same transaction.
 */
@Injectable()
export class VideosRepository {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
  ) {}

  find(id: string) {
    return this.db.videoAsset.findFirst({ where: { id, deletedAt: null } });
  }

  /** Unscoped lookup for provider callbacks (no tenant context yet). */
  findByProviderId(provider: 'BUNNY', providerAssetId: string) {
    return this.prisma.videoAsset.findUnique({ where: { provider_providerAssetId: { provider, providerAssetId } } });
  }

  /**
   * Moves a video to `to` if allowed from its current status. Returns the updated row, or null when
   * another writer changed the status first or it is already `to` (no-op). `data` is applied too.
   */
  async transition(id: string, to: VideoStatus, source: StatusSource, reason: string | null, data: Record<string, unknown> = {}) {
    return this.prisma.$transaction(async (tx) => {
      const v = await tx.videoAsset.findUnique({ where: { id } });
      if (!v) return null;
      if (v.status === to) {
        if (Object.keys(data).length) return tx.videoAsset.update({ where: { id }, data: data as never });
        return null;
      }
      if (!canTransition(v.status, to)) throw new InvalidTransitionError(v.status, to);
      const res = await tx.videoAsset.updateMany({ where: { id, status: v.status }, data: { ...(data as object), status: to } as never });
      if (res.count === 0) return null; // lost the race; caller re-reads
      await tx.videoStatusHistory.create({ data: { tenantId: v.tenantId, videoAssetId: id, fromStatus: v.status, toStatus: to, source, reason: reason?.slice(0, 255) ?? null } });
      return tx.videoAsset.findUnique({ where: { id } });
    });
  }

  async recordCreated(tenantId: string, id: string, source: StatusSource) {
    await this.prisma.videoStatusHistory.create({ data: { tenantId, videoAssetId: id, fromStatus: null, toStatus: 'CREATED', source, reason: 'Video record created' } });
  }

  history(id: string) {
    return this.db.videoStatusHistory.findMany({ where: { videoAssetId: id }, orderBy: { createdAt: 'asc' } });
  }
}
