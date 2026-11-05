import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { safeEqual } from '../../core/crypto/crypto.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { FilesService } from '../files/files.service.js';
import { type Block, PAGE_SLUG, parseBlocks, referencedFiles, RESERVED_PAGE_SLUGS, SAFE_HREF } from './blocks.js';
import { TEMPLATES, type TemplateKey } from './templates.js';

const IMAGE_PURPOSES = ['IMAGE', 'COURSE_THUMBNAIL', 'COURSE_BANNER', 'LOGO'];
const MAX_PAGES = 50;
const MAX_VERSIONS = 30;
const PREVIEW_TTL_MS = 60 * 60_000;

export type WebsiteMode = 'PLATFORM' | 'EXTERNAL';

export interface NavLink { label: string; href: string }
export interface HeaderConfig { links: NavLink[]; showCoursesLink: boolean; showBlogLink: boolean }
export interface FooterConfig { text: string; links: NavLink[] }

export interface PageInput {
  title?: string;
  slug?: string;
  draftBlocks?: unknown;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogImageFileId?: string | null;
  showInNav?: boolean;
  navOrder?: number;
}

const DEFAULT_HEADER: HeaderConfig = { links: [], showCoursesLink: true, showBlogLink: false };
const DEFAULT_FOOTER: FooterConfig = { text: '', links: [] };

function validLinks(links: unknown, max: number, field: string) {
  const errors: { field: string; message: string }[] = [];
  if (!Array.isArray(links)) return { links: [] as NavLink[], errors: [{ field, message: 'Links must be a list' }] };
  if (links.length > max) errors.push({ field, message: `At most ${max} links` });
  const out: NavLink[] = [];
  links.slice(0, max).forEach((l: any, i) => {
    const label = typeof l?.label === 'string' ? l.label.trim() : '';
    const href = typeof l?.href === 'string' ? l.href.trim() : '';
    if (!label || label.length > 40) errors.push({ field: `${field}.${i}.label`, message: '1–40 characters' });
    if (!href || href.length > 500 || !SAFE_HREF.test(href)) errors.push({ field: `${field}.${i}.href`, message: 'Use a path like /about or a full https:// link' });
    out.push({ label, href });
  });
  return { links: out, errors };
}

/**
 * Academy website: settings (template, header, footer), block pages with draft → publish and
 * version history, and preview tokens for unpublished drafts.
 */
@Injectable()
export class WebsiteService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  // ── settings ──────────────────────────────────────────────
  async settings() {
    const s = await this.db.siteSettings.findFirst({});
    return s
      ? { mode: s.mode as WebsiteMode, externalUrl: s.externalUrl, template: s.template as TemplateKey, header: { ...DEFAULT_HEADER, ...(s.header as object) } as HeaderConfig, footer: { ...DEFAULT_FOOTER, ...(s.footer as object) } as FooterConfig }
      : { mode: 'PLATFORM' as WebsiteMode, externalUrl: null as string | null, template: 'classic' as TemplateKey, header: DEFAULT_HEADER, footer: DEFAULT_FOOTER };
  }

  /**
   * An external website must be a public https address that is not served by this platform
   * (the platform domain or one of the academy's own connected domains) — otherwise the academy
   * home would redirect to itself.
   */
  private async validateExternalUrl(raw: string): Promise<string> {
    let u: URL;
    try {
      u = new URL(raw.trim());
    } catch {
      throw AppException.validation([{ field: 'externalUrl', message: 'Enter a full address, e.g. https://www.example.com' }]);
    }
    const host = u.hostname.toLowerCase();
    const root = this.config.get('PLATFORM_ROOT_DOMAIN').toLowerCase();
    const problems: string[] = [];
    if (u.protocol !== 'https:') problems.push('Use an https:// address');
    if (u.username || u.password) problems.push('Do not include a username or password');
    if (!host.includes('.') || /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[.*\])$/.test(host)) problems.push('Use your website’s public domain name');
    if (host === root || host.endsWith(`.${root}`)) problems.push('This address is your academy on our platform; enter your own website');
    const own = await this.db.tenantDomain.findFirst({ where: { hostname: host } });
    if (own) problems.push('This domain is connected to your academy on our platform; enter the website you host elsewhere');
    if (problems.length) throw AppException.validation(problems.map((message) => ({ field: 'externalUrl', message })));
    u.hash = '';
    return u.toString().slice(0, 500);
  }

  async overview() {
    const [settings, pages] = await Promise.all([this.settings(), this.db.sitePage.findMany({ orderBy: [{ isHome: 'desc' }, { navOrder: 'asc' }, { createdAt: 'asc' }] })]);
    return {
      settings,
      templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, name: t.name, description: t.description })),
      pages: pages.map((p) => this.summary(p)),
    };
  }

  async updateSettings(input: { mode?: WebsiteMode; externalUrl?: string | null; template?: string; header?: Partial<HeaderConfig>; footer?: Partial<FooterConfig> }, actorUserId: string) {
    const current = await this.settings();
    const errors: { field: string; message: string }[] = [];
    const mode = input.mode ?? current.mode;
    let externalUrl = current.externalUrl;
    if (input.externalUrl !== undefined) externalUrl = input.externalUrl ? await this.validateExternalUrl(input.externalUrl) : null;
    if (mode === 'EXTERNAL' && !externalUrl) errors.push({ field: 'externalUrl', message: 'Enter your website address to use it as your academy home' });
    if (input.template !== undefined && !(input.template in TEMPLATES)) errors.push({ field: 'template', message: 'Unknown template' });
    const header = { ...current.header, ...(input.header ?? {}) };
    const footer = { ...current.footer, ...(input.footer ?? {}) };
    const hl = validLinks(header.links, 8, 'header.links');
    const fl = validLinks(footer.links, 12, 'footer.links');
    errors.push(...hl.errors, ...fl.errors);
    if (typeof footer.text !== 'string' || footer.text.length > 300) errors.push({ field: 'footer.text', message: 'Up to 300 characters' });
    if (errors.length) throw AppException.validation(errors);
    const data = {
      mode,
      externalUrl,
      template: input.template ?? current.template,
      header: { links: hl.links, showCoursesLink: Boolean(header.showCoursesLink), showBlogLink: Boolean(header.showBlogLink) },
      footer: { text: footer.text.trim(), links: fl.links },
    };
    const existing = await this.db.siteSettings.findFirst({});
    if (existing) await this.db.siteSettings.update({ where: { id: existing.id }, data: data as never });
    else await this.db.siteSettings.create({ data: data as never });
    await this.audit.record({ action: 'website.settings', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'SiteSettings', after: data });
    return this.settings();
  }

  // ── templates ─────────────────────────────────────────────
  /** Applies a template's style and creates its starter pages (from the academy's own content). Existing pages are kept unless replace is set. */
  async applyTemplate(key: string, replace: boolean, actorUserId: string) {
    const t = TEMPLATES[key as TemplateKey];
    if (!t) throw AppException.notFound('Template not found');
    const tenantId = this.ctx.requireTenantId();
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { academy: true } });
    const starter = t.pages({ name: tenant.name, tagline: tenant.academy?.tagline ?? null, description: tenant.academy?.description ?? null, supportEmail: tenant.academy?.supportEmail ?? null });
    await this.updateSettings({ template: key }, actorUserId);
    let created = 0;
    for (const [i, p] of starter.entries()) {
      const existing = await this.db.sitePage.findFirst({ where: { slug: p.slug } });
      const { blocks, errors } = parseBlocks(p.blocks);
      if (errors.length) throw new Error(`Template ${key} page ${p.slug} is invalid: ${errors[0].message}`);
      if (existing && !replace) continue;
      if (existing) {
        await this.db.sitePage.update({ where: { id: existing.id }, data: { title: p.title, draftBlocks: blocks as never, draftUpdatedAt: new Date() } });
      } else {
        const hasHome = await this.db.sitePage.count({ where: { isHome: true } });
        await this.db.sitePage.create({
          data: { slug: p.slug, title: p.title, isHome: p.isHome === true && !hasHome, draftBlocks: blocks as never, navOrder: i, showInNav: p.showInNav ?? true, createdById: actorUserId } as never,
        });
        created++;
      }
    }
    await this.audit.record({ action: 'website.template_apply', tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'SiteSettings', after: { template: key, replace, created } });
    return this.overview();
  }

  // ── pages ─────────────────────────────────────────────────
  private summary(p: { id: string; slug: string; title: string; isHome: boolean; publishedAt: Date | null; draftUpdatedAt: Date; showInNav: boolean; navOrder: number; updatedAt: Date }) {
    return {
      id: p.id, slug: p.slug, title: p.title, isHome: p.isHome, showInNav: p.showInNav, navOrder: p.navOrder, publishedAt: p.publishedAt,
      hasUnpublishedChanges: !p.publishedAt || p.draftUpdatedAt > p.publishedAt, path: p.isHome ? '/' : `/p/${p.slug}`, updatedAt: p.updatedAt,
    };
  }

  private async page(id: string) {
    const p = await this.db.sitePage.findFirst({ where: { id } });
    if (!p) throw AppException.notFound('Page not found');
    return p;
  }

  async get(id: string, apiOrigin: string) {
    const p = await this.page(id);
    return {
      ...this.summary(p), draftBlocks: p.draftBlocks, seoTitle: p.seoTitle, seoDescription: p.seoDescription, ogImageFileId: p.ogImageFileId,
      files: await this.fileUrls(referencedFiles(p.draftBlocks as unknown as Block[]).concat(p.ogImageFileId ? [p.ogImageFileId] : []), apiOrigin),
    };
  }

  /** Signed URLs for file ids (used by the editor canvas and the public renderer). */
  async fileUrls(ids: string[], apiOrigin: string) {
    const out: Record<string, string> = {};
    for (const id of [...new Set(ids)]) {
      const url = await this.files.urlFor(id, apiOrigin, 86_400);
      if (url) out[id] = url;
    }
    return out;
  }

  private async validatePage(input: PageInput, currentId?: string) {
    const errors: { field: string; message: string }[] = [];
    let blocks: Block[] | undefined;
    if (input.title !== undefined && (!input.title.trim() || input.title.trim().length > 120)) errors.push({ field: 'title', message: '1–120 characters' });
    if (input.slug !== undefined) {
      const slug = input.slug.trim().toLowerCase();
      if (!PAGE_SLUG.test(slug) || RESERVED_PAGE_SLUGS.has(slug)) errors.push({ field: 'slug', message: 'Use lowercase letters, numbers and hyphens; this address may be reserved' });
      else {
        const clash = await this.db.sitePage.findFirst({ where: { slug, ...(currentId ? { id: { not: currentId } } : {}) } });
        if (clash) errors.push({ field: 'slug', message: 'Another page already uses this address' });
      }
    }
    if (input.draftBlocks !== undefined) {
      const r = parseBlocks(input.draftBlocks);
      errors.push(...r.errors);
      blocks = r.blocks;
      for (const fileId of referencedFiles(r.blocks)) {
        try {
          await this.files.assertUsable(fileId, IMAGE_PURPOSES);
        } catch {
          errors.push({ field: 'blocks', message: 'An image on this page is missing or still uploading' });
          break;
        }
      }
    }
    if (input.ogImageFileId) {
      try {
        await this.files.assertUsable(input.ogImageFileId, IMAGE_PURPOSES);
      } catch {
        errors.push({ field: 'ogImageFileId', message: 'Image not found' });
      }
    }
    if (errors.length) throw AppException.validation(errors);
    return blocks;
  }

  async create(input: { title: string; slug: string; draftBlocks?: unknown }, actorUserId: string) {
    if ((await this.db.sitePage.count()) >= MAX_PAGES) throw AppException.validation([{ field: 'title', message: `A website can have up to ${MAX_PAGES} pages` }]);
    const blocks = (await this.validatePage({ ...input, draftBlocks: input.draftBlocks ?? [] })) ?? [];
    const hasHome = await this.db.sitePage.count({ where: { isHome: true } });
    const count = await this.db.sitePage.count();
    const p = await this.db.sitePage.create({
      data: { title: input.title.trim(), slug: input.slug.trim().toLowerCase(), isHome: !hasHome, draftBlocks: blocks as never, navOrder: count, createdById: actorUserId } as never,
    });
    await this.audit.record({ action: 'website.page_create', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'SitePage', targetId: p.id, after: { slug: p.slug } });
    return this.summary(p);
  }

  /** Saves draft changes (title, slug, blocks, SEO, navigation). Published content is untouched until publish. */
  async update(id: string, input: PageInput, apiOrigin: string) {
    const p = await this.page(id);
    const blocks = await this.validatePage(input, id);
    await this.db.sitePage.update({
      where: { id: p.id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.slug !== undefined ? { slug: input.slug.trim().toLowerCase() } : {}),
        ...(blocks !== undefined ? { draftBlocks: blocks as never, draftUpdatedAt: new Date() } : {}),
        ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle?.trim() || null } : {}),
        ...(input.seoDescription !== undefined ? { seoDescription: input.seoDescription?.trim() || null } : {}),
        ...(input.ogImageFileId !== undefined ? { ogImageFileId: input.ogImageFileId || null } : {}),
        ...(input.showInNav !== undefined ? { showInNav: input.showInNav } : {}),
        ...(input.navOrder !== undefined ? { navOrder: input.navOrder } : {}),
      },
    });
    return this.get(id, apiOrigin);
  }

  async publish(id: string, note: string | null, actorUserId: string, apiOrigin: string) {
    const p = await this.page(id);
    const blocks = p.draftBlocks as unknown as Block[];
    // Re-validate at publish time (files may have been deleted since the draft was saved).
    await this.validatePage({ draftBlocks: blocks }, id);
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      await tx.sitePage.update({ where: { id: p.id }, data: { publishedBlocks: blocks as never, publishedTitle: p.title, publishedAt: now, draftUpdatedAt: now } });
      await tx.sitePageVersion.create({ data: { pageId: p.id, title: p.title, blocks: blocks as never, note: note?.trim().slice(0, 120) || null, createdById: actorUserId } as never });
      const old = await tx.sitePageVersion.findMany({ where: { pageId: p.id }, orderBy: { createdAt: 'desc' }, skip: MAX_VERSIONS, select: { id: true } });
      if (old.length) await tx.sitePageVersion.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    });
    await this.audit.record({ action: 'website.page_publish', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'SitePage', targetId: p.id, after: { slug: p.slug, blocks: blocks.length } });
    return this.get(id, apiOrigin);
  }

  async unpublish(id: string, actorUserId: string, apiOrigin: string) {
    const p = await this.page(id);
    await this.db.sitePage.update({ where: { id: p.id }, data: { publishedBlocks: Prisma.DbNull, publishedAt: null, publishedTitle: null } });
    await this.audit.record({ action: 'website.page_unpublish', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'SitePage', targetId: p.id });
    return this.get(id, apiOrigin);
  }

  async versions(id: string) {
    await this.page(id);
    const rows = await this.db.sitePageVersion.findMany({ where: { pageId: id }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, note: true, createdAt: true, createdById: true, blocks: true } });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, fullName: true } });
    const name = new Map(users.map((u) => [u.id, u.fullName]));
    return rows.map((r) => ({ id: r.id, title: r.title, note: r.note, createdAt: r.createdAt, by: name.get(r.createdById) ?? null, blockCount: (r.blocks as unknown[]).length }));
  }

  /** Copies a published version into the draft (publish again to make it live). */
  async restore(id: string, versionId: string, actorUserId: string, apiOrigin: string) {
    const p = await this.page(id);
    const v = await this.db.sitePageVersion.findFirst({ where: { id: versionId, pageId: p.id } });
    if (!v) throw AppException.notFound('Version not found');
    await this.db.sitePage.update({ where: { id: p.id }, data: { draftBlocks: v.blocks as never, title: v.title, draftUpdatedAt: new Date() } });
    await this.audit.record({ action: 'website.page_restore', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'SitePage', targetId: p.id, after: { versionId } });
    return this.get(id, apiOrigin);
  }

  async setHome(id: string, actorUserId: string) {
    const p = await this.page(id);
    await this.db.sitePage.updateMany({ where: { isHome: true }, data: { isHome: false } });
    await this.db.sitePage.update({ where: { id: p.id }, data: { isHome: true } });
    await this.audit.record({ action: 'website.page_home', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'SitePage', targetId: p.id });
    return this.overview();
  }

  async remove(id: string, actorUserId: string) {
    const p = await this.page(id);
    if (p.isHome) throw AppException.conflict('Choose another home page before deleting this one.');
    await this.db.sitePage.delete({ where: { id: p.id } });
    await this.audit.record({ action: 'website.page_delete', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'SitePage', targetId: p.id, before: { slug: p.slug } });
    return { deleted: true };
  }

  // ── preview ───────────────────────────────────────────────
  private sign(payload: string) {
    return createHmac('sha256', this.config.get('JWT_ACCESS_SECRET')).update(`site-preview:${payload}`).digest('base64url');
  }

  /** Short-lived token that lets the public renderer show this academy's drafts. */
  previewToken() {
    const tenantId = this.ctx.requireTenantId();
    const exp = Date.now() + PREVIEW_TTL_MS;
    return { token: `${exp}.${this.sign(`${tenantId}.${exp}`)}`, expiresAt: new Date(exp) };
  }

  verifyPreview(tenantId: string, token: string | undefined) {
    if (!token) return false;
    const [exp, sig] = token.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    return safeEqual(sig, this.sign(`${tenantId}.${exp}`));
  }
}
