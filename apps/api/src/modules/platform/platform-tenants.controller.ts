import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@ce/shared';
import { ClientMetaParam, CurrentAuth, RequirePermissions, RequireRealm } from '../../common/decorators/auth.decorators.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import type { ClientMeta } from '../auth/services/session.service.js';
import { AssignPlanDto, DeleteTenantDto, LimitOverridesDto, SuspendDto, TenantListQuery } from './dto/platform.dto.js';
import { PlatformTenantsService } from './platform-tenants.service.js';

@ApiTags('Platform · Tenants')
@ApiBearerAuth()
@RequireRealm('PLATFORM')
@Controller({ path: 'platform/tenants', version: '1' })
export class PlatformTenantsController {
  constructor(private readonly tenants: PlatformTenantsService) {}

  private actor(auth: AuthContext, meta: ClientMeta) {
    return { userId: auth.userId, ...meta };
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_READ)
  @ApiOperation({ summary: 'List tenants (search, status/plan filters, sorting, pagination)' })
  list(@Query() q: TenantListQuery) {
    return this.tenants.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_READ)
  detail(@Param('id') id: string) {
    return this.tenants.detail(id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  activate(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    return this.tenants.activate(id, this.actor(auth, meta));
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  suspend(@Param('id') id: string, @Body() dto: SuspendDto, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    return this.tenants.suspend(id, dto.reason, this.actor(auth, meta));
  }

  @Post(':id/subscription')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  @ApiOperation({ summary: 'Assign a plan (complimentary/manual change; paid self-serve is via billing)' })
  assignPlan(@Param('id') id: string, @Body() dto: AssignPlanDto, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    return this.tenants.assignPlan(id, dto, this.actor(auth, meta));
  }

  @Put(':id/limits')
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  @ApiOperation({ summary: 'Replace per-tenant feature/limit overrides' })
  limits(@Param('id') id: string, @Body() dto: LimitOverridesDto, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    return this.tenants.setOverrides(id, dto, this.actor(auth, meta));
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_DELETE)
  @ApiOperation({ summary: 'Schedule deletion (restorable during the retention period)' })
  remove(@Param('id') id: string, @Body() dto: DeleteTenantDto, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    return this.tenants.scheduleDeletion(id, dto.confirmSlug, this.actor(auth, meta));
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_DELETE)
  restore(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    return this.tenants.restore(id, this.actor(auth, meta));
  }
}
