import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@ce/shared';
import { RequirePermissions, RequireRealm } from '../../common/decorators/auth.decorators.js';
import { DashboardService } from './dashboard.service.js';
import { DateRangeQuery } from './dto/platform.dto.js';

@ApiTags('Platform · Dashboard')
@ApiBearerAuth()
@RequireRealm('PLATFORM')
@Controller({ path: 'platform/dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_READ)
  @ApiOperation({ summary: 'Platform KPIs and time series for a date range (default: last 30 days)' })
  metrics(@Query() q: DateRangeQuery) {
    return this.dashboard.metrics(q.from, q.to);
  }
}
