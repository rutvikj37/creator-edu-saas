import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { RichTextError, richTextToPlain, validateRichText } from '../../common/richtext/richtext.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { FilesService } from '../files/files.service.js';
import { slugify } from '../tenants/slug.js';

export interface PostInput {
  title?: string;
  slug?: string;
  excerpt?: string | null;
  content?: unknown;
  coverFileId?: string | null;
  tags?: string[];
  seoTitle?: string | null;
  seoDescription?: string | null;
}

const POST_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,158}[a-z0-9])?$/;
const EMPTY_DOC = { type: 'doc', content: [] };

@Injectable()
export class BlogService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  private async view(p: any, apiOrigin: string, full = true) {
    return {
      id: p.id, slug: p.slug, title: p.title, excerpt: p.excerpt, status: p.status, publishedAt: p.publishedAt, tags: (p.tags as string[] | null) ?? [],
      coverFileId: p.coverFileId, coverUrl: await this.files.urlFor(p.coverFileId, apiOrigin, 86_400), seoTitle: p.seoTitle, seoDescription: p.seoDescription,
      updatedAt: p.updatedAt, createdAt: p.createdAt, ...(full ? { content: p.content } : {}),
    };
  }

  private async validate(input: PostInput, currentId?: string) {
    const errors: { field: string; message: string }[] = [];
    if (input.title !== undefined && (!input.title.trim() || input.title.trim().length > 200)) errors.push({ field: 'title', message: '1–200 characters' });
    if (input.slug !== undefined) {
      if (!POST_SLUG.test(input.slug)) errors.push({ field: 'slug', message: 'Use lowercase letters, numbers and hyphens' });
      else if (await this.db.blogPost.findFirst({ where: { slug: input.slug, ...(currentId ? { id: { not: currentId } } : {}) } })) errors.push({ field: 'slug', message: 'Another post already uses this address' });
    }
    if (input.content !== undefined) {
      try {
        validateRichText(input.content);
      } catch (e) {
        errors.push({ field: 'content', message: e instanceof RichTextError ? e.message : 'Invalid content' });
      }
    }
    if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.length > 10 || input.tags.some((t) => typeof t !== 'string' || !t.trim() || t.length > 40))) {
      errors.push({ field: 'tags', message: 'Up to 10 tags of 1–40 characters' });
    }
    if (input.coverFileId) {
      try {
        await this.files.assertUsable(input.coverFileId, ['IMAGE', 'COURSE_THUMBNAIL', 'COURSE_BANNER']);
      } catch {
        errors.push({ field: 'coverFileId', message: 'Image not found or still uploading' });
      }
    }
    if (errors.length) throw AppException.validation(errors);
  }

  private async uniqueSlug(title: string) {
    const base = slugify(title).slice(0, 150);
    for (let i = 0; i < 50; i++) {
      const s = i ? `${base}-${i + 1}` : base;
      if (!(await this.db.blogPost.findFirst({ where: { slug: s } }))) return s;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  async list(apiOrigin: string, status?: 'DRAFT' | 'PUBLISHED') {
    const rows = await this.db.blogPost.findMany({ where: status ? { status } : {}, orderBy: [{ updatedAt: 'desc' }], take: 200 });
    return Promise.all(rows.map((r) => this.view(r, apiOrigin, false)));
  }

  async get(id: string, apiOrigin: string) {
    const p = await this.db.blogPost.findFirst({ where: { id } });
    if (!p) throw AppException.notFound('Post not found');
    return this.view(p, apiOrigin);
  }

  async create(input: PostInput & { title: string }, actorUserId: string, apiOrigin: string) {
    await this.validate(input);
    const slug = input.slug ?? (await this.uniqueSlug(input.title));
    const p = await this.db.blogPost.create({
      data: {
        title: input.title.trim(), slug, excerpt: input.excerpt?.trim() || null, content: (input.content ?? EMPTY_DOC) as never, coverFileId: input.coverFileId ?? null,
        tags: input.tags?.map((t) => t.trim()) ?? [], seoTitle: input.seoTitle?.trim() || null, seoDescription: input.seoDescription?.trim() || null, authorId: actorUserId,
      } as never,
    });
    await this.audit.record({ action: 'blog.create', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'BlogPost', targetId: p.id, after: { slug } });
    return this.view(p, apiOrigin);
  }

  async update(id: string, input: PostInput, apiOrigin: string) {
    const p = await this.db.blogPost.findFirst({ where: { id } });
    if (!p) throw AppException.notFound('Post not found');
    await this.validate(input, id);
    const u = await this.db.blogPost.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.excerpt !== undefined ? { excerpt: input.excerpt?.trim() || null } : {}),
        ...(input.content !== undefined ? { content: input.content as never } : {}),
        ...(input.coverFileId !== undefined ? { coverFileId: input.coverFileId || null } : {}),
        ...(input.tags !== undefined ? { tags: input.tags.map((t) => t.trim()) } : {}),
        ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle?.trim() || null } : {}),
        ...(input.seoDescription !== undefined ? { seoDescription: input.seoDescription?.trim() || null } : {}),
      },
    });
    return this.view(u, apiOrigin);
  }

  async setPublished(id: string, published: boolean, actorUserId: string, apiOrigin: string) {
    const p = await this.db.blogPost.findFirst({ where: { id } });
    if (!p) throw AppException.notFound('Post not found');
    if (published && !richTextToPlain(p.content).trim()) throw AppException.validation([{ field: 'content', message: 'Write something before publishing' }]);
    const u = await this.db.blogPost.update({ where: { id }, data: published ? { status: 'PUBLISHED', publishedAt: p.publishedAt ?? new Date() } : { status: 'DRAFT' } });
    await this.audit.record({ action: published ? 'blog.publish' : 'blog.unpublish', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'BlogPost', targetId: id });
    return this.view(u, apiOrigin);
  }

  async remove(id: string, actorUserId: string) {
    const p = await this.db.blogPost.findFirst({ where: { id } });
    if (!p) throw AppException.notFound('Post not found');
    await this.db.blogPost.delete({ where: { id } });
    await this.audit.record({ action: 'blog.delete', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'BlogPost', targetId: id, before: { slug: p.slug } });
    return { deleted: true };
  }

  // ── public ────────────────────────────────────────────────
  async publicList(apiOrigin: string, page = 1, pageSize = 12) {
    const where = { status: 'PUBLISHED' as const };
    const [rows, total] = await Promise.all([
      this.db.blogPost.findMany({ where, orderBy: { publishedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.db.blogPost.count({ where }),
    ]);
    const authors = await this.authors(rows.map((r) => r.authorId));
    return { items: await Promise.all(rows.map(async (r) => ({ ...(await this.view(r, apiOrigin, false)), author: authors.get(r.authorId) ?? null }))), meta: { page, pageSize, total } };
  }

  async publicGet(slug: string, apiOrigin: string) {
    const p = await this.db.blogPost.findFirst({ where: { slug, status: 'PUBLISHED' } });
    if (!p) throw AppException.notFound('Post not found');
    const authors = await this.authors([p.authorId]);
    return { ...(await this.view(p, apiOrigin)), author: authors.get(p.authorId) ?? null };
  }

  private async authors(ids: string[]) {
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }
}
