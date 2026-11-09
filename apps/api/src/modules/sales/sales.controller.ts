import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { RecoveryService } from '../commerce/recovery.service.js';
import { SalesService } from './sales.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const ITEM_KINDS = ['course', 'bundle', 'product', 'webinar', 'membership'];

class OfferDto {
  @ApiProperty({ enum: ['BUMP', 'UPSELL'] }) @IsIn(['BUMP', 'UPSELL']) type: 'BUMP' | 'UPSELL';
  @ApiPropertyOptional({ enum: ['ACTIVE', 'PAUSED'] }) @IsOptional() @IsIn(['ACTIVE', 'PAUSED']) status?: 'ACTIVE' | 'PAUSED';
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) name: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 160) headline: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @ApiProperty({ enum: ['course', 'bundle', 'product'] }) @IsIn(['course', 'bundle', 'product']) itemKind: string;
  @ApiProperty() @IsString() @Length(25, 25) itemId: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) priceAmount: number;
  @ApiPropertyOptional({ description: '"kind:id" purchases that show the offer; empty = any purchase', type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @Matches(/^(course|bundle|product|webinar|membership):[a-z0-9]{25}$/, { each: true }) triggers?: string[] | null;
  @ApiPropertyOptional({ description: 'Upsells: minutes after payment the offer stays open' }) @IsOptional() @IsInt() @Min(5) @Max(10080) windowMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}

class OfferStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'PAUSED', 'ARCHIVED'] }) @IsIn(['ACTIVE', 'PAUSED', 'ARCHIVED']) status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
}

class LinkDto {
  @ApiPropertyOptional({ description: 'Leave empty to generate one' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(16) code?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) title: string;
  @ApiProperty({ enum: ITEM_KINDS }) @IsIn(ITEM_KINDS) itemKind: string;
  @ApiProperty() @IsString() @Length(25, 25) itemId: string;
  @ApiPropertyOptional({ description: 'Custom price; null = the item’s price' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) priceAmount?: number | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(40) couponCode?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowCoupons?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1_000_000) maxUses?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

class RecoveryDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
  @ApiProperty({ description: 'Minutes after checkout for each reminder (1–3)', type: [Number] }) @IsArray() @ArrayMaxSize(3) @IsInt({ each: true }) steps: number[];
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(40) couponCode?: string | null;
  @ApiProperty() @IsBoolean() whatsapp: boolean;
}

class TrackingDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(40) metaPixelId?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(40) ga4Id?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(40) gtmId?: string | null;
}

@ApiTags('Creator · Sales funnels')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/sales', version: '1' })
export class CreatorSalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly recovery: RecoveryService,
  ) {}

  @Get('items') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  @ApiOperation({ summary: 'Everything on sale, for offer and link pickers' })
  items() { return this.sales.items(); }

  @Get('offers') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  @ApiOperation({ summary: 'Order bumps and upsells with results' })
  offers(@Query('type') type?: string) { return this.sales.listOffers(type === 'BUMP' || type === 'UPSELL' ? type : undefined); }

  @Post('offers') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  createOffer(@Body() dto: OfferDto, @CurrentAuth() auth: AuthContext) { return this.sales.createOffer(dto, auth.userId); }

  @Put('offers/:id') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  updateOffer(@Param('id') id: string, @Body() dto: OfferDto, @CurrentAuth() auth: AuthContext) { return this.sales.updateOffer(id, dto, auth.userId); }

  @Post('offers/:id/status') @HttpCode(200) @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  offerStatus(@Param('id') id: string, @Body() dto: OfferStatusDto) { return this.sales.setOfferStatus(id, dto.status); }

  @Delete('offers/:id') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  removeOffer(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.sales.removeOffer(id, auth.userId); }

  @Get('links') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  @ApiOperation({ summary: 'Shareable payment links with uses and revenue' })
  links() { return this.sales.listLinks(); }

  @Post('links') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  createLink(@Body() dto: LinkDto, @CurrentAuth() auth: AuthContext) { return this.sales.createLink(dto, auth.userId); }

  @Put('links/:id') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  updateLink(@Param('id') id: string, @Body() dto: LinkDto, @CurrentAuth() auth: AuthContext) { return this.sales.updateLink(id, dto, auth.userId); }

  @Delete('links/:id') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  removeLink(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.sales.removeLink(id, auth.userId); }

  @Get('recovery') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  @ApiOperation({ summary: 'Abandoned-checkout reminder settings' })
  recoverySettings() { return this.recovery.settings(); }

  @Put('recovery') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  saveRecovery(@Body() dto: RecoveryDto) { return this.recovery.saveSettings({ ...dto, couponCode: dto.couponCode || null }); }

  @Get('recovery/stats') @RequirePermissions(PERMISSIONS.ORDERS_READ)
  @ApiOperation({ summary: 'Abandoned, reminded and recovered checkouts over the last 30 days' })
  recoveryStats() { return this.recovery.stats(); }

  @Get('recovery/recent') @RequirePermissions(PERMISSIONS.ORDERS_READ)
  recoveryRecent() { return this.recovery.recent(); }

  @Get('tracking') @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  @ApiOperation({ summary: 'Meta Pixel, Google Analytics 4 and Tag Manager IDs for the academy site' })
  tracking() { return this.sales.tracking(); }

  @Put('tracking') @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  saveTracking(@Body() dto: TrackingDto, @CurrentAuth() auth: AuthContext) { return this.sales.saveTracking(dto, auth.userId); }
}

@ApiTags('Academy (public) · Payment links')
@Public()
@TenantScoped('academy')
@Controller({ path: 'public/pay', version: '1' })
export class PublicPaymentLinksController {
  constructor(private readonly sales: SalesService) {}

  @Get(':code')
  @ApiOperation({ summary: 'A payment link: what it sells and for how much' })
  get(@Param('code') code: string) { return this.sales.publicLink(code); }
}
