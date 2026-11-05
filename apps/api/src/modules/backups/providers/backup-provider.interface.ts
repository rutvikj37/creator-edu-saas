import type { Readable } from 'node:stream';

export interface BackupQuota {
  /** Bytes; null when the account has no fixed limit. */
  limit: number | null;
  usage: number;
  usageInDrive: number;
  usageInDriveTrash: number;
}

export interface StoredBackupFile {
  fileId: string;
  size: number | null;
  md5Checksum: string | null;
  sha256Checksum: string | null;
}

/** A private, encrypted-at-rest store for original files. Implementations must never make files public. */
export interface BackupProvider {
  readonly key: 'GOOGLE_DRIVE';
  isConfigured(): boolean;
  isConnected(): Promise<boolean>;
  /** Folder id for a path under the root backup folder, creating missing folders. */
  ensureFolder(path: string[]): Promise<string>;
  upload(input: { folderId: string; name: string; body: Readable; mimeType: string; properties?: Record<string, string> }): Promise<StoredBackupFile>;
  stat(fileId: string): Promise<StoredBackupFile>;
  download(fileId: string): Promise<Readable>;
  remove(fileId: string): Promise<void>;
  quota(): Promise<BackupQuota>;
}

export const BACKUP_PROVIDER = Symbol('BACKUP_PROVIDER');
