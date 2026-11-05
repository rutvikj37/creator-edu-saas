import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { MembershipsService } from './memberships.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
class PlanDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10_000_000) priceAmount?: number;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsIn(['MONTH', 'YEAR']) interval?: 'MONTH' | 'YEAR';
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) courseIds?: string[];
  @IsOptional() @IsIn(['ACTIVE', 'ARCHIVED']) status?: 'ACTIVE' | 'ARCHIVED';
}
class CreatePlanDto extends PlanDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) declare name: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) declare priceAmount: number;
  @ApiProperty({ enum: ['MONTH', 'YEAR'] }) @IsIn(['MONTH', 'YEAR']) declare interval: 'MONTH' | 'YEAR';
  @ApiProperty({ type: [String] }) @IsArray() declare courseIds: string[];
}

@ApiTags('Creator · Memberships')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/memberships', version: '1' })
export class CreatorMembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get() @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  list() { return this.memberships.list(); }

  @Post() @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  create(@Body() dto: CreatePlanDto, @CurrentAuth() auth: AuthContext) { return this.memberships.create(dto, auth.userId); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  update(@Param('id') id: string, @Body() dto: PlanDto, @CurrentAuth() auth: AuthContext) { return this.memberships.update(id, dto, auth.userId); }

  @Get(':id/members') @RequirePermissions(PERMISSIONS.STUDENTS_READ)
  members(@Param('id') id: string) { return this.memberships.members(id); }
}

@ApiTags('Memberships')
@Controller({ version: '1' })
export class MembershipsPublicController {
  constructor(private readonly memberships: MembershipsService) {}

  @Public() @TenantScoped('academy') @Get('public/memberships')
  plans() { return this.memberships.publicPlans(); }

  @ApiBearerAuth() @RequireRealm('TENANT') @TenantScoped('academy') @Get('learn/memberships')
  mine(@CurrentAuth() auth: AuthContext) { return this.memberships.mine(auth.userId); }
}
