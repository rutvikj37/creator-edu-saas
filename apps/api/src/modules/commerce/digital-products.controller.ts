import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { apiOrigin } from '../files/files.controller.js';
import { DigitalProductsService } from './digital-products.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class ProductFileDto {
  @ApiPropertyOptional({ description: 'Existing file row to keep' }) @IsOptional() @IsString() @Length(25, 25) id?: string;
  @ApiPropertyOptional({ description: 'Uploaded file (purpose PRODUCT_FILE) to add' }) @IsOptional() @IsString() @Length(25, 25) fileAssetId?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) title: string;
}
class UpdateProductDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  @ApiPropertyOptional({ description: '0 = free' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) priceAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) compareAtAmount?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) coverFileId?: string | null;
  @ApiPropertyOptional({ description: 'Downloads per buyer per file; null = unlimited' }) @IsOptional() @IsInt() @Min(1) downloadLimit?: number | null;
  @ApiPropertyOptional({ type: [ProductFileDto] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ProductFileDto) files?: ProductFileDto[];
}
class CreateProductDto extends UpdateProductDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) declare title: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) declare priceAmount: number;
}
class ProductStatusDto {
  @ApiProperty({ enum: ['PUBLISHED', 'DRAFT', 'ARCHIVED'] }) @IsIn(['PUBLISHED', 'DRAFT', 'ARCHIVED']) status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED';
}

@ApiTags('Creator · Digital products')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/products', version: '1' })
export class CreatorProductsController {
  constructor(private readonly products: DigitalProductsService) {}

  @Get() @RequirePermissions(PERMISSIONS.COURSES_READ)
  list(@Req() req: Request) { return this.products.list(apiOrigin(req)); }

  @Get(':id') @RequirePermissions(PERMISSIONS.COURSES_READ)
  get(@Param('id') id: string, @Req() req: Request) { return this.products.get(id, apiOrigin(req)); }

  @Get(':id/buyers') @RequirePermissions(PERMISSIONS.ORDERS_READ)
  buyers(@Param('id') id: string) { return this.products.buyers(id); }

  @Post() @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  create(@Body() dto: CreateProductDto, @CurrentAuth() auth: AuthContext, @Req() req: Request) { return this.products.create(dto, auth.userId, apiOrigin(req)); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentAuth() auth: AuthContext, @Req() req: Request) { return this.products.update(id, dto, auth.userId, apiOrigin(req)); }

  @Post(':id/status') @HttpCode(200) @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  status(@Param('id') id: string, @Body() dto: ProductStatusDto, @CurrentAuth() auth: AuthContext, @Req() req: Request) { return this.products.setStatus(id, dto.status, auth.userId, apiOrigin(req)); }
}

@ApiTags('Academy (public) · Digital products')
@Public()
@TenantScoped('academy')
@Controller({ path: 'public/products', version: '1' })
export class PublicProductsController {
  constructor(private readonly products: DigitalProductsService) {}

  @Get()
  list(@Req() req: Request) { return this.products.publicList(apiOrigin(req)); }

  @Get(':slug')
  get(@Param('slug') slug: string, @Req() req: Request) { return this.products.publicGet(slug, apiOrigin(req)); }
}

@ApiTags('Student · Downloads')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'learn/products', version: '1' })
export class LearnProductsController {
  constructor(private readonly products: DigitalProductsService) {}

  @Get()
  @ApiOperation({ summary: 'Products I own, with files and remaining downloads' })
  mine(@CurrentAuth() auth: AuthContext, @Req() req: Request) { return this.products.mine(auth.userId, apiOrigin(req)); }

  @Post(':id/claim') @HttpCode(200)
  @ApiOperation({ summary: 'Get a free product' })
  claim(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.products.claimFree(auth.userId, id); }

  @Post(':id/files/:fileId/download') @HttpCode(200)
  @ApiOperation({ summary: 'Short-lived download link (access and download limit checked; download logged)' })
  download(@Param('id') id: string, @Param('fileId') fileId: string, @CurrentAuth() auth: AuthContext, @Req() req: Request) { return this.products.download(auth.userId, id, fileId, apiOrigin(req)); }
}
