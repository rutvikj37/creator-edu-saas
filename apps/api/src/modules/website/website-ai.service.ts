import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { AiService, type LandingInput } from '../ai/ai.service.js';
import { parseBlocks } from './blocks.js';
import { WebsiteService } from './website.service.js';

/**
 * AI landing page: generates the home page from the academy's profile, courses and industry and
 * saves it as a DRAFT (never published automatically). An existing draft is kept as a version so
 * it can be restored.
 */
@Injectable()
export class WebsiteAiService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly ctx: TenantContext,
    private readonly ai: AiService,
    private readonly website: WebsiteService,
    private readonly audit: AuditService,
  ) {}

  async generateLanding(input: LandingInput, actorUserId: string, apiOrigin: string) {
    const out = await this.ai.landingPage(actorUserId, input);
    const { blocks, errors } = parseBlocks(out.blocks);
    if (errors.length) throw new AppException(ERROR_CODES.INTERNAL, 'The AI reply could not be turned into a page. Please try again.', HttpStatus.BAD_GATEWAY);
    let home = await this.db.sitePage.findFirst({ where: { isHome: true } });
    if (home && Array.isArray(home.draftBlocks) && (home.draftBlocks as unknown[]).length) {
      await this.db.sitePageVersion.create({ data: { pageId: home.id, title: home.title, blocks: home.draftBlocks as never, note: 'Draft before AI generation', createdById: actorUserId } as never });
    }
    if (!home) {
      const slugTaken = await this.db.sitePage.findFirst({ where: { slug: 'home' } });
      const created = await this.website.create({ title: 'Home', slug: slugTaken ? `home-${Date.now().toString(36)}` : 'home', draftBlocks: [] }, actorUserId);
      home = await this.db.sitePage.findFirst({ where: { id: created.id } });
      if (!home!.isHome) await this.website.setHome(home!.id, actorUserId);
    }
    const page = await this.website.update(home!.id, { draftBlocks: blocks, seoTitle: out.seoTitle || null, seoDescription: out.seoDescription || null }, apiOrigin);
    await this.audit.record({ action: 'website.ai_landing', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'SitePage', targetId: home!.id, after: { industry: input.industry, language: input.language ?? 'en', blocks: blocks.length, credits: out.credits } });
    return { page, credits: out.credits };
  }
}
