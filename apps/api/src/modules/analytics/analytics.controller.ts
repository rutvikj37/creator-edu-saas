import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AppRequest, AuthContext } from '../../core/tenancy/request-context.js';
import type { Response } from 'express';
import { FEATURES, PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequireFeature, RequirePermissions, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { AnalyticsService } from './analytics.service.js';
import { ConversionService } from './conversion.service.js';

class RangeDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}
class EnrollmentExportDto {
  @IsOptional() @IsString() courseId?: string;
}

function sendCsv(res: Response, name: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(`﻿${csv}`); // BOM so Excel opens UTF-8 (₹, Indic names) correctly
}

@ApiTags('Creator · Analytics')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/analytics', version: '1' })
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService, private readonly conversion: ConversionService) {}

  @Get('conversions') @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  conversions(@Query() q: RangeDto) { return this.conversion.insights(q); }

  @Get('reports') @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  reports(@Query('days') days?: string) { return this.svc.reports(Number(days) || 7); }

  @Get('overview') @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  overview(@Query() q: RangeDto) { return this.svc.overview(q); }

  @Get('courses') @RequirePermissions(PERMISSIONS.ANALYTICS_READ) @RequireFeature(FEATURES.ANALYTICS_ADVANCED.key)
  courses() { return this.svc.courses(); }

  /** GST report is a compliance need, so it is on every plan. */
  @Get('gst') @RequirePermissions(PERMISSIONS.ORDERS_READ)
  gst(@Query() q: RangeDto) { return this.svc.gst(q); }

  @Get('exports/gst.csv') @RequirePermissions(PERMISSIONS.ORDERS_READ)
  async gstCsv(@Query() q: RangeDto, @Res() res: Response, @CurrentAuth() auth: AuthContext) {
    const csv = await this.svc.gstCsv(q);
    const name = `gst-${q.from ?? 'last-30-days'}${q.to ? `-to-${q.to}` : ''}.csv`;
    await this.svc.recordExport('GST', name, csv, auth.userId);
    sendCsv(res, name, csv);
  }

  @Get('exports/orders.csv') @RequirePermissions(PERMISSIONS.ORDERS_READ)
  async ordersCsv(@Query() q: RangeDto, @Res() res: Response, @CurrentAuth() auth: AuthContext) {
    const name = `orders-${q.from ?? 'last-30-days'}${q.to ? `-to-${q.to}` : ''}.csv`;
    const csv = await this.svc.ordersCsv(q);
    await this.svc.recordExport('SALES', name, csv, auth.userId);
    sendCsv(res, name, csv);
  }

  @Get('exports/students.csv') @RequirePermissions(PERMISSIONS.STUDENTS_READ) @RequireFeature(FEATURES.ANALYTICS_ADVANCED.key)
  async studentsCsv(@Res() res: Response, @CurrentAuth() auth: AuthContext) { const csv = await this.svc.studentsCsv(); await this.svc.recordExport('STUDENTS', 'students.csv', csv, auth.userId); sendCsv(res, 'students.csv', csv); }

  @Get('exports/enrollments.csv') @RequirePermissions(PERMISSIONS.STUDENTS_READ) @RequireFeature(FEATURES.ANALYTICS_ADVANCED.key)
  async enrollmentsCsv(@Query() q: EnrollmentExportDto, @Res() res: Response, @CurrentAuth() auth: AuthContext) { const csv = await this.svc.enrollmentsCsv(q.courseId); await this.svc.recordExport('ENROLLMENTS', 'enrollments.csv', csv, auth.userId); sendCsv(res, 'enrollments.csv', csv); }

  @Get('exports') @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  exports(@Query('page') page?: string) { return this.svc.exportsList(Number(page) || 1); }

  @Get('exports/:id/download') @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  async exportDownload(@Param('id') id: string, @Res() res: Response) { const e = await this.svc.exportGet(id); sendCsv(res, e.fileName, e.content); }
}

class TrackItemDto {
  @IsIn(['course', 'bundle', 'product', 'webinar', 'membership', 'cart']) kind: 'course' | 'bundle' | 'product' | 'webinar' | 'membership' | 'cart';
  @IsOptional() @IsString() @MaxLength(25) id?: string;
}
class TrackDto {
  @IsIn(['page_view', 'checkout_started']) type: 'page_view' | 'checkout_started';
  @IsString() @MaxLength(500) path: string;
  @IsString() @MaxLength(40) visitorId: string;
  @IsOptional() @ValidateNested() @Type(() => TrackItemDto) item?: TrackItemDto | null;
  @IsOptional() @IsString() @MaxLength(100) source?: string | null;
  @IsOptional() @IsString() @MaxLength(100) medium?: string | null;
  @IsOptional() @IsString() @MaxLength(150) campaign?: string | null;
  @IsOptional() @IsString() @MaxLength(500) referrer?: string | null;
}

/** First-party page and checkout events from academy sites (no IP stored, bots and Do Not Track ignored). */
@ApiTags('Academy (public) · Tracking')
@Public()
@TenantScoped('academy')
@Controller({ path: 'public/track', version: '1' })
export class TrackController {
  constructor(private readonly conversion: ConversionService) {}

  @Post() @HttpCode(202)
  track(@Body() dto: TrackDto, @Req() req: AppRequest, @Headers('user-agent') ua?: string, @Headers('dnt') dnt?: string) {
    return this.conversion.track(dto, { userId: req.auth?.realm === 'TENANT' ? req.auth.userId : null, userAgent: ua, dnt: dnt === '1' });
  }
}
