import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { apiOrigin } from '../files/files.controller.js';
import { BundlesService } from './bundles.service.js';
import { CartService } from './cart.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class UpdateBundleDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) priceAmount?: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @Length(25, 25, { each: true }) courseIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) coverFileId?: string | null;
}
class CreateBundleDto extends UpdateBundleDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) declare title: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) declare priceAmount: number;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @Length(25, 25, { each: true }) declare courseIds: string[];
}
class BundleStatusDto {
  @ApiProperty({ enum: ['PUBLISHED', 'DRAFT', 'ARCHIVED'] }) @IsIn(['PUBLISHED', 'DRAFT', 'ARCHIVED']) status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED';
}
class CartAddDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) digitalProductId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) courseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) bundleId?: string;
}

@ApiTags('Creator · Bundles')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/bundles', version: '1' })
export class CreatorBundlesController {
  constructor(private readonly bundles: BundlesService) {}

  @Get() @RequirePermissions(PERMISSIONS.COURSES_READ)
  list(@Req() req: Request) { return this.bundles.list(apiOrigin(req)); }

  @Get(':id') @RequirePermissions(PERMISSIONS.COURSES_READ)
  get(@Param('id') id: string, @Req() req: Request) { return this.bundles.get(id, apiOrigin(req)); }

  @Post() @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  @ApiOperation({ summary: 'Create a draft bundle (2–30 courses, one price)' })
  create(@Body() dto: CreateBundleDto, @CurrentAuth() auth: AuthContext, @Req() req: Request) { return this.bundles.create(dto, auth.userId, apiOrigin(req)); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateBundleDto, @CurrentAuth() auth: AuthContext, @Req() req: Request) { return this.bundles.update(id, dto, auth.userId, apiOrigin(req)); }

  @Post(':id/status') @HttpCode(200) @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  @ApiOperation({ summary: 'Publish (all courses published, price set), unpublish or archive' })
  status(@Param('id') id: string, @Body() dto: BundleStatusDto, @CurrentAuth() auth: AuthContext, @Req() req: Request) { return this.bundles.setStatus(id, dto.status, auth.userId, apiOrigin(req)); }
}

@ApiTags('Academy (public) · Bundles')
@Public()
@TenantScoped('academy')
@Controller({ path: 'public/bundles', version: '1' })
export class PublicBundlesController {
  constructor(private readonly bundles: BundlesService) {}

  @Get()
  list(@Req() req: Request) { return this.bundles.publicList(apiOrigin(req)); }

  @Get(':slug')
  get(@Param('slug') slug: string, @Req() req: Request) { return this.bundles.publicGet(slug, apiOrigin(req)); }
}

@ApiTags('Student · Cart')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'learn/cart', version: '1' })
export class LearnCartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext) { return this.cart.get(auth.userId); }

  @Post('items') @HttpCode(200)
  @ApiOperation({ summary: 'Add a paid course or a bundle (checked like checkout)' })
  add(@Body() dto: CartAddDto, @CurrentAuth() auth: AuthContext) { return this.cart.add(auth.userId, dto); }

  @Delete('items/:id')
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.cart.remove(auth.userId, id); }

  @Delete()
  clear(@CurrentAuth() auth: AuthContext) { return this.cart.clear(auth.userId); }
}
