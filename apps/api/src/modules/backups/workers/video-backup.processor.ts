import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { QUEUES } from '../../../core/queue/queue.constants.js';
import { BACKUP_JOBS } from '../../videos/services/video-processing.service.js';
import { BackupsService } from '../backups.service.js';
import { BackupRestoreService } from '../services/backup-restore.service.js';

const SWEEP = 'backups-sweep';

/** Backup jobs run one at a time per worker so a large upload never starves other queues. */
@Processor(QUEUES.BACKUPS, { concurrency: 1 })
export class VideoBackupProcessor extends WorkerHost {
  private readonly log = new Logger(VideoBackupProcessor.name);
  constructor(private readonly backups: BackupsService, private readonly restore: BackupRestoreService) {
    super();
  }

  async process(job: Job) {
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    switch (job.name) {
      case BACKUP_JOBS.VIDEO:
        return this.backups.backupVideo(job.data.tenantId, job.data.videoId, { attempt: job.attemptsMade + 1, finalAttempt });
      case BACKUP_JOBS.DOCUMENT:
        return this.backups.backupDocument(job.data.tenantId, job.data.fileAssetId, { finalAttempt });
      case BACKUP_JOBS.RESTORE:
        return this.restore.restore(job.data.backupId, job.data.actorUserId ?? null, finalAttempt);
      case SWEEP:
        return this.backups.sweep();
      default:
        this.log.warn(`Unknown backup job ${job.name}`);
        return null;
    }
  }
}

@Injectable()
export class BackupScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.BACKUPS) private readonly queue: Queue) {}
  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(SWEEP, { every: 3600_000 }, { name: SWEEP });
  }
}
