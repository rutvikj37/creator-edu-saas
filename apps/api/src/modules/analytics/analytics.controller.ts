import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import type { Response } from 'express';
import { FEATURES, PERMISSIONS } from '@ce/shared';
import { RequireFeature, RequirePermissions, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { AnalyticsService } from './analytics.service.js';

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
  constructor(private readonly svc: AnalyticsService) {}

  @Get('overview') @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  overview(@Query() q: RangeDto) { return this.svc.overview(q); }

  @Get('courses') @RequirePermissions(PERMISSIONS.ANALYTICS_READ) @RequireFeature(FEATURES.ANALYTICS_ADVANCED.key)
  courses() { return this.svc.courses(); }

  /** GST report is a compliance need, so it is on every plan. */
  @Get('gst') @RequirePermissions(PERMISSIONS.ORDERS_READ)
  gst(@Query() q: RangeDto) { return this.svc.gst(q); }

  @Get('exports/gst.csv') @RequirePermissions(PERMISSIONS.ORDERS_READ)
  async gstCsv(@Query() q: RangeDto, @Res() res: Response) {
    const csv = await this.svc.gstCsv(q);
    sendCsv(res, `gst-${q.from ?? 'last-30-days'}${q.to ? `-to-${q.to}` : ''}.csv`, csv);
  }

  @Get('exports/orders.csv') @RequirePermissions(PERMISSIONS.ORDERS_READ)
  async ordersCsv(@Query() q: RangeDto, @Res() res: Response) {
    sendCsv(res, `orders-${q.from ?? 'last-30-days'}${q.to ? `-to-${q.to}` : ''}.csv`, await this.svc.ordersCsv(q));
  }

  @Get('exports/students.csv') @RequirePermissions(PERMISSIONS.STUDENTS_READ) @RequireFeature(FEATURES.ANALYTICS_ADVANCED.key)
  async studentsCsv(@Res() res: Response) { sendCsv(res, 'students.csv', await this.svc.studentsCsv()); }

  @Get('exports/enrollments.csv') @RequirePermissions(PERMISSIONS.STUDENTS_READ) @RequireFeature(FEATURES.ANALYTICS_ADVANCED.key)
  async enrollmentsCsv(@Query() q: EnrollmentExportDto, @Res() res: Response) { sendCsv(res, 'enrollments.csv', await this.svc.enrollmentsCsv(q.courseId)); }
}
