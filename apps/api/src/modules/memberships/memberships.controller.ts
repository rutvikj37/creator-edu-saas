import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Type } from 'class-transformer';
import { IsBoolean, ValidateNested } from 'class-validator';
import { apiOrigin } from '../files/files.controller.js';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { MembershipsService } from './memberships.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
class FaqDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 300) question: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 2000) answer: string;
}
class PlanDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10_000_000) priceAmount?: number;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsIn(['MONTH', 'YEAR']) interval?: 'MONTH' | 'YEAR';
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) courseIds?: string[];
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'ARCHIVED']) status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10_000_000) compareAtAmount?: number | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) planName?: string | null;
  @IsOptional() @IsString() @Length(25, 25) coverFileId?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) buttonText?: string | null;
  @IsOptional() @IsBoolean() lifetime?: boolean;
  @IsOptional() @IsBoolean() taxExclusive?: boolean | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => FaqDto) faqs?: FaqDto[];
}
/** Name only → a draft for the step-by-step builder; with price, interval and courses → on sale at once. */
class CreatePlanDto extends PlanDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) declare name: string;
}

@ApiTags('Creator · Memberships')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/memberships', version: '1' })
export class CreatorMembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get() @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  list(@Req() req: Request) { return this.memberships.list(apiOrigin(req)); }

  @Get('stats') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  stats() { return this.memberships.stats(); }

  @Get(':id') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  get(@Param('id') id: string, @Req() req: Request) { return this.memberships.get(id, apiOrigin(req)); }

  @Post() @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  create(@Body() dto: CreatePlanDto, @CurrentAuth() auth: AuthContext, @Req() req: Request) { return this.memberships.create(dto, auth.userId, apiOrigin(req)); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  update(@Param('id') id: string, @Body() dto: PlanDto, @CurrentAuth() auth: AuthContext, @Req() req: Request) { return this.memberships.update(id, dto, auth.userId, apiOrigin(req)); }

  @Get(':id/members') @RequirePermissions(PERMISSIONS.STUDENTS_READ)
  members(@Param('id') id: string) { return this.memberships.members(id); }
}

@ApiTags('Memberships')
@Controller({ version: '1' })
export class MembershipsPublicController {
  constructor(private readonly memberships: MembershipsService) {}

  @Public() @TenantScoped('academy') @Get('public/memberships')
  plans(@Req() req: Request) { return this.memberships.publicPlans(apiOrigin(req)); }

  @ApiBearerAuth() @RequireRealm('TENANT') @TenantScoped('academy') @Get('learn/memberships')
  mine(@CurrentAuth() auth: AuthContext) { return this.memberships.mine(auth.userId); }
}
