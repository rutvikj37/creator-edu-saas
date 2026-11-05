import { Module } from '@nestjs/common';
import { BlogService } from './blog.service.js';
import { PublicSiteService } from './public-site.service.js';
import { CreatorBlogController, CreatorWebsiteController, PublicWebsiteController } from './website.controller.js';
import { WebsiteService } from './website.service.js';

@Module({
  controllers: [CreatorWebsiteController, CreatorBlogController, PublicWebsiteController],
  providers: [WebsiteService, BlogService, PublicSiteService],
  exports: [WebsiteService, BlogService, PublicSiteService],
})
export class WebsiteModule {}
