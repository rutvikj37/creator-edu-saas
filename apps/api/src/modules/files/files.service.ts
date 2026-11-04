import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppException } from '../../common/errors/app-exception.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { FILE_RULES, matchesSignature, safeFileName } from '../../core/storage/file-rules.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';

export interface FileView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  purpose: string;
  status: string;
  url?: string;
}

@Injectable()
export class FilesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly storage: StorageService,
    private readonly ctx: TenantContext,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Starts an upload: validates type/size/quota and returns a short-lived direct upload URL. */
  async begin(p: { purpose: string; fileName: string; mimeType: string; sizeBytes: number; ownerUserId: string; apiOrigin: string }) {
    const rule = FILE_RULES[p.purpose];
    if (!rule) throw AppException.validation([{ field: 'purpose', message: 'Unsupported purpose' }]);
    if (!rule.mime.includes(p.mimeType)) throw AppException.validation([{ field: 'mimeType', message: 'This file type is not allowed here' }]);
    if (p.sizeBytes > rule.maxBytes) throw AppException.validation([{ field: 'sizeBytes', message: `File is too large (max ${Math.round(rule.maxBytes / 1048576)} MB)` }]);

    const tenantId = this.ctx.requireTenantId();
    const used = await this.db.fileAsset.aggregate({ where: { status: { in: ['READY', 'UPLOADING'] } }, _sum: { sizeBytes: true } });
    const ent = await this.entitlements.get(tenantId);
    const gb = ent.features['storage.gb'];
    if (gb && gb.limit !== null && Number(used._sum.sizeBytes ?? 0) + p.sizeBytes > gb.limit * 1024 ** 3) {
      throw new AppException('PLAN_LIMIT_REACHED', `Storage limit of ${gb.limit} GB reached. Upgrade or remove files.`, 403);
    }

    const name = safeFileName(p.fileName);
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase().slice(0, 10) : '';
    const key = `tenants/${tenantId}/${p.purpose.toLowerCase()}/${new Date().toISOString().slice(0, 7)}/${randomBytes(16).toString('hex')}${ext}`;
    const file = await this.db.fileAsset.create({
      data: {
        ownerUserId: p.ownerUserId, purpose: p.purpose as never, driver: this.storage.driver, bucket: this.storage.bucketFor(rule.public),
        key, fileName: name, mimeType: p.mimeType, sizeBytes: BigInt(p.sizeBytes), isPublic: rule.public,
      } as never,
    });
    const upload = await this.storage.uploadTarget(file, p.mimeType, p.sizeBytes, p.apiOrigin);
    return { fileId: file.id, upload };
  }

  /** Confirms the object exists, has the declared size and that its bytes match the declared type. */
  async complete(id: string, apiOrigin: string): Promise<FileView> {
    const file = await this.db.fileAsset.findUnique({ where: { id } });
    if (!file) throw AppException.notFound('File not found');
    if (file.status === 'READY') return this.view(file, apiOrigin);
    const info = await this.storage.inspect(file);
    if (!info) throw AppException.validation([{ field: 'file', message: 'Upload not found. Please try again.' }]);
    if (info.size !== Number(file.sizeBytes) || !matchesSignature(file.mimeType, info.head)) {
      await this.db.fileAsset.update({ where: { id }, data: { status: 'REJECTED' } });
      await this.storage.remove(file).catch(() => undefined);
      throw AppException.validation([{ field: 'file', message: 'The file content does not match its type or size.' }]);
    }
    const ready = await this.db.fileAsset.update({ where: { id }, data: { status: 'READY' } });
    return this.view(ready, apiOrigin);
  }

  async view(file: { id: string; fileName: string; mimeType: string; sizeBytes: bigint; purpose: string; status: string; driver: string; bucket: string; key: string }, apiOrigin: string, ttl = 3600): Promise<FileView> {
    return {
      id: file.id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: Number(file.sizeBytes), purpose: file.purpose, status: file.status,
      url: file.status === 'READY' ? await this.storage.downloadUrl(file, file.fileName, apiOrigin, ttl) : undefined,
    };
  }

  /** Signed URL for a READY file of the current tenant, or null. */
  async urlFor(id: string | null | undefined, apiOrigin: string, ttl = 3600) {
    if (!id) return null;
    const file = await this.db.fileAsset.findUnique({ where: { id } });
    if (!file || file.status !== 'READY') return null;
    return this.storage.downloadUrl(file, file.fileName, apiOrigin, ttl);
  }

  async assertOwnedBy(id: string, userId: string) {
    const f = await this.db.fileAsset.findFirst({ where: { id, ownerUserId: userId } });
    if (!f) throw AppException.notFound('File not found');
    return f;
  }

  /** Validates that a file id belongs to this tenant, is READY and has one of the purposes. */
  async assertUsable(id: string, purposes: string[]) {
    const file = await this.db.fileAsset.findUnique({ where: { id } });
    if (!file || file.status !== 'READY' || !purposes.includes(file.purpose)) throw AppException.validation([{ field: 'fileId', message: 'File not found or not ready' }]);
    return file;
  }
}
