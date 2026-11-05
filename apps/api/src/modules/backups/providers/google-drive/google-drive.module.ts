import { Module } from '@nestjs/common';
import { BACKUP_PROVIDER } from '../backup-provider.interface.js';
import { GoogleDriveBackupProvider } from './google-drive.service.js';

/** Binds BACKUP_PROVIDER to Google Drive. */
@Module({ providers: [GoogleDriveBackupProvider, { provide: BACKUP_PROVIDER, useExisting: GoogleDriveBackupProvider }], exports: [GoogleDriveBackupProvider, BACKUP_PROVIDER] })
export class GoogleDriveModule {}
