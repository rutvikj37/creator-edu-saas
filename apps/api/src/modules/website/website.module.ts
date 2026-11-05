import { Module } from '@nestjs/common';
import { BlogService } from './blog.service.js';
import { PublicSiteService } from './public-site.service.js';
import { CreatorBlogController, CreatorWebsiteController, PublicWebsiteController } from './website.controller.js';
import { WebsiteService } from './website.service.js';
import { WebsiteAiService } from './website-ai.service.js';
import { AiModule } from '../ai/ai.module.js';

@Module({
  imports: [AiModule],
  controllers: [CreatorWebsiteController, CreatorBlogController, PublicWebsiteController],
  providers: [WebsiteService, BlogService, PublicSiteService, WebsiteAiService],
  exports: [WebsiteService, BlogService, PublicSiteService],
})
export class WebsiteModule {}
