import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { ChatService } from './chat.service.js';

class SendDto {
  @ApiProperty({ maxLength: 2000 }) @IsString() @MaxLength(4000) body: string;
}
class StatusDto {
  @ApiProperty({ enum: ['OPEN', 'CLOSED'] }) @IsIn(['OPEN', 'CLOSED']) status: 'OPEN' | 'CLOSED';
}
class ListQuery {
  @ApiPropertyOptional({ enum: ['OPEN', 'CLOSED'] }) @IsOptional() @IsString() @MaxLength(40) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) unread?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) page?: string;
  @ApiPropertyOptional({ description: 'Search customer name or email (academy name for platform support)' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
}
class PollQuery {
  @ApiPropertyOptional({ description: 'Id of the last message the client has' }) @IsOptional() @IsString() @MaxLength(40) after?: string;
  @ApiPropertyOptional({ description: '1 = wait up to 25 s for a new message' }) @IsOptional() @IsString() @MaxLength(40) wait?: string;
  @ApiPropertyOptional({ description: 'Page back through history from this message' }) @IsOptional() @IsString() @MaxLength(40) before?: string;
}
const waitOf = (q: PollQuery) => (q.wait === '1' || q.wait === 'true' ? 25_000 : 0);
const str = (v: unknown) => (typeof v === 'string' && v.length <= 40 ? v : undefined);

@ApiTags('Student · Chat')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'learn/chat', version: '1' })
export class LearnChatController {
  constructor(private readonly chat: ChatService, private readonly ctx: TenantContext) {}
  private thread(auth: AuthContext) { return this.chat.customerThread(this.ctx.requireTenantId(), 'ACADEMY', auth.userId); }

  @Get() @ApiOperation({ summary: 'My conversation with the academy team, latest messages' })
  async get(@CurrentAuth() auth: AuthContext, @Query() q: PollQuery) {
    const c = await this.thread(auth);
    return { ...(await this.chat.messages(c, str(q.before))), unread: c.customerUnread };
  }

  @Get('messages') @ApiOperation({ summary: 'New messages after `after` (long poll with wait=1)' })
  async poll(@CurrentAuth() auth: AuthContext, @Query() q: PollQuery) { return this.chat.poll(await this.thread(auth), str(q.after), waitOf(q)); }

  @Post('messages') @ApiOperation({ summary: 'Send a message to the academy team' })
  async send(@CurrentAuth() auth: AuthContext, @Body() dto: SendDto) { return this.chat.send(await this.thread(auth), 'customer', auth.userId, dto.body); }

  @Post('read') @HttpCode(200)
  async read(@CurrentAuth() auth: AuthContext) { return this.chat.markRead(await this.thread(auth), 'customer'); }
}

@ApiTags('Creator · Chat inbox')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/chat/conversations', version: '1' })
export class CreatorChatController {
  constructor(private readonly chat: ChatService, private readonly ctx: TenantContext) {}
  private scope() { return { kind: 'ACADEMY' as const, tenantId: this.ctx.requireTenantId() }; }
  private conv(id: string) { return this.chat.agentThread(id, this.scope()); }

  @Get() @RequirePermissions(PERMISSIONS.SUPPORT_MANAGE) @ApiOperation({ summary: 'Student conversations, latest first' })
  list(@Query() q: ListQuery) { return this.chat.list(this.scope(), { status: q.status, unread: q.unread === '1' || q.unread === 'true', page: Number(q.page) || 1, q: q.q }); }

  @Get(':id') @RequirePermissions(PERMISSIONS.SUPPORT_MANAGE)
  async get(@Param('id') id: string, @Query() q: PollQuery) { return this.chat.messages(await this.conv(id), str(q.before)); }

  @Get(':id/messages') @RequirePermissions(PERMISSIONS.SUPPORT_MANAGE)
  async poll(@Param('id') id: string, @Query() q: PollQuery) { return this.chat.poll(await this.conv(id), str(q.after), waitOf(q)); }

  @Post(':id/messages') @RequirePermissions(PERMISSIONS.SUPPORT_MANAGE)
  async send(@Param('id') id: string, @Body() dto: SendDto, @CurrentAuth() auth: AuthContext) { return this.chat.send(await this.conv(id), 'agent', auth.userId, dto.body); }

  @Post(':id/read') @HttpCode(200) @RequirePermissions(PERMISSIONS.SUPPORT_MANAGE)
  async read(@Param('id') id: string) { return this.chat.markRead(await this.conv(id), 'agent'); }

  @Post(':id/status') @HttpCode(200) @RequirePermissions(PERMISSIONS.SUPPORT_MANAGE)
  async status(@Param('id') id: string, @Body() dto: StatusDto) { return this.chat.setStatus(await this.conv(id), dto.status); }
}

@ApiTags('Creator · Platform support chat')
@ApiBearerAuth()
@TenantScoped('workspace')
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
@Controller({ path: 'creator/support-chat', version: '1' })
export class CreatorSupportChatController {
  constructor(private readonly chat: ChatService, private readonly ctx: TenantContext) {}
  private thread() { return this.chat.customerThread(this.ctx.requireTenantId(), 'PLATFORM', null); }

  @Get() @ApiOperation({ summary: "The academy's conversation with platform support" })
  async get(@Query() q: PollQuery) {
    const c = await this.thread();
    return { ...(await this.chat.messages(c, str(q.before))), unread: c.customerUnread };
  }

  @Get('messages')
  async poll(@Query() q: PollQuery) { return this.chat.poll(await this.thread(), str(q.after), waitOf(q)); }

  @Post('messages')
  async send(@Body() dto: SendDto, @CurrentAuth() auth: AuthContext) { return this.chat.send(await this.thread(), 'customer', auth.userId, dto.body); }

  @Post('read') @HttpCode(200)
  async read() { return this.chat.markRead(await this.thread(), 'customer'); }
}

@ApiTags('Platform · Support chat')
@ApiBearerAuth()
@RequireRealm('PLATFORM')
@Controller({ path: 'platform/support-chat/conversations', version: '1' })
export class PlatformSupportChatController {
  constructor(private readonly chat: ChatService) {}
  private readonly scope = { kind: 'PLATFORM' as const };
  private conv(id: string) { return this.chat.agentThread(id, this.scope); }

  @Get() @RequirePermissions(PERMISSIONS.PLATFORM_SUPPORT_MANAGE) @ApiOperation({ summary: 'Academy conversations with support, latest first' })
  list(@Query() q: ListQuery) { return this.chat.list(this.scope, { status: q.status, unread: q.unread === '1' || q.unread === 'true', page: Number(q.page) || 1, q: q.q }); }

  @Get(':id') @RequirePermissions(PERMISSIONS.PLATFORM_SUPPORT_MANAGE)
  async get(@Param('id') id: string, @Query() q: PollQuery) { return this.chat.messages(await this.conv(id), str(q.before)); }

  @Get(':id/messages') @RequirePermissions(PERMISSIONS.PLATFORM_SUPPORT_MANAGE)
  async poll(@Param('id') id: string, @Query() q: PollQuery) { return this.chat.poll(await this.conv(id), str(q.after), waitOf(q)); }

  @Post(':id/messages') @RequirePermissions(PERMISSIONS.PLATFORM_SUPPORT_MANAGE)
  async send(@Param('id') id: string, @Body() dto: SendDto, @CurrentAuth() auth: AuthContext) { return this.chat.send(await this.conv(id), 'agent', auth.userId, dto.body); }

  @Post(':id/read') @HttpCode(200) @RequirePermissions(PERMISSIONS.PLATFORM_SUPPORT_MANAGE)
  async read(@Param('id') id: string) { return this.chat.markRead(await this.conv(id), 'agent'); }

  @Post(':id/status') @HttpCode(200) @RequirePermissions(PERMISSIONS.PLATFORM_SUPPORT_MANAGE)
  async status(@Param('id') id: string, @Body() dto: StatusDto) { return this.chat.setStatus(await this.conv(id), dto.status); }
}
