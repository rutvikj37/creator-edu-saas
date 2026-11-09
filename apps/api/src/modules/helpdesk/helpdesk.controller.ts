import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { StudentReplyDto, StudentTicketDto, TicketListQuery, TicketReplyDto, TicketUpdateDto } from '../platform/dto/platform.dto.js';
import { HelpdeskService } from './helpdesk.service.js';

@ApiTags('Student · Support')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'learn/support/tickets', version: '1' })
export class LearnSupportController {
  constructor(private readonly helpdesk: HelpdeskService, private readonly ctx: TenantContext) {}

  @Get() @ApiOperation({ summary: 'My requests to this academy' })
  list(@Query() q: TicketListQuery, @CurrentAuth() auth: AuthContext) {
    return this.helpdesk.listForStudent(this.ctx.requireTenantId(), auth.userId, q);
  }

  @Post() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @ApiOperation({ summary: 'Open a request with the academy team' })
  create(@Body() dto: StudentTicketDto, @CurrentAuth() auth: AuthContext) {
    return this.helpdesk.create(this.ctx.requireTenantId(), auth.userId, dto);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.helpdesk.getForStudent(this.ctx.requireTenantId(), auth.userId, id);
  }

  @Post(':id/messages') @Throttle({ default: { limit: 20, ttl: 60_000 } })
  reply(@Param('id') id: string, @Body() dto: StudentReplyDto, @CurrentAuth() auth: AuthContext) {
    return this.helpdesk.studentReply(this.ctx.requireTenantId(), auth.userId, id, dto.body);
  }

  @Post(':id/close') @HttpCode(200)
  close(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.helpdesk.studentClose(this.ctx.requireTenantId(), auth.userId, id);
  }
}

@ApiTags('Creator · Help desk')
@ApiBearerAuth()
@TenantScoped('workspace')
@RequirePermissions(PERMISSIONS.SUPPORT_MANAGE)
@Controller({ path: 'creator/helpdesk', version: '1' })
export class CreatorHelpdeskController {
  constructor(private readonly helpdesk: HelpdeskService, private readonly ctx: TenantContext) {}

  @Get('tickets') @ApiOperation({ summary: 'Student requests, latest activity first' })
  list(@Query() q: TicketListQuery, @CurrentAuth() auth: AuthContext) {
    return this.helpdesk.listForTeam(this.ctx.requireTenantId(), auth.userId, q);
  }

  @Get('summary')
  summary(@CurrentAuth() auth: AuthContext) {
    return this.helpdesk.summary(this.ctx.requireTenantId(), auth.userId);
  }

  @Get('team') @ApiOperation({ summary: 'Team members who can be assigned tickets' })
  team() {
    return this.helpdesk.team(this.ctx.requireTenantId());
  }

  @Get('tickets/:id')
  get(@Param('id') id: string) {
    return this.helpdesk.getForTeam(this.ctx.requireTenantId(), id);
  }

  @Post('tickets/:id/messages')
  reply(@Param('id') id: string, @Body() dto: TicketReplyDto, @CurrentAuth() auth: AuthContext) {
    return this.helpdesk.teamReply(this.ctx.requireTenantId(), id, auth.userId, dto);
  }

  @Patch('tickets/:id')
  update(@Param('id') id: string, @Body() dto: TicketUpdateDto) {
    return this.helpdesk.update(this.ctx.requireTenantId(), id, dto);
  }
}
