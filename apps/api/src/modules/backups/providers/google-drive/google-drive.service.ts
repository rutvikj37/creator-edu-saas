import { Inject, Injectable, Logger } from '@nestjs/common';
import { drive_v3 } from '@googleapis/drive';
import { OAuth2Client } from 'google-auth-library';
import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { AppConfig } from '../../../../config/app-config.service.js';
import { CryptoService } from '../../../../core/crypto/crypto.service.js';
import { PrismaService } from '../../../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../../../core/redis/redis.constants.js';
import type { BackupProvider, BackupQuota, StoredBackupFile } from '../backup-provider.interface.js';

/** Only files this app creates are visible to it (least privilege). */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SETTING_KEY = 'backups.googleDrive';
const FILE_FIELDS = 'id,size,md5Checksum,sha256Checksum';

export class DriveError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) {
    super(message);
    this.name = 'DriveError';
  }
}

interface StoredConnection { refreshTokenEnc: string; email: string | null; connectedAt: string; connectedBy: string | null }

/** Google API errors → retryable or not (rate limits, quota per minute, 5xx and network are retryable). */
export function classifyDriveError(e: unknown): DriveError {
  if (e instanceof DriveError) return e;
  const err = e as { code?: number | string; status?: number; response?: { status?: number; data?: { error?: { message?: string; errors?: { reason?: string }[] } } }; message?: string };
  const status = Number(err.response?.status ?? err.status ?? (typeof err.code === 'number' ? err.code : 0)) || 0;
  const reason = err.response?.data?.error?.errors?.[0]?.reason ?? '';
  const message = err.response?.data?.error?.message ?? err.message ?? 'Google Drive request failed';
  if (reason === 'storageQuotaExceeded' || reason === 'quotaExceeded' && /storage/i.test(message)) return new DriveError('Google Drive is full', false, status);
  if (status === 429 || status >= 500 || ['rateLimitExceeded', 'userRateLimitExceeded', 'backendError'].includes(reason)) return new DriveError(`Google Drive is busy: ${message}`, true, status);
  if (status === 401 || reason === 'authError' || /invalid_grant/.test(message)) return new DriveError('Google Drive access was revoked or expired. Reconnect Google Drive.', false, status);
  if (!status && /ECONN|ETIMEDOUT|socket|network|fetch failed/i.test(message)) return new DriveError('Could not reach Google Drive', true);
  return new DriveError(message, false, status);
}

/**
 * Google Drive as the backup store, via Google's official SDK (@googleapis/drive) and OAuth2
 * (google-auth-library). The refresh token is stored encrypted (AES-256-GCM) in platform settings and
 * never leaves the backend. Files are created inside a dedicated root folder and are never shared.
 */
@Injectable()
export class GoogleDriveBackupProvider implements BackupProvider {
  readonly key = 'GOOGLE_DRIVE' as const;
  private readonly log = new Logger(GoogleDriveBackupProvider.name);
  private client: drive_v3.Drive | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly crypto: CryptoService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  isConfigured() {
    return Boolean(this.config.get('GOOGLE_DRIVE_CLIENT_ID') && this.config.get('GOOGLE_DRIVE_CLIENT_SECRET') && this.config.get('GOOGLE_DRIVE_REDIRECT_URI') && this.config.get('BACKUP_ENCRYPTION_KEY'));
  }

  private oauth() {
    const root = this.config.get('GOOGLE_API_ROOT_URL');
    return new OAuth2Client({
      clientId: this.config.get('GOOGLE_DRIVE_CLIENT_ID'),
      clientSecret: this.config.get('GOOGLE_DRIVE_CLIENT_SECRET'),
      redirectUri: this.config.get('GOOGLE_DRIVE_REDIRECT_URI') || undefined,
      ...(root ? { endpoints: { oauth2TokenUrl: `${root.replace(/\/$/, '')}/token`, oauth2RevokeUrl: `${root.replace(/\/$/, '')}/revoke` } } : {}),
    });
  }

  // ── connection ───────────────────────────────────────────
  /** Consent URL. `state` is a one-time value bound to the administrator (checked in the callback). */
  async authorizationUrl(adminUserId: string) {
    const state = randomBytes(24).toString('base64url');
    await this.redis.set(`drive:oauth-state:${state}`, adminUserId, 'EX', 600);
    // access_type=offline + prompt=consent: Google returns a refresh token for unattended backups.
    return this.oauth().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: [DRIVE_SCOPE], state, include_granted_scopes: false });
  }

  async completeAuthorization(code: string, state: string) {
    const adminUserId = await this.redis.getdel(`drive:oauth-state:${state}`);
    if (!adminUserId) throw new DriveError('This authorisation link expired. Start again from the backups page.', false, 400);
    const { tokens } = await this.oauth().getToken(code).catch((e) => { throw classifyDriveError(e); });
    if (!tokens.refresh_token) throw new DriveError('Google did not return a refresh token. Remove the app’s access in your Google account and connect again.', false, 400);
    this.client = null;
    let email: string | null = null;
    const conn: StoredConnection = { refreshTokenEnc: this.crypto.encrypt(tokens.refresh_token), email, connectedAt: new Date().toISOString(), connectedBy: adminUserId };
    await this.save(conn);
    try {
      const about = await (await this.drive()).about.get({ fields: 'user(emailAddress)' });
      email = about.data.user?.emailAddress ?? null;
      await this.save({ ...conn, email });
    } catch (e) {
      this.log.warn(`Connected, but could not read the account email: ${(e as Error).message}`);
    }
    await this.redis.del(...(await this.redis.keys('drive:folder:*')), 'drive:quota').catch(() => 0);
    return { email, connectedBy: adminUserId };
  }

  private async save(conn: StoredConnection) {
    await this.prisma.platformSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, group: 'backups', value: conn as never, isSecret: true }, update: { value: conn as never, isSecret: true } });
  }

  private async connection(): Promise<StoredConnection | null> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: SETTING_KEY } });
    const v = row?.value as StoredConnection | undefined;
    return v?.refreshTokenEnc ? v : null;
  }

  async status() {
    const c = await this.connection();
    return { configured: this.isConfigured(), connected: Boolean(c), email: c?.email ?? null, connectedAt: c?.connectedAt ?? null, scope: DRIVE_SCOPE };
  }

  async isConnected() {
    return this.isConfigured() && Boolean(await this.connection());
  }

  async disconnect() {
    const c = await this.connection();
    if (c) {
      const auth = this.oauth();
      await auth.revokeToken(this.crypto.decrypt(c.refreshTokenEnc)).catch((e) => this.log.warn(`Token revocation failed: ${e.message}`));
    }
    await this.prisma.platformSetting.deleteMany({ where: { key: SETTING_KEY } });
    this.client = null;
  }

  private async drive(): Promise<drive_v3.Drive> {
    if (this.client) return this.client;
    if (!this.isConfigured()) throw new DriveError('Google Drive backups are not configured', false);
    const c = await this.connection();
    if (!c) throw new DriveError('Google Drive is not connected', false);
    const auth = this.oauth();
    auth.setCredentials({ refresh_token: this.crypto.decrypt(c.refreshTokenEnc) });
    const root = this.config.get('GOOGLE_API_ROOT_URL');
    const client = new drive_v3.Drive({ auth, ...(root ? { rootUrl: root.endsWith('/') ? root : `${root}/` } : {}), retry: true, retryConfig: { retry: 4, statusCodesToRetry: [[429, 429], [500, 599]] } } as never);
    this.client = client;
    return client;
  }

  /** The SDK builds media-upload URLs from per-call options only, so a root override must be repeated here. */
  private callOptions() {
    const root = this.config.get('GOOGLE_API_ROOT_URL');
    return root ? { rootUrl: root.endsWith('/') ? root : `${root}/` } : {};
  }

  /** Test seam / reconnect: drop the cached client. */
  reset() {
    this.client = null;
  }

  // ── files ────────────────────────────────────────────────
  private async findFolder(name: string, parent: string | null) {
    const d = await this.drive();
    const q = [`name = '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`, `mimeType = '${FOLDER_MIME}'`, 'trashed = false', parent ? `'${parent}' in parents` : `'root' in parents`].join(' and ');
    const r = await d.files.list({ q, fields: 'files(id,name)', pageSize: 10, spaces: 'drive' });
    return r.data.files?.[0]?.id ?? null;
  }

  async ensureFolder(path: string[]) {
    const segments = [this.config.get('GOOGLE_DRIVE_ROOT_FOLDER'), ...path];
    let parent: string | null = null;
    try {
      for (let i = 0; i < segments.length; i++) {
        const cacheKey = `drive:folder:${segments.slice(0, i + 1).join('/')}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) { parent = cached; continue; }
        let id = await this.findFolder(segments[i], parent);
        if (!id) {
          const d = await this.drive();
          const created: { data: drive_v3.Schema$File } = await d.files.create({ requestBody: { name: segments[i], mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) }, fields: 'id' });
          id = created.data.id!;
        }
        if (!id) throw new DriveError('Google Drive did not return a folder id', true);
        await this.redis.set(cacheKey, id, 'EX', 30 * 86_400);
        parent = id;
      }
      return parent!;
    } catch (e) {
      throw classifyDriveError(e);
    }
  }

  async upload(input: { folderId: string; name: string; body: Readable; mimeType: string; properties?: Record<string, string> }): Promise<StoredBackupFile> {
    try {
      const d = await this.drive();
      const r = await d.files.create({
        requestBody: { name: input.name, parents: [input.folderId], mimeType: input.mimeType, appProperties: input.properties ?? {} },
        media: { mimeType: input.mimeType, body: input.body },
        fields: FILE_FIELDS,
      }, this.callOptions());
      return toStored(r.data);
    } catch (e) {
      throw classifyDriveError(e);
    }
  }

  async stat(fileId: string) {
    try {
      const r = await (await this.drive()).files.get({ fileId, fields: FILE_FIELDS });
      return toStored(r.data);
    } catch (e) {
      throw classifyDriveError(e);
    }
  }

  async download(fileId: string): Promise<Readable> {
    try {
      const r = await (await this.drive()).files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
      return r.data as unknown as Readable;
    } catch (e) {
      throw classifyDriveError(e);
    }
  }

  async remove(fileId: string) {
    try {
      await (await this.drive()).files.delete({ fileId });
    } catch (e) {
      const err = classifyDriveError(e);
      if (err.status !== 404) throw err;
    }
  }

  async quota(): Promise<BackupQuota> {
    try {
      const r = await (await this.drive()).about.get({ fields: 'storageQuota' });
      const q = r.data.storageQuota ?? {};
      return { limit: q.limit ? Number(q.limit) : null, usage: Number(q.usage ?? 0), usageInDrive: Number(q.usageInDrive ?? 0), usageInDriveTrash: Number(q.usageInDriveTrash ?? 0) };
    } catch (e) {
      throw classifyDriveError(e);
    }
  }
}

function toStored(f: drive_v3.Schema$File): StoredBackupFile {
  return { fileId: f.id!, size: f.size ? Number(f.size) : null, md5Checksum: f.md5Checksum ?? null, sha256Checksum: f.sha256Checksum ?? null };
}
