import { Inject, Injectable } from '@nestjs/common';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BACKUP_PROVIDER, type BackupProvider, type StoredBackupFile } from '../providers/backup-provider.interface.js';
import { DecryptStream } from './backup-crypto.js';

export interface UploadMeasure { plainSha256: string; plainBytes: number; cipherMd5: string; cipherBytes: number }

/**
 * Checks that a backup is complete and intact:
 * - after upload: the store's size and MD5 match what we streamed, the original's size matches the
 *   recorded upload size, and its SHA-256 matches the provider's own hash of the original (when given);
 * - before restore (or on demand): the file downloads, decrypts and authenticates (GCM tag), and the
 *   plaintext SHA-256 matches the checksum recorded at backup time.
 */
@Injectable()
export class BackupVerificationService {
  constructor(@Inject(BACKUP_PROVIDER) private readonly store: BackupProvider) {}

  checkUpload(m: UploadMeasure, stored: StoredBackupFile, expect: { originalSize?: number | null; providerSha256?: string | null }) {
    const problems: string[] = [];
    if (stored.size !== null && stored.size !== m.cipherBytes) problems.push(`stored size ${stored.size} ≠ uploaded ${m.cipherBytes}`);
    if (stored.md5Checksum && stored.md5Checksum.toLowerCase() !== m.cipherMd5) problems.push('stored MD5 does not match the uploaded bytes');
    if (!stored.md5Checksum && stored.size === null) problems.push('the backup store returned no size or checksum to verify');
    if (expect.originalSize && expect.originalSize !== m.plainBytes) problems.push(`original is ${m.plainBytes} bytes, upload was ${expect.originalSize}`);
    const ph = expect.providerSha256?.trim().toLowerCase();
    if (ph && /^[0-9a-f]{64}$/.test(ph) && ph !== m.plainSha256) problems.push('original SHA-256 differs from the provider’s hash');
    return problems;
  }

  /** Downloads and decrypts to nowhere, returning the plaintext hash and size. Throws on tampering. */
  async verifyStored(fileId: string, dataKey: Buffer) {
    const body = await this.store.download(fileId);
    const dec = new DecryptStream(dataKey);
    await pipeline(body, dec, new Writable({ write: (_c, _e, cb) => cb() }));
    return { sha256: dec.plainSha256.digest('hex'), bytes: dec.plainBytes };
  }
}
