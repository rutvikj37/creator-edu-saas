import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { ReviewsService } from './reviews.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class ReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) rating: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) title?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) body?: string | null;
}
class ReplyDto {
  @ApiPropertyOptional({ description: 'Empty removes the reply' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) reply?: string | null;
}
class ReviewStatusDto {
  @ApiProperty({ enum: ['PUBLISHED', 'HIDDEN'] }) @IsIn(['PUBLISHED', 'HIDDEN']) status: 'PUBLISHED' | 'HIDDEN';
  @ApiPropertyOptional({ description: 'Required when hiding; shown to the author' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(200) reason?: string | null;
}
class PublicReviewsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number;
}
class CreatorReviewsQuery extends PublicReviewsQuery {
  @IsOptional() @IsString() @Length(25, 25) courseId?: string;
  @IsOptional() @IsIn(['PUBLISHED', 'HIDDEN', 'UNANSWERED']) status?: string;
}

@ApiTags('Student · Reviews')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'learn/courses/:courseId/review', version: '1' })
export class LearnReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  mine(@Param('courseId') courseId: string, @CurrentAuth() auth: AuthContext) { return this.reviews.mine(auth.userId, courseId); }

  @Put()
  @ApiOperation({ summary: 'Rate and review a course you have access to (creates or updates your review)' })
  save(@Param('courseId') courseId: string, @Body() dto: ReviewDto, @CurrentAuth() auth: AuthContext) { return this.reviews.upsert(auth.userId, courseId, dto); }

  @Delete()
  remove(@Param('courseId') courseId: string, @CurrentAuth() auth: AuthContext) { return this.reviews.remove(auth.userId, courseId); }
}

@ApiTags('Academy (public) · Catalog')
@Public()
@TenantScoped('academy')
@Controller({ path: 'public/courses/:slug/reviews', version: '1' })
export class PublicReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'Published reviews with the rating summary' })
  list(@Param('slug') slug: string, @Query() q: PublicReviewsQuery) { return this.reviews.publicList(slug, q); }
}

@ApiTags('Creator · Reviews')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/reviews', version: '1' })
export class CreatorReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get() @RequirePermissions(PERMISSIONS.COURSES_READ)
  list(@Query() q: CreatorReviewsQuery) { return this.reviews.list(q); }

  @Post(':id/reply') @HttpCode(200) @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  reply(@Param('id') id: string, @Body() dto: ReplyDto, @CurrentAuth() auth: AuthContext) { return this.reviews.reply(id, dto.reply ?? null, auth.userId); }

  @Post(':id/status') @HttpCode(200) @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  @ApiOperation({ summary: 'Hide (with a reason the author sees) or re-publish a review' })
  status(@Param('id') id: string, @Body() dto: ReviewStatusDto, @CurrentAuth() auth: AuthContext) { return this.reviews.setStatus(id, dto.status, dto.reason ?? null, auth.userId); }
}
