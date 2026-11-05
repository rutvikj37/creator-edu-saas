import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { FEATURES, PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequireFeature, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { AffiliatesService } from './affiliates.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
class ProgramDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(90) defaultPercent?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) cookieDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(90) holdDays?: number;
  @IsOptional() @IsBoolean() autoApprove?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) terms?: string | null;
}
class AffiliateUpdateDto {
  @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED']) status?: 'ACTIVE' | 'SUSPENDED';
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(90) commissionPercent?: number;
}
class PayoutDto {
  @ApiProperty({ description: 'UTR / transaction reference' }) @Transform(trim) @IsString() @Length(3, 191) payoutRef: string;
}
class JoinDto {
  @ApiPropertyOptional({ description: 'UPI id or bank details for payouts' }) @IsOptional() @IsString() @MaxLength(500) payoutDetails?: string | null;
  @ApiProperty({ description: 'Accepted the program terms' }) @IsBoolean() acceptTerms: boolean;
}
class PayoutDetailsDto {
  @IsOptional() @IsString() @MaxLength(500) payoutDetails?: string | null;
}
class ClickDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 32) code: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) path?: string;
}

@ApiTags('Creator · Affiliates')
@ApiBearerAuth()
@TenantScoped('workspace')
@RequireFeature(FEATURES.AFFILIATES.key)
@Controller({ path: 'creator/affiliates', version: '1' })
export class CreatorAffiliatesController {
  constructor(private readonly affiliates: AffiliatesService) {}

  @Get('program') @RequirePermissions(PERMISSIONS.AFFILIATES_MANAGE)
  program() { return this.affiliates.program(); }

  @Put('program') @RequirePermissions(PERMISSIONS.AFFILIATES_MANAGE)
  save(@Body() dto: ProgramDto, @CurrentAuth() auth: AuthContext) { return this.affiliates.saveProgram(dto, auth.userId); }

  @Get() @RequirePermissions(PERMISSIONS.AFFILIATES_MANAGE)
  list() { return this.affiliates.list(); }

  @Get('conversions') @RequirePermissions(PERMISSIONS.AFFILIATES_MANAGE)
  conversions(@Query('affiliateId') affiliateId?: string, @Query('status') status?: string) { return this.affiliates.conversions({ affiliateId: affiliateId?.slice(0, 25), status: status?.slice(0, 16) }); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.AFFILIATES_MANAGE)
  update(@Param('id') id: string, @Body() dto: AffiliateUpdateDto, @CurrentAuth() auth: AuthContext) { return this.affiliates.updateAffiliate(id, dto, auth.userId); }

  @Post(':id/payouts') @HttpCode(200) @RequirePermissions(PERMISSIONS.AFFILIATES_MANAGE)
  pay(@Param('id') id: string, @Body() dto: PayoutDto, @CurrentAuth() auth: AuthContext) { return this.affiliates.markPaid(id, dto.payoutRef, auth.userId); }
}

@ApiTags('Student · Affiliate')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'learn/affiliate', version: '1' })
export class LearnAffiliateController {
  constructor(private readonly affiliates: AffiliatesService) {}

  @Get()
  me(@CurrentAuth() auth: AuthContext) { return this.affiliates.me(auth.userId); }

  @Post('join') @HttpCode(200)
  join(@Body() dto: JoinDto, @CurrentAuth() auth: AuthContext) {
    if (!dto.acceptTerms) return this.affiliates.me(auth.userId);
    return this.affiliates.join(auth.userId, dto.payoutDetails);
  }

  @Put('payout-details')
  payout(@Body() dto: PayoutDetailsDto, @CurrentAuth() auth: AuthContext) { return this.affiliates.updatePayoutDetails(auth.userId, dto.payoutDetails ?? null); }
}

@ApiTags('Affiliates (public)')
@Public()
@TenantScoped('academy')
@Controller({ path: 'public/affiliates', version: '1' })
export class PublicAffiliatesController {
  constructor(private readonly affiliates: AffiliatesService) {}

  @Post('click') @HttpCode(200)
  click(@Body() dto: ClickDto, @Req() req: Request) { return this.affiliates.click(dto.code, dto.path ?? '/', req.ip); }
}
