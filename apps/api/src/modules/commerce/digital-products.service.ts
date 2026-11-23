import { Inject, Injectable, Optional } from '@nestjs/common';
import { PdfWatermarkService } from '../files/pdf-watermark.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { FilesService } from '../files/files.service.js';
import { slugify } from '../tenants/slug.js';

export interface ProductInput {
  title?: string;
  description?: string | null;
  priceAmount?: number;
  compareAtAmount?: number | null;
  coverFileId?: string | null;
  downloadLimit?: number | null;
  /** Ordered files: existing ids keep their row; `fileAssetId` adds an uploaded file. */
  files?: { id?: string; fileAssetId?: string; title: string }[];
}

const MAX_FILES = 50;

/**
 * Digital products: files sold (or given) on their own. Buyers download through short-lived
 * signed links after an access check; each download is logged and an optional per-file limit
 * applies. Files are private storage objects and are never exposed by a public URL.
 */
@Injectable()
export class DigitalProductsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly files: FilesService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @Optional() private readonly watermark?: PdfWatermarkService,
  ) {}

  private async uniqueSlug(base: string, excludeId?: string) {
    const root = slugify(base).slice(0, 100) || 'product';
    for (let i = 0; i < 100; i++) {
      const candidate = i === 0 ? root : `${root}-${i + 1}`;
      if (!(await this.db.digitalProduct.findFirst({ where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } }))) return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
  }

  private async load(id: string) {
    const p = await this.db.digitalProduct.findFirst({ where: { id }, include: { files: { orderBy: { position: 'asc' } } } });
    if (!p) throw AppException.notFound('Product not found');
    return p;
  }

  private async view(p: Awaited<ReturnType<DigitalProductsService['load']>>, apiOrigin: string) {
    const assets = await this.db.fileAsset.findMany({ where: { id: { in: p.files.map((f) => f.fileAssetId) } }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true } });
    const [buyers, revenue] = await Promise.all([
      this.db.digitalProductAccess.count({ where: { productId: p.id, revokedAt: null } }),
      this.db.orderItem.aggregate({ where: { digitalProductId: p.id, order: { status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } }, _sum: { totalAmount: true }, _count: { _all: true } }),
    ]);
    return {
      id: p.id, title: p.title, slug: p.slug, description: p.description, priceAmount: p.priceAmount.toString(), compareAtAmount: p.compareAtAmount?.toString() ?? null, currency: p.currency,
      status: p.status, downloadLimit: p.downloadLimit, publishedAt: p.publishedAt, coverFileId: p.coverFileId, coverUrl: await this.files.urlFor(p.coverFileId, apiOrigin, 86_400),
      files: p.files.map((f) => {
        const a = assets.find((x) => x.id === f.fileAssetId);
        return { id: f.id, title: f.title, fileAssetId: f.fileAssetId, fileName: a?.fileName ?? null, mimeType: a?.mimeType ?? null, sizeBytes: a ? Number(a.sizeBytes) : null };
      }),
      buyers, sales: revenue._count._all, revenue: revenue._sum.totalAmount?.toString() ?? '0', createdAt: p.createdAt, updatedAt: p.updatedAt,
    };
  }

  // ── creator ───────────────────────────────────────────────
  async list(apiOrigin: string) {
    const rows = await this.db.digitalProduct.findMany({ where: { status: { not: 'ARCHIVED' } }, orderBy: { createdAt: 'desc' }, include: { files: { orderBy: { position: 'asc' } } } });
    return Promise.all(rows.map((p) => this.view(p, apiOrigin)));
  }

  async get(id: string, apiOrigin: string) {
    return this.view(await this.load(id), apiOrigin);
  }

  private async validate(input: ProductInput, existing?: { files: { id: string }[] }) {
    const errors: { field: string; message: string }[] = [];
    if (input.title !== undefined && (!input.title.trim() || input.title.trim().length > 200)) errors.push({ field: 'title', message: '1–200 characters' });
    if (input.priceAmount !== undefined && !(input.priceAmount >= 0)) errors.push({ field: 'priceAmount', message: 'Enter a price (0 for free)' });
    if (input.compareAtAmount && input.priceAmount !== undefined && input.compareAtAmount <= input.priceAmount) errors.push({ field: 'compareAtAmount', message: 'Must be higher than the price' });
    if (input.downloadLimit !== undefined && input.downloadLimit !== null && !(input.downloadLimit >= 1)) errors.push({ field: 'downloadLimit', message: 'At least 1, or leave empty for unlimited' });
    if (input.coverFileId) await this.files.assertUsable(input.coverFileId, ['IMAGE', 'COURSE_THUMBNAIL']).catch(() => errors.push({ field: 'coverFileId', message: 'Upload an image' }));
    if (input.files) {
      if (input.files.length > MAX_FILES) errors.push({ field: 'files', message: `Up to ${MAX_FILES} files` });
      for (const f of input.files) {
        if (f.id && !existing?.files.some((x) => x.id === f.id)) errors.push({ field: 'files', message: 'A file was not found on this product' });
        if (!f.id && !f.fileAssetId) errors.push({ field: 'files', message: 'Upload each file' });
        if (f.fileAssetId) await this.files.assertUsable(f.fileAssetId, ['PRODUCT_FILE']).catch(() => errors.push({ field: 'files', message: 'A file is not ready yet; wait for the upload to finish' }));
        if (!f.title?.trim()) errors.push({ field: 'files', message: 'Give every file a name' });
      }
    }
    if (errors.length) throw AppException.validation(errors);
  }

  private async writeFiles(productId: string, files: NonNullable<ProductInput['files']>) {
    const keep = files.filter((f) => f.id).map((f) => f.id!);
    await this.db.digitalProductFile.deleteMany({ where: { productId, id: { notIn: keep.length ? keep : ['-'] } } });
    for (const [i, f] of files.entries()) {
      if (f.id) await this.db.digitalProductFile.update({ where: { id: f.id }, data: { title: f.title.trim().slice(0, 200), position: i } });
      else await this.db.digitalProductFile.create({ data: { productId, fileAssetId: f.fileAssetId!, title: f.title.trim().slice(0, 200), position: i } as never });
    }
  }

  async create(input: Required<Pick<ProductInput, 'title' | 'priceAmount'>> & ProductInput, actorUserId: string, apiOrigin: string) {
    await this.validate(input);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: this.ctx.requireTenantId() }, select: { defaultCurrency: true } });
    const p = await this.db.digitalProduct.create({
      data: {
        title: input.title.trim(), slug: await this.uniqueSlug(input.title), description: input.description?.trim() || null, priceAmount: input.priceAmount, compareAtAmount: input.compareAtAmount ?? null,
        currency: tenant.defaultCurrency, coverFileId: input.coverFileId ?? null, downloadLimit: input.downloadLimit ?? null, createdById: actorUserId,
      } as never,
    });
    if (input.files?.length) await this.writeFiles(p.id, input.files);
    await this.audit.record({ action: 'product.create', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'DigitalProduct', targetId: p.id, after: { title: p.title } });
    return this.get(p.id, apiOrigin);
  }

  async update(id: string, input: ProductInput, actorUserId: string, apiOrigin: string) {
    const p = await this.load(id);
    await this.validate({ ...input, priceAmount: input.priceAmount ?? Number(p.priceAmount) }, p);
    await this.db.digitalProduct.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.priceAmount !== undefined ? { priceAmount: input.priceAmount } : {}),
        ...(input.compareAtAmount !== undefined ? { compareAtAmount: input.compareAtAmount } : {}),
        ...(input.coverFileId !== undefined ? { coverFileId: input.coverFileId } : {}),
        ...(input.downloadLimit !== undefined ? { downloadLimit: input.downloadLimit } : {}),
      },
    });
    if (input.files) await this.writeFiles(id, input.files);
    const after = await this.load(id);
    if (after.status === 'PUBLISHED' && !after.files.length) throw AppException.validation([{ field: 'files', message: 'A published product needs at least one file' }]);
    await this.audit.record({ action: 'product.update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'DigitalProduct', targetId: id });
    return this.view(after, apiOrigin);
  }

  async setStatus(id: string, status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED', actorUserId: string, apiOrigin: string) {
    const p = await this.load(id);
    if (status === 'PUBLISHED' && !p.files.length) throw AppException.validation([{ field: 'files', message: 'Add at least one file before publishing' }]);
    await this.db.digitalProduct.update({ where: { id }, data: { status, ...(status === 'PUBLISHED' && !p.publishedAt ? { publishedAt: new Date() } : {}) } });
    if (status !== 'PUBLISHED') await this.db.cartItem.deleteMany({ where: { digitalProductId: id } });
    await this.audit.record({ action: `product.${status.toLowerCase()}`, tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'DigitalProduct', targetId: id });
    return this.get(id, apiOrigin);
  }

  /** Buyers of a product (academy view). */
  async buyers(id: string) {
    await this.load(id);
    const rows = await this.db.digitalProductAccess.findMany({ where: { productId: id }, orderBy: { createdAt: 'desc' }, take: 500 });
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, fullName: true, email: true } });
    const downloads = await this.db.digitalProductDownload.groupBy({ by: ['userId'], where: { productId: id }, _count: { _all: true } });
    return rows.map((r) => ({ userId: r.userId, name: users.find((u) => u.id === r.userId)?.fullName ?? '', email: users.find((u) => u.id === r.userId)?.email ?? '', source: r.source, active: !r.revokedAt, since: r.createdAt, downloads: downloads.find((d) => d.userId === r.userId)?._count._all ?? 0 }));
  }

  // ── public ────────────────────────────────────────────────
  private publicView(p: Awaited<ReturnType<DigitalProductsService['view']>>) {
    return {
      id: p.id, slug: p.slug, title: p.title, description: p.description, priceAmount: p.priceAmount, compareAtAmount: p.compareAtAmount, currency: p.currency, isFree: Number(p.priceAmount) === 0,
      coverUrl: p.coverUrl, downloadLimit: p.downloadLimit,
      files: p.files.map((f) => ({ title: f.title, type: (f.fileName?.split('.').pop() ?? '').toUpperCase().slice(0, 6) || null, sizeBytes: f.sizeBytes })),
    };
  }

  async publicList(apiOrigin: string) {
    const rows = await this.db.digitalProduct.findMany({ where: { status: 'PUBLISHED' }, orderBy: { publishedAt: 'desc' }, take: 100, include: { files: { orderBy: { position: 'asc' } } } });
    return Promise.all(rows.map(async (p) => this.publicView(await this.view(p, apiOrigin))));
  }

  async publicGet(slug: string, apiOrigin: string) {
    const p = await this.db.digitalProduct.findFirst({ where: { slug: slug.slice(0, 120), status: 'PUBLISHED' }, include: { files: { orderBy: { position: 'asc' } } } });
    if (!p) throw AppException.notFound('Product not found');
    return this.publicView(await this.view(p, apiOrigin));
  }

  // ── student ───────────────────────────────────────────────
  async claimFree(userId: string, productId: string) {
    const p = await this.db.digitalProduct.findFirst({ where: { id: productId, status: 'PUBLISHED' } });
    if (!p) throw AppException.notFound('Product not found');
    if (Number(p.priceAmount) > 0) throw AppException.conflict('This product is paid — buy it to download.');
    await this.grant(this.db, userId, productId, 'FREE', null);
    return { claimed: true };
  }

  /** Grants (or restores) access; used by free claims and order fulfilment. */
  async grant(tx: Pick<TenantPrismaClient, 'digitalProductAccess'>, userId: string, productId: string, source: 'FREE' | 'PURCHASE' | 'MANUAL', orderId: string | null) {
    const existing = await tx.digitalProductAccess.findFirst({ where: { productId, userId } });
    if (existing) {
      if (existing.revokedAt || (orderId && !existing.orderId)) await tx.digitalProductAccess.update({ where: { id: existing.id }, data: { revokedAt: null, source, orderId: orderId ?? existing.orderId } });
      return;
    }
    await tx.digitalProductAccess.create({ data: { productId, userId, source, orderId } as never });
  }

  async mine(userId: string, apiOrigin: string) {
    const access = await this.db.digitalProductAccess.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: 'desc' } });
    const out = [];
    for (const a of access) {
      const p = await this.db.digitalProduct.findFirst({ where: { id: a.productId }, include: { files: { orderBy: { position: 'asc' } } } });
      if (!p) continue;
      const counts = await this.db.digitalProductDownload.groupBy({ by: ['fileId'], where: { productId: p.id, userId }, _count: { _all: true } });
      const v = await this.view(p, apiOrigin);
      out.push({
        id: p.id, title: p.title, slug: p.slug, coverUrl: v.coverUrl, since: a.createdAt, downloadLimit: p.downloadLimit,
        files: v.files.map((f) => {
          const used = counts.find((c) => c.fileId === f.id)?._count._all ?? 0;
          return { id: f.id, title: f.title, fileName: f.fileName, sizeBytes: f.sizeBytes, downloads: used, remaining: p.downloadLimit === null ? null : Math.max(0, p.downloadLimit - used) };
        }),
      });
    }
    return out;
  }

  /** Short-lived signed link to one file, after the access check and limit. */
  async download(userId: string, productId: string, fileId: string, apiOrigin: string) {
    const access = await this.db.digitalProductAccess.findFirst({ where: { productId, userId, revokedAt: null } });
    if (!access) throw AppException.forbidden('You do not have access to this product.');
    const p = await this.db.digitalProduct.findFirst({ where: { id: productId } });
    const f = await this.db.digitalProductFile.findFirst({ where: { id: fileId, productId } });
    if (!p || !f) throw AppException.notFound('File not found');
    if (p.downloadLimit !== null) {
      const used = await this.db.digitalProductDownload.count({ where: { fileId, userId } });
      if (used >= p.downloadLimit) throw AppException.conflict(`You have used all ${p.downloadLimit} downloads of this file. Contact the academy if you need it again.`);
    }
    const asset = await this.db.fileAsset.findFirst({ where: { id: f.fileAssetId } });
    if (!asset || asset.status !== 'READY') throw AppException.notFound('File not available');
    await this.db.digitalProductDownload.create({ data: { productId, fileId, userId } as never });
    const url = (await this.watermark?.link(asset as never, userId, apiOrigin, true)) ?? await this.storage.downloadUrl(asset, asset.fileName, apiOrigin, 600, false);
    return { url, fileName: asset.fileName, expiresInSeconds: 600 };
  }
}
