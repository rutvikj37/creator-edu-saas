import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { CommunitiesService } from './communities.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
class CommunityDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsIn(['ALL_STUDENTS', 'COURSE', 'MEMBERSHIP']) access?: 'ALL_STUDENTS' | 'COURSE' | 'MEMBERSHIP';
  @IsOptional() @IsString() @Length(25, 25) courseId?: string | null;
  @IsOptional() @IsString() @Length(25, 25) membershipPlanId?: string | null;
  @IsOptional() @IsBoolean() staffOnlyPosts?: boolean;
}
class CreateCommunityDto extends CommunityDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) declare name: string;
  @ApiProperty({ enum: ['ALL_STUDENTS', 'COURSE', 'MEMBERSHIP'] }) @IsIn(['ALL_STUDENTS', 'COURSE', 'MEMBERSHIP']) declare access: 'ALL_STUDENTS' | 'COURSE' | 'MEMBERSHIP';
}
class PostDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) title?: string | null;
  @ApiProperty() @IsString() @Length(1, 5000) body: string;
}
class CommentDto {
  @ApiProperty() @IsString() @Length(1, 2000) body: string;
}
class ReportDto {
  @IsOptional() @IsString() @Length(25, 25) postId?: string;
  @IsOptional() @IsString() @Length(25, 25) commentId?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 300) reason: string;
}
class ModerateDto {
  @ApiProperty({ enum: ['pin', 'unpin', 'lock', 'unlock', 'hide', 'unhide'] }) @IsIn(['pin', 'unpin', 'lock', 'unlock', 'hide', 'unhide']) action: 'pin' | 'unpin' | 'lock' | 'unlock' | 'hide' | 'unhide';
}
class HideDto {
  @ApiProperty() @IsBoolean() hidden: boolean;
}

const staff = (auth: AuthContext) => ({ userId: auth.userId, staff: true });
const student = (auth: AuthContext) => ({ userId: auth.userId, staff: false });

@ApiTags('Creator · Communities')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/communities', version: '1' })
export class CreatorCommunitiesController {
  constructor(private readonly communities: CommunitiesService) {}

  @Get() @RequirePermissions(PERMISSIONS.COMMUNITY_MANAGE)
  list() { return this.communities.listAll(); }

  @Post() @RequirePermissions(PERMISSIONS.COMMUNITY_MANAGE)
  create(@Body() dto: CreateCommunityDto, @CurrentAuth() auth: AuthContext) { return this.communities.create(dto, auth.userId); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.COMMUNITY_MANAGE)
  update(@Param('id') id: string, @Body() dto: CommunityDto, @CurrentAuth() auth: AuthContext) { return this.communities.update(id, dto, auth.userId); }

  @Post(':id/archive') @HttpCode(200) @RequirePermissions(PERMISSIONS.COMMUNITY_MANAGE)
  archive(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.communities.archive(id, auth.userId); }

  @Get(':id/posts') @RequirePermissions(PERMISSIONS.COMMUNITY_MANAGE)
  posts(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @Query('cursor') cursor?: string) { return this.communities.posts(id, staff(auth), cursor?.slice(0, 25)); }

  @Post(':id/posts') @RequirePermissions(PERMISSIONS.COMMUNITY_MANAGE)
  createPost(@Param('id') id: string, @Body() dto: PostDto, @CurrentAuth() auth: AuthContext) { return this.communities.createPost(id, staff(auth), dto); }

  @Get('posts/:postId') @RequirePermissions(PERMISSIONS.COMMUNITY_MANAGE)
  post(@Param('postId') postId: string, @CurrentAuth() auth: AuthContext) { return this.communities.post(postId, staff(auth)); }

  @Post('posts/:postId/comments') @RequirePermissions(PERMISSIONS.COMMUNITY_MANAGE)
  comment(@Param('postId') postId: string, @Body() dto: CommentDto, @CurrentAuth() auth: AuthContext) { return this.communities.comment(postId, staff(auth), dto.body); }

  @Post('posts/:postId/moderate') @HttpCode(200) @RequirePermissions(PERMISSIONS.COMMUNITY_MANAGE)
  moderate(@Param('postId') postId: string, @Body() dto: ModerateDto, @CurrentAuth() auth: AuthContext) { return this.communities.moderatePost(postId, dto.action, auth.userId); }

  @Delete('posts/:postId') @RequirePermissions(PERMISSIONS.COMMUNITY_MANAGE)
  deletePost(@Param('postId') postId: string, @CurrentAuth() auth: AuthContext) { return this.communities.deleteOwnPost(postId, staff(auth)); }

  @Post('comments/:commentId/hide') @HttpCode(200) @RequirePermissions(PERMISSIONS.COMMUNITY_MANAGE)
  hide(@Param('commentId') commentId: string, @Body() dto: HideDto, @CurrentAuth() auth: AuthContext) { return this.communities.hideComment(commentId, dto.hidden, auth.userId); }

  @Get('reports') @RequirePermissions(PERMISSIONS.COMMUNITY_MANAGE)
  reports() { return this.communities.reports(); }

  @Post('reports/:reportId/resolve') @HttpCode(200) @RequirePermissions(PERMISSIONS.COMMUNITY_MANAGE)
  resolve(@Param('reportId') reportId: string) { return this.communities.resolveReport(reportId); }
}

@ApiTags('Student · Communities')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'learn/communities', version: '1' })
export class LearnCommunitiesController {
  constructor(private readonly communities: CommunitiesService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext) { return this.communities.accessibleFor(student(auth)); }

  @Get(':id/posts')
  posts(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @Query('cursor') cursor?: string) { return this.communities.posts(id, student(auth), cursor?.slice(0, 25)); }

  @Post(':id/posts')
  createPost(@Param('id') id: string, @Body() dto: PostDto, @CurrentAuth() auth: AuthContext) { return this.communities.createPost(id, student(auth), dto); }

  @Get('posts/:postId')
  post(@Param('postId') postId: string, @CurrentAuth() auth: AuthContext) { return this.communities.post(postId, student(auth)); }

  @Post('posts/:postId/comments')
  comment(@Param('postId') postId: string, @Body() dto: CommentDto, @CurrentAuth() auth: AuthContext) { return this.communities.comment(postId, student(auth), dto.body); }

  @Post('posts/:postId/like') @HttpCode(200)
  like(@Param('postId') postId: string, @CurrentAuth() auth: AuthContext) { return this.communities.like(postId, student(auth)); }

  @Delete('posts/:postId')
  deletePost(@Param('postId') postId: string, @CurrentAuth() auth: AuthContext) { return this.communities.deleteOwnPost(postId, student(auth)); }

  @Delete('comments/:commentId')
  deleteComment(@Param('commentId') commentId: string, @CurrentAuth() auth: AuthContext) { return this.communities.deleteOwnComment(commentId, student(auth)); }

  @Post('reports') @HttpCode(200)
  report(@Body() dto: ReportDto, @CurrentAuth() auth: AuthContext) { return this.communities.report(student(auth), dto); }
}
