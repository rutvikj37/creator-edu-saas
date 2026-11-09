import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@ce/shared';
import { AllowWhenSuspended, CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { CreateTicketDto, TicketListQuery, TicketReplyDto, TicketUpdateDto } from './dto/platform.dto.js';
import { SupportService } from './support.service.js';

@ApiTags('Creator · Support')
@ApiBearerAuth()
@TenantScoped('workspace')
@AllowWhenSuspended()
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
@Controller({ path: 'creator/support/tickets', version: '1' })
export class CreatorSupportController {
  constructor(
    private readonly support: SupportService,
    private readonly ctx: TenantContext,
  ) {}

  @Get()
  list(@Query() q: TicketListQuery) {
    return this.support.listForTenant(this.ctx.requireTenantId(), q);
  }

  @Post()
  create(@Body() dto: CreateTicketDto, @CurrentAuth() auth: AuthContext) {
    return this.support.create(this.ctx.requireTenantId(), auth.userId, dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.support.getForRequester(this.ctx.requireTenantId(), id);
  }

  @Post(':id/messages')
  reply(@Param('id') id: string, @Body() dto: TicketReplyDto, @CurrentAuth() auth: AuthContext) {
    return this.support.requesterReply(this.ctx.requireTenantId(), id, auth.userId, dto.body);
  }
}

@ApiTags('Platform · Support')
@ApiBearerAuth()
@RequireRealm('PLATFORM')
@RequirePermissions(PERMISSIONS.PLATFORM_SUPPORT_MANAGE)
@Controller({ path: 'platform/support', version: '1' })
export class PlatformSupportController {
  constructor(private readonly support: SupportService) {}

  @Get('tickets')
  list(@Query() q: TicketListQuery, @CurrentAuth() auth: AuthContext) {
    return this.support.listForStaff(auth.userId, q);
  }

  @Get('agents')
  agents() {
    return this.support.staffList();
  }

  @Get('report')
  report() {
    return this.support.report();
  }

  @Get('tickets/:id')
  get(@Param('id') id: string) {
    return this.support.getForStaff(id);
  }

  @Post('tickets/:id/messages')
  reply(@Param('id') id: string, @Body() dto: TicketReplyDto, @CurrentAuth() auth: AuthContext) {
    return this.support.staffReply(id, auth.userId, dto, this.support.origin());
  }

  @Patch('tickets/:id')
  update(@Param('id') id: string, @Body() dto: TicketUpdateDto) {
    return this.support.update(id, dto);
  }
}
