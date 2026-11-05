import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { FilesService } from '../files/files.service.js';
import { type Block, referencedFiles } from './blocks.js';
import { WebsiteService } from './website.service.js';

/** What visitors of an academy host see: only published pages, unless a valid preview token is supplied. */
@Injectable()
export class PublicSiteService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly ctx: TenantContext,
    private readonly website: WebsiteService,
    private readonly files: FilesService,
  ) {}

  async layout(preview?: string) {
    const settings = await this.website.settings();
    const isPreview = this.website.verifyPreview(this.ctx.requireTenantId(), preview);
    const pages = await this.db.sitePage.findMany({ where: { showInNav: true, isHome: false, ...(isPreview ? {} : { publishedAt: { not: null } }) }, orderBy: [{ navOrder: 'asc' }, { createdAt: 'asc' }] });
    const home = await this.db.sitePage.findFirst({ where: { isHome: true, ...(isPreview ? {} : { publishedAt: { not: null } }) }, select: { id: true } });
    const nav = [
      ...(settings.header.showCoursesLink ? [{ label: 'Courses', href: '/courses' }] : []),
      ...pages.map((p) => ({ label: (isPreview ? p.title : p.publishedTitle) ?? p.title, href: `/p/${p.slug}` })),
      ...(settings.header.showBlogLink ? [{ label: 'Blog', href: '/blog' }] : []),
      ...settings.header.links,
    ];
    return { template: settings.template, nav, footer: settings.footer, hasHomePage: Boolean(home), preview: isPreview };
  }

  /** `slug` = null for the home page. */
  async page(slug: string | null, apiOrigin: string, preview?: string) {
    const isPreview = this.website.verifyPreview(this.ctx.requireTenantId(), preview);
    const p = await this.db.sitePage.findFirst({ where: slug === null ? { isHome: true } : { slug } });
    if (!p || (!isPreview && !p.publishedAt)) throw AppException.notFound('Page not found');
    const blocks = ((isPreview ? p.draftBlocks : p.publishedBlocks) as unknown as Block[]).filter((b) => !b.hidden);
    const [files, courses] = await Promise.all([
      this.website.fileUrls(referencedFiles(blocks).concat(p.ogImageFileId ? [p.ogImageFileId] : []), apiOrigin),
      this.coursesFor(blocks, apiOrigin),
    ]);
    return {
      slug: p.slug, isHome: p.isHome, title: (isPreview ? p.title : p.publishedTitle) ?? p.title, preview: isPreview,
      seo: { title: p.seoTitle, description: p.seoDescription, image: p.ogImageFileId ? files[p.ogImageFileId] ?? null : null },
      blocks, data: { files, courses },
    };
  }

  /** Course cards for every course grid block, keyed by block id (published, public courses only). */
  private async coursesFor(blocks: Block[], apiOrigin: string) {
    const grids = blocks.filter((b) => b.type === 'courseGrid');
    const out: Record<string, unknown[]> = {};
    for (const g of grids) {
      const props = g.props as { mode: 'all' | 'selected'; courseIds: string[]; limit: number };
      const rows = await this.db.course.findMany({
        where: { status: 'PUBLISHED', visibility: 'PUBLIC', deletedAt: null, ...(props.mode === 'selected' ? { id: { in: props.courseIds } } : {}) },
        orderBy: { publishedAt: 'desc' },
        take: props.mode === 'selected' ? 24 : props.limit,
      });
      const ordered = props.mode === 'selected' ? props.courseIds.map((id) => rows.find((r) => r.id === id)).filter((r): r is (typeof rows)[number] => Boolean(r)) : rows;
      out[g.id] = await Promise.all(ordered.map(async (c) => ({
        id: c.id, slug: c.slug, title: c.title, shortDescription: c.shortDescription, isFree: c.isFree, priceAmount: c.priceAmount?.toString() ?? null,
        compareAtAmount: c.compareAtAmount?.toString() ?? null, currency: c.currency, thumbnailUrl: await this.files.urlFor(c.thumbnailFileId, apiOrigin, 86_400),
      })));
    }
    return out;
  }
}
