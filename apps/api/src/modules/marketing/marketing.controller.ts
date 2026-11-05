import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Request, Response } from 'express';
import { FEATURES, PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequireFeature, RequirePermissions, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { escapeHtml } from '../../core/mail/templates.js';
import { Paginated } from '../../common/interceptors/response-envelope.interceptor.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { CampaignsService } from './campaigns.service.js';
import { LeadsService } from './leads.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class LeadQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(40) tag?: string;
  @IsOptional() @IsIn(['yes', 'no']) consent?: 'yes' | 'no';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
class LeadUpdateDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
}
class ImportRowDto {
  @IsString() @MaxLength(191) email: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
}
class ImportDto {
  @ApiProperty({ type: [ImportRowDto] }) @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => ImportRowDto) rows: ImportRowDto[];
  @ApiProperty({ description: 'I confirm these contacts agreed to receive marketing email from me' }) @IsBoolean() consentConfirmed: boolean;
}
class CampaignDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(200) previewText?: string | null;
  @IsOptional() @IsObject() content?: unknown;
  @IsOptional() @IsObject() segment?: any;
}
class CreateCampaignDto extends CampaignDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) declare name: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) declare subject: string;
}
class ScheduleDto {
  @ApiPropertyOptional({ description: 'Omit to send now' }) @IsOptional() @IsDateString() at?: string;
}
class LeadFormDto {
  @ApiProperty() @Transform(trim) @IsEmail() email: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiProperty({ description: 'Explicit opt-in to marketing email' }) @IsBoolean() consent: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) source?: string;
  @ApiPropertyOptional({ description: 'Honeypot — must be empty' }) @IsOptional() @IsString() @MaxLength(200) website?: string;
}

@ApiTags('Creator · Contacts')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/leads', version: '1' })
export class CreatorLeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get() @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  async list(@Query() q: LeadQuery) {
    const { items, meta } = await this.leads.list(q);
    return new Paginated(items, meta);
  }

  @Post('import') @HttpCode(200) @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  @ApiOperation({ summary: 'Import contacts; consent only when confirmed by the creator' })
  import(@Body() dto: ImportDto, @CurrentAuth() auth: AuthContext) { return this.leads.import(dto.rows, dto.consentConfirmed, auth.userId); }

  @Get(':id') @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  get(@Param('id') id: string) { return this.leads.get(id); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  update(@Param('id') id: string, @Body() dto: LeadUpdateDto, @CurrentAuth() auth: AuthContext) { return this.leads.update(id, dto, auth.userId); }

  @Delete(':id') @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  @ApiOperation({ summary: 'Erase a contact and their consent history' })
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.leads.remove(id, auth.userId); }
}

@ApiTags('Creator · Campaigns')
@ApiBearerAuth()
@TenantScoped('workspace')
@RequireFeature(FEATURES.MARKETING.key)
@Controller({ path: 'creator/campaigns', version: '1' })
export class CreatorCampaignsController {
  constructor(private readonly campaigns: CampaignsService, private readonly prisma: PrismaService) {}

  @Get() @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  list() { return this.campaigns.list(); }

  @Post() @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  create(@Body() dto: CreateCampaignDto, @CurrentAuth() auth: AuthContext) { return this.campaigns.create(dto, auth.userId); }

  @Get(':id') @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  get(@Param('id') id: string) { return this.campaigns.get(id); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  update(@Param('id') id: string, @Body() dto: CampaignDto) { return this.campaigns.update(id, dto); }

  @Post(':id/test') @HttpCode(200) @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  @ApiOperation({ summary: 'Send a preview to yourself' })
  async test(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { email: true } });
    return this.campaigns.test(id, me.email);
  }

  @Post(':id/schedule') @HttpCode(200) @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  schedule(@Param('id') id: string, @Body() dto: ScheduleDto, @CurrentAuth() auth: AuthContext) { return this.campaigns.schedule(id, dto.at ? new Date(dto.at) : null, auth.userId); }

  @Post(':id/cancel') @HttpCode(200) @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  cancel(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.campaigns.cancel(id, auth.userId); }
}

@ApiTags('Marketing (public)')
@Public()
@Controller({ path: 'public', version: '1' })
export class PublicMarketingController {
  constructor(private readonly leads: LeadsService) {}

  /** Lead form on the academy site (newsletter, free guide…). */
  @Post('leads') @HttpCode(200) @TenantScoped('academy')
  async capture(@Body() dto: LeadFormDto, @Req() req: Request) {
    if (dto.website) return { received: true }; // bots fill hidden fields; say nothing
    await this.leads.capture({ email: dto.email, name: dto.name, phone: dto.phone, source: `form${dto.source ? `:${dto.source}` : ''}`.slice(0, 60), consent: dto.consent, ip: req.ip });
    return { received: true };
  }

  /** Unsubscribe link from marketing email (works on any host). */
  @Get('unsubscribe')
  async unsubscribePage(@Query('t') token: string | undefined, @Req() req: Request, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    try {
      const r = await this.leads.unsubscribe(String(token ?? ''), req.ip);
      res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title><body style="font-family:system-ui;max-width:480px;margin:15vh auto;padding:0 16px;text-align:center"><h1>You're unsubscribed</h1><p>You won't receive marketing email from ${escapeHtml(r.academy ?? 'this academy')} anymore. Account and purchase emails still arrive.</p></body>`);
    } catch {
      res.status(404).end('<!doctype html><title>Link not valid</title><body style="font-family:system-ui;text-align:center;margin-top:15vh"><h1>This link is not valid</h1></body>');
    }
  }

  /** RFC 8058 one-click unsubscribe (mail clients POST here). */
  @Post('unsubscribe') @HttpCode(200)
  async unsubscribeOneClick(@Query('t') token: string | undefined, @Req() req: Request) {
    return this.leads.unsubscribe(String(token ?? ''), req.ip);
  }
}
