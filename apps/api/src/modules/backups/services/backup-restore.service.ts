import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../../core/audit/audit.service.js';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { VIDEO_PROVIDER, type VideoProvider } from '../../videos/providers/video-provider.interface.js';
import { VideosRepository } from '../../videos/videos.repository.js';
import { BACKUP_PROVIDER, type BackupProvider } from '../providers/backup-provider.interface.js';
import { BackupFailure, BackupsService, isRetryable } from '../backups.service.js';
import { DecryptStream } from './backup-crypto.js';
import { BackupVerificationService } from './backup-verification.service.js';

/**
 * Restores a video's original from its encrypted backup into a new provider video entry:
 * 1) verification pass (download, decrypt, authenticate, compare SHA-256 and size),
 * 2) create a provider video in the academy's collection, 3) stream the decrypted original to it,
 * 4) point the video record at it (status PROCESSING; the provider re-encodes), 5) remove the old entry.
 */
@Injectable()
export class BackupRestoreService {
  private readonly log = new Logger(BackupRestoreService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly backups: BackupsService,
    private readonly verification: BackupVerificationService,
    private readonly repo: VideosRepository,
    private readonly audit: AuditService,
    @Inject(BACKUP_PROVIDER) private readonly store: BackupProvider,
    @Inject(VIDEO_PROVIDER) private readonly videos: VideoProvider,
  ) {}

  async restore(backupId: string, actorUserId: string | null, finalAttempt: boolean) {
    const b = await this.prisma.videoBackup.findUnique({ where: { id: backupId }, include: { video: true } });
    if (!b || !b.driveFileId || !b.encryption) return { skipped: 'no backup' };
    try {
      const key = this.backups.dataKey(b.encryption);
      const check = await this.verification.verifyStored(b.driveFileId, key);
      if (b.checksum && check.sha256 !== b.checksum) throw new BackupFailure('The backup does not match its recorded checksum', false);
      if (b.originalSize && BigInt(check.bytes) !== b.originalSize) throw new BackupFailure('The backup size does not match the recorded size', false);

      const group = await this.prisma.tenantSetting.findFirst({ where: { tenantId: b.tenantId, key: 'video.bunnyCollectionId' } });
      const { providerVideoId } = await this.videos.createVideo({ title: b.video.title, groupId: (group?.value as { id?: string } | null)?.id ?? null });
      const body = await this.store.download(b.driveFileId);
      const plain = new DecryptStream(key);
      body.on('error', (e) => plain.destroy(e));
      await this.videos.uploadFile(providerVideoId, body.pipe(plain), check.bytes);

      const old = b.video.providerAssetId;
      await this.prisma.videoAsset.update({ where: { id: b.videoAssetId }, data: { providerAssetId: providerVideoId, processingRound: b.video.processingRound + 1, errorMessage: null, lastSyncedAt: null } });
      if (b.video.status !== 'PROCESSING') await this.repo.transition(b.videoAssetId, 'PROCESSING', 'WORKER', 'Original restored from backup', { processingStartedAt: new Date() }).catch((e) => this.log.warn(`Restore status: ${e.message}`));
      if (old && old !== providerVideoId) await this.videos.deleteVideo(old).catch(() => null);
      await this.prisma.videoBackup.update({ where: { id: backupId }, data: { restoreStatus: 'COMPLETED', restoredAt: new Date(), restoreError: null } });
      await this.audit.record({ action: 'backup.restored', tenantId: b.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'VideoBackup', targetId: backupId, after: { providerVideoId, bytes: check.bytes } });
      return { restored: true, providerVideoId, bytes: check.bytes };
    } catch (e) {
      const retry = isRetryable(e) && !finalAttempt;
      await this.prisma.videoBackup.update({ where: { id: backupId }, data: { restoreStatus: retry ? 'IN_PROGRESS' : 'FAILED', restoreError: String((e as Error).message).slice(0, 500) } });
      if (retry) throw e;
      return { failed: (e as Error).message };
    }
  }
}
