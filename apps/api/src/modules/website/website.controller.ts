import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { FEATURES, PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequireFeature, RequirePermissions, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { Paginated } from '../../common/interceptors/response-envelope.interceptor.js';
import type { AppRequest, AuthContext } from '../../core/tenancy/request-context.js';
import { apiOrigin } from '../files/files.controller.js';
import { BlogService } from './blog.service.js';
import { PublicSiteService } from './public-site.service.js';
import { WebsiteService } from './website.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class SettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() template?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() header?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsObject() footer?: Record<string, unknown>;
}
class ApplyTemplateDto {
  @ApiPropertyOptional({ description: 'Overwrite drafts of pages the template also defines' }) @IsOptional() @IsBoolean() replace?: boolean;
}
class CreatePageDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) title: string;
  @ApiProperty({ example: 'about' }) @Transform(trim) @IsString() @Length(1, 80) slug: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() draftBlocks?: unknown[];
}
class UpdatePageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @ApiPropertyOptional({ description: 'Full block list (validated per block type)' }) @IsOptional() @IsArray() draftBlocks?: unknown[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(70) seoTitle?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(170) seoDescription?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 25) ogImageFileId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showInNav?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) navOrder?: number;
}
class PublishDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) note?: string;
}
class PostDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) slug?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) excerpt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsObject() content?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 25) coverFileId?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() tags?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(70) seoTitle?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(170) seoDescription?: string | null;
}
class CreatePostDto extends PostDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) declare title: string;
}
class PostListQuery {
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED']) status?: 'DRAFT' | 'PUBLISHED';
}
class PublicListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

@ApiTags('Creator · Website')
@ApiBearerAuth()
@TenantScoped('workspace')
@RequireFeature(FEATURES.WEBSITE_BUILDER.key)
@Controller({ path: 'creator/website', version: '1' })
export class CreatorWebsiteController {
  constructor(private readonly website: WebsiteService) {}

  @Get() @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  @ApiOperation({ summary: 'Settings, templates and pages' })
  overview() { return this.website.overview(); }

  @Put('settings') @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  @ApiOperation({ summary: 'Template style, header links and footer' })
  settings(@Body() dto: SettingsDto, @CurrentAuth() auth: AuthContext) { return this.website.updateSettings(dto as never, auth.userId); }

  @Post('templates/:key/apply') @HttpCode(200) @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  @ApiOperation({ summary: 'Apply a template (creates starter pages from the academy’s own content)' })
  apply(@Param('key') key: string, @Body() dto: ApplyTemplateDto, @CurrentAuth() auth: AuthContext) { return this.website.applyTemplate(key, dto.replace === true, auth.userId); }

  @Post('preview-token') @HttpCode(200) @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  @ApiOperation({ summary: 'One-hour token to view drafts on the academy site (?preview=token)' })
  preview() { return this.website.previewToken(); }

  @Post('pages') @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  create(@Body() dto: CreatePageDto, @CurrentAuth() auth: AuthContext) { return this.website.create(dto, auth.userId); }

  @Get('pages/:id') @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  get(@Param('id') id: string, @Req() req: AppRequest) { return this.website.get(id, apiOrigin(req)); }

  @Patch('pages/:id') @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  @ApiOperation({ summary: 'Save the draft (blocks, title, address, SEO, navigation)' })
  update(@Param('id') id: string, @Body() dto: UpdatePageDto, @Req() req: AppRequest) { return this.website.update(id, dto, apiOrigin(req)); }

  @Post('pages/:id/publish') @HttpCode(200) @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  publish(@Param('id') id: string, @Body() dto: PublishDto, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) { return this.website.publish(id, dto.note ?? null, auth.userId, apiOrigin(req)); }

  @Post('pages/:id/unpublish') @HttpCode(200) @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  unpublish(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) { return this.website.unpublish(id, auth.userId, apiOrigin(req)); }

  @Get('pages/:id/versions') @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  versions(@Param('id') id: string) { return this.website.versions(id); }

  @Post('pages/:id/versions/:versionId/restore') @HttpCode(200) @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  restore(@Param('id') id: string, @Param('versionId') versionId: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) { return this.website.restore(id, versionId, auth.userId, apiOrigin(req)); }

  @Post('pages/:id/home') @HttpCode(200) @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  home(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.website.setHome(id, auth.userId); }

  @Delete('pages/:id') @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.website.remove(id, auth.userId); }
}

@ApiTags('Creator · Blog')
@ApiBearerAuth()
@TenantScoped('workspace')
@RequireFeature(FEATURES.WEBSITE_BUILDER.key)
@Controller({ path: 'creator/blog/posts', version: '1' })
export class CreatorBlogController {
  constructor(private readonly blog: BlogService) {}

  @Get() @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  list(@Query() q: PostListQuery, @Req() req: AppRequest) { return this.blog.list(apiOrigin(req), q.status); }

  @Post() @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  create(@Body() dto: CreatePostDto, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) { return this.blog.create(dto, auth.userId, apiOrigin(req)); }

  @Get(':id') @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  get(@Param('id') id: string, @Req() req: AppRequest) { return this.blog.get(id, apiOrigin(req)); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  update(@Param('id') id: string, @Body() dto: PostDto, @Req() req: AppRequest) { return this.blog.update(id, dto, apiOrigin(req)); }

  @Post(':id/publish') @HttpCode(200) @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  publish(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) { return this.blog.setPublished(id, true, auth.userId, apiOrigin(req)); }

  @Post(':id/unpublish') @HttpCode(200) @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  unpublish(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) { return this.blog.setPublished(id, false, auth.userId, apiOrigin(req)); }

  @Delete(':id') @RequirePermissions(PERMISSIONS.WEBSITE_MANAGE)
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.blog.remove(id, auth.userId); }
}

@ApiTags('Academy website (public)')
@Public()
@TenantScoped('academy')
@Controller({ path: 'public', version: '1' })
export class PublicWebsiteController {
  constructor(
    private readonly site: PublicSiteService,
    private readonly blog: BlogService,
  ) {}

  @Get('website/layout')
  @ApiOperation({ summary: 'Navigation, footer and template for the academy site' })
  layout(@Query('preview') preview?: string) { return this.site.layout(preview); }

  @Get('website/pages/home')
  home(@Req() req: AppRequest, @Query('preview') preview?: string) { return this.site.page(null, apiOrigin(req), preview); }

  @Get('website/pages/:slug')
  page(@Param('slug') slug: string, @Req() req: AppRequest, @Query('preview') preview?: string) { return this.site.page(slug.slice(0, 80), apiOrigin(req), preview); }

  @Get('blog')
  async posts(@Query() q: PublicListQuery, @Req() req: AppRequest) {
    const { items, meta } = await this.blog.publicList(apiOrigin(req), q.page ?? 1);
    return new Paginated(items, meta);
  }

  @Get('blog/:slug')
  post(@Param('slug') slug: string, @Req() req: AppRequest) { return this.blog.publicGet(slug.slice(0, 160), apiOrigin(req)); }
}
