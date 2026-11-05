import { Module } from '@nestjs/common';
import { BunnyModule } from '../videos/providers/bunny/bunny.module.js';
import { VideosModule, VideosWorkerModule } from '../videos/videos.module.js';
import { BackupsController, DriveOAuthCallbackController } from './backups.controller.js';
import { BackupsService } from './backups.service.js';
import { GoogleDriveModule } from './providers/google-drive/google-drive.module.js';
import { BackupRestoreService } from './services/backup-restore.service.js';
import { BackupVerificationService } from './services/backup-verification.service.js';
import { BackupScheduler, VideoBackupProcessor } from './workers/video-backup.processor.js';

@Module({
  imports: [GoogleDriveModule, BunnyModule, VideosModule],
  controllers: [BackupsController, DriveOAuthCallbackController],
  providers: [BackupsService, BackupVerificationService, BackupRestoreService],
  exports: [BackupsService, BackupRestoreService],
})
export class BackupsModule {}

/** Worker side: backups, restores, hourly sweep. */
@Module({
  imports: [GoogleDriveModule, BunnyModule, VideosWorkerModule],
  providers: [BackupsService, BackupVerificationService, BackupRestoreService, VideoBackupProcessor, BackupScheduler],
  exports: [BackupsService, BackupRestoreService],
})
export class BackupsWorkerModule {}
