import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { FilesService } from '../files/files.service.js';
import { slugify } from '../tenants/slug.js';
import { fromMinor, toMinor } from './providers/money.js';

export interface BundleInput {
  title?: string;
  description?: string | null;
  priceAmount?: number;
  courseIds?: string[];
  coverFileId?: string | null;
}

const MIN_COURSES = 2;
const MAX_COURSES = 30;

/** Course bundles: several courses sold together at one price. */
@Injectable()
export class BundlesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly ctx: TenantContext,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  private async uniqueSlug(base: string, excludeId?: string) {
    const root = slugify(base).slice(0, 100) || 'bundle';
    for (let i = 0; i < 100; i++) {
      const candidate = i === 0 ? root : `${root}-${i + 1}`;
      if (!(await this.db.bundle.findFirst({ where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } }))) return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
  }

  /** Validates fields; courses must exist (publishing checks they are published). */
  private async validate(input: BundleInput) {
    const errors: { field: string; message: string }[] = [];
    if (input.title !== undefined && (!input.title.trim() || input.title.trim().length > 200)) errors.push({ field: 'title', message: '1–200 characters' });
    if (input.priceAmount !== undefined && !(input.priceAmount > 0)) errors.push({ field: 'priceAmount', message: 'Enter a price' });
    let courses: { id: string; currency: string; title: string; status: string; priceAmount: unknown; isFree: boolean }[] = [];
    if (input.courseIds !== undefined) {
      const ids = [...new Set(input.courseIds)];
      if (ids.length < MIN_COURSES || ids.length > MAX_COURSES) errors.push({ field: 'courseIds', message: `Choose ${MIN_COURSES}–${MAX_COURSES} courses` });
      courses = await this.db.course.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, currency: true, title: true, status: true, priceAmount: true, isFree: true } });
      if (courses.length !== ids.length) errors.push({ field: 'courseIds', message: 'Some courses were not found' });
      if (new Set(courses.map((c) => c.currency)).size > 1) errors.push({ field: 'courseIds', message: 'All courses in a bundle must use the same currency' });
    }
    if (input.coverFileId) await this.files.assertUsable(input.coverFileId, ['IMAGE', 'COURSE_THUMBNAIL']).catch(() => errors.push({ field: 'coverFileId', message: 'Upload an image' }));
    if (errors.length) throw AppException.validation(errors);
    return courses;
  }

  private async present(b: { id: string; title: string; slug: string; description: string | null; priceAmount: unknown; currency: string; courseIds: unknown; coverFileId: string | null; status: string; publishedAt: Date | null; createdAt: Date; updatedAt: Date }, apiOrigin?: string) {
    const ids = b.courseIds as string[];
    const courses = await this.db.course.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, slug: true, status: true, isFree: true, priceAmount: true, currency: true, deletedAt: true } });
    const byId = new Map(courses.map((c) => [c.id, c]));
    const ordered = ids.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
    const worthMinor = ordered.reduce((s, c) => s + (c.isFree || c.priceAmount === null ? 0 : toMinor(c.priceAmount, c.currency)), 0);
    const sold = await this.db.orderItem.count({ where: { bundleId: b.id, order: { status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } } });
    return {
      id: b.id, title: b.title, slug: b.slug, description: b.description, priceAmount: String(b.priceAmount), currency: b.currency, status: b.status, publishedAt: b.publishedAt,
      coverFileId: b.coverFileId, coverUrl: apiOrigin ? await this.files.urlFor(b.coverFileId, apiOrigin, 86_400) : null,
      courses: ordered.map((c) => ({ id: c.id, title: c.title, slug: c.slug, status: c.deletedAt ? 'DELETED' : c.status, priceAmount: c.isFree ? null : c.priceAmount?.toString() ?? null })),
      worthAmount: fromMinor(worthMinor, b.currency), sold, createdAt: b.createdAt, updatedAt: b.updatedAt,
    };
  }

  async list(apiOrigin: string) {
    const rows = await this.db.bundle.findMany({ where: { status: { not: 'ARCHIVED' } }, orderBy: { createdAt: 'desc' } });
    return Promise.all(rows.map((b) => this.present(b, apiOrigin)));
  }

  private async find(id: string) {
    const b = await this.db.bundle.findFirst({ where: { id } });
    if (!b) throw AppException.notFound('Bundle not found');
    return b;
  }

  async get(id: string, apiOrigin: string) {
    return this.present(await this.find(id), apiOrigin);
  }

  async create(input: Required<Pick<BundleInput, 'title' | 'priceAmount' | 'courseIds'>> & BundleInput, actorUserId: string, apiOrigin: string) {
    const courses = await this.validate(input);
    const b = await this.db.bundle.create({
      data: {
        title: input.title.trim(), slug: await this.uniqueSlug(input.title), description: input.description?.trim() || null, priceAmount: input.priceAmount, currency: courses[0].currency,
        courseIds: [...new Set(input.courseIds)], coverFileId: input.coverFileId ?? null, createdById: actorUserId,
      } as never,
    });
    await this.audit.record({ action: 'bundle.create', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Bundle', targetId: b.id, after: { title: b.title, courses: input.courseIds.length } });
    return this.present(b, apiOrigin);
  }

  async update(id: string, input: BundleInput, actorUserId: string, apiOrigin: string) {
    const b = await this.find(id);
    const courses = await this.validate(input);
    const updated = await this.db.bundle.update({
      where: { id: b.id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.priceAmount !== undefined ? { priceAmount: input.priceAmount } : {}),
        ...(input.courseIds !== undefined ? { courseIds: [...new Set(input.courseIds)], currency: courses[0].currency } : {}),
        ...(input.coverFileId !== undefined ? { coverFileId: input.coverFileId } : {}),
      },
    });
    if (updated.status === 'PUBLISHED') await this.assertPublishable(updated);
    await this.audit.record({ action: 'bundle.update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Bundle', targetId: b.id });
    return this.present(updated, apiOrigin);
  }

  private async assertPublishable(b: { courseIds: unknown; priceAmount: unknown }) {
    const ids = b.courseIds as string[];
    const live = await this.db.course.findMany({ where: { id: { in: ids }, status: 'PUBLISHED', deletedAt: null }, select: { id: true } });
    const missing = ids.filter((id) => !live.some((c) => c.id === id));
    if (missing.length) {
      const titles = (await this.db.course.findMany({ where: { id: { in: missing } }, select: { title: true } })).map((c) => c.title);
      throw AppException.validation([{ field: 'courseIds', message: `Publish these courses first: ${titles.join(', ') || 'removed courses'}` }]);
    }
    if (!(Number(b.priceAmount) > 0)) throw AppException.validation([{ field: 'priceAmount', message: 'Enter a price' }]);
  }

  async setStatus(id: string, status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED', actorUserId: string, apiOrigin: string) {
    const b = await this.find(id);
    if (status === 'PUBLISHED') await this.assertPublishable(b);
    const updated = await this.db.bundle.update({ where: { id: b.id }, data: { status, ...(status === 'PUBLISHED' && !b.publishedAt ? { publishedAt: new Date() } : {}) } });
    if (status !== 'PUBLISHED') await this.db.cartItem.deleteMany({ where: { bundleId: b.id } });
    await this.audit.record({ action: `bundle.${status.toLowerCase()}`, tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Bundle', targetId: b.id });
    return this.present(updated, apiOrigin);
  }

  // ── public ────────────────────────────────────────────────
  async publicList(apiOrigin: string) {
    const rows = await this.db.bundle.findMany({ where: { status: 'PUBLISHED' }, orderBy: { publishedAt: 'desc' }, take: 50 });
    const out = [];
    for (const b of rows) {
      const v = await this.present(b, apiOrigin);
      if (v.courses.length && v.courses.every((c) => c.status === 'PUBLISHED')) out.push(this.publicView(v));
    }
    return out;
  }

  async publicGet(slug: string, apiOrigin: string) {
    const b = await this.db.bundle.findFirst({ where: { slug: slug.slice(0, 120), status: 'PUBLISHED' } });
    if (!b) throw AppException.notFound('Bundle not found');
    const v = await this.present(b, apiOrigin);
    if (!v.courses.every((c) => c.status === 'PUBLISHED')) throw AppException.notFound('Bundle not found');
    const details = await this.db.course.findMany({ where: { id: { in: v.courses.map((c) => c.id) } }, select: { id: true, shortDescription: true, thumbnailFileId: true, level: true } });
    return {
      ...this.publicView(v),
      courses: await Promise.all(v.courses.map(async (c) => {
        const d = details.find((x) => x.id === c.id);
        return { ...c, shortDescription: d?.shortDescription ?? null, level: d?.level ?? null, thumbnailUrl: await this.files.urlFor(d?.thumbnailFileId ?? null, apiOrigin, 86_400) };
      })),
    };
  }

  private publicView(v: Awaited<ReturnType<BundlesService['present']>>) {
    return { id: v.id, slug: v.slug, title: v.title, description: v.description, priceAmount: v.priceAmount, worthAmount: v.worthAmount, currency: v.currency, coverUrl: v.coverUrl, courseCount: v.courses.length, courses: v.courses.map((c) => ({ id: c.id, title: c.title, slug: c.slug, status: c.status })) };
  }
}
