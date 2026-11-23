import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Matches, Max, Min, ValidateNested } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AcademySecurityService } from '../../core/security/academy-security.service.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';

class PdfWatermarkDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ example: '#100F0F' }) @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) color?: string;
  @ApiPropertyOptional({ description: 'Put a learner code in the middle of every page' }) @IsOptional() @IsBoolean() fixedPosition?: boolean;
}
class VideoWatermarkDto {
  @ApiPropertyOptional({ enum: ['off', 'static', 'dynamic'] }) @IsOptional() @IsIn(['off', 'static', 'dynamic']) mode?: 'off' | 'static' | 'dynamic';
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(600) showForSec?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(3600) everySec?: number;
}
class SecurityDto {
  @ApiPropertyOptional({ description: 'Devices a learner can be signed in on at once; 0 = no limit' }) @IsOptional() @IsInt() @Min(0) @Max(20) deviceLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() teamTwoFactor?: boolean;
  @ApiPropertyOptional({ type: PdfWatermarkDto }) @IsOptional() @ValidateNested() @Type(() => PdfWatermarkDto) pdfWatermark?: PdfWatermarkDto;
  @ApiPropertyOptional({ type: VideoWatermarkDto }) @IsOptional() @ValidateNested() @Type(() => VideoWatermarkDto) videoWatermark?: VideoWatermarkDto;
}

@ApiTags('Creator · Settings')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/settings/security', version: '1' })
export class CreatorSecurityController {
  constructor(private readonly security: AcademySecurityService, private readonly ctx: TenantContext, private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get() @RequirePermissions(PERMISSIONS.ACADEMY_MANAGE)
  get() { return this.security.get(this.ctx.requireTenantId()); }

  @Put() @RequirePermissions(PERMISSIONS.ACADEMY_MANAGE) @ApiOperation({ summary: 'Device limit, team 2FA and watermarks' })
  async save(@Body() dto: SecurityDto, @CurrentAuth() auth: AuthContext) {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { twoFactorEnabledAt: true } });
    const out = await this.security.save(this.ctx.requireTenantId(), dto as never, { twoFactorEnabled: Boolean(me.twoFactorEnabledAt) });
    await this.audit.record({ action: 'academy.security_update', tenantId: this.ctx.tenantId, actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'TenantSetting', after: dto as never });
    return out;
  }
}

@ApiTags('Student · Security')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'learn/watermark', version: '1' })
export class LearnWatermarkController {
  constructor(private readonly security: AcademySecurityService, private readonly ctx: TenantContext, private readonly prisma: PrismaService) {}

  @Get() @ApiOperation({ summary: 'Video/live watermark settings and the text to show for me' })
  async get(@CurrentAuth() auth: AuthContext) {
    const { videoWatermark } = await this.security.get(this.ctx.requireTenantId());
    if (videoWatermark.mode === 'off') return { mode: 'off' as const };
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { email: true, phone: true } });
    return { ...videoWatermark, text: [u.email, u.phone].filter(Boolean).join(' · ') };
  }
}
