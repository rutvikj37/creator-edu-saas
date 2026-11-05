import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { FEATURES, PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequireFeature, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { AppRequest, AuthContext } from '../../core/tenancy/request-context.js';
import { apiOrigin } from '../files/files.controller.js';
import { BatchesService } from './batches.service.js';
import { LiveInteractionService } from './interaction.service.js';
import { LiveService } from './live.service.js';
import { WebinarsService } from './webinars.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class ClassDto {
  @ApiPropertyOptional({ enum: ['CLASS', 'WEBINAR'] }) @IsOptional() @IsIn(['CLASS', 'WEBINAR']) kind?: 'CLASS' | 'WEBINAR';
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional({ enum: ['LIVEKIT', 'EXTERNAL', 'PLUGNMEET'] }) @IsOptional() @IsIn(['LIVEKIT', 'EXTERNAL', 'PLUGNMEET']) provider?: 'LIVEKIT' | 'EXTERNAL' | 'PLUGNMEET';
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) externalUrl?: string | null;
  @ApiPropertyOptional({ enum: ['COURSE', 'BATCH', 'ALL_STUDENTS', 'REGISTRANTS'] }) @IsOptional() @IsIn(['COURSE', 'BATCH', 'ALL_STUDENTS', 'REGISTRANTS']) audience?: 'COURSE' | 'BATCH' | 'ALL_STUDENTS' | 'REGISTRANTS';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) courseId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) batchId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(5) @Max(600) durationMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @ApiPropertyOptional({ example: { freq: 'WEEKLY', byDay: ['TU', 'TH'], count: 8 } }) @IsOptional() @IsObject() recurrence?: any;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) capacity?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() waitingRoom?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() recordSessions?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) hostUserId?: string;
  @ApiPropertyOptional({ description: 'Webinars: ticket price; null or 0 = free' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) priceAmount?: number | null;
}
class CreateClassDto extends ClassDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) declare title: string;
  @ApiProperty({ enum: ['LIVEKIT', 'EXTERNAL', 'PLUGNMEET'] }) @IsIn(['LIVEKIT', 'EXTERNAL', 'PLUGNMEET']) declare provider: 'LIVEKIT' | 'EXTERNAL' | 'PLUGNMEET';
  @ApiProperty() @IsDateString() declare startsAt: string;
  @ApiProperty() @IsInt() @Min(5) @Max(600) declare durationMinutes: number;
}
class DecideDto {
  @ApiProperty() @IsBoolean() admit: boolean;
}
class PollDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 300) question: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(2) @ArrayMaxSize(6) @IsString({ each: true }) options: string[];
}
class VoteDto {
  @ApiProperty() @IsInt() @Min(0) @Max(5) optionIndex: number;
}
class AskDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 500) text: string;
}
class BatchDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) courseId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startsAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100000) capacity?: number | null;
}
class CreateBatchDto extends BatchDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) declare name: string;
}
class MembersDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsEmail({}, { each: true }) emails: string[];
}
class RegisterDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) name: string;
  @ApiProperty() @Transform(trim) @IsEmail() email: string;
  @ApiPropertyOptional({ description: 'Agreed to receive emails about this webinar' }) @IsOptional() @IsBoolean() consent?: boolean;
}
class TicketJoinDto {
  @ApiProperty() @IsString() @Length(25, 25) sessionId: string;
}

async function staffName(prisma: PrismaService, userId: string) {
  return (await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }))?.fullName ?? 'Host';
}

// ── Creator ─────────────────────────────────────────────────
@ApiTags('Creator · Live classes')
@ApiBearerAuth()
@TenantScoped('workspace')
@RequireFeature(FEATURES.LIVE_CLASSES.key)
@Controller({ path: 'creator/live', version: '1' })
export class CreatorLiveController {
  constructor(
    private readonly live: LiveService,
    private readonly interaction: LiveInteractionService,
    private readonly prisma: PrismaService,
  ) {}

  private async who(auth: AuthContext) {
    return { userId: auth.userId, registrationId: null, staff: true, name: await staffName(this.prisma, auth.userId) };
  }

  @Get('providers') @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  @ApiOperation({ summary: 'Which classroom options are available on this platform' })
  providers() { return this.live.providers(); }

  @Get('classes') @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  list(@Query('kind') kind?: 'CLASS' | 'WEBINAR') { return this.live.list({ kind: kind === 'WEBINAR' || kind === 'CLASS' ? kind : undefined }); }

  @Post('classes') @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  create(@Body() dto: CreateClassDto, @CurrentAuth() auth: AuthContext) { return this.live.create(dto, auth.userId); }

  @Get('classes/:id') @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  get(@Param('id') id: string) { return this.live.get(id); }

  @Patch('classes/:id') @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  update(@Param('id') id: string, @Body() dto: ClassDto, @CurrentAuth() auth: AuthContext) { return this.live.update(id, dto, auth.userId); }

  @Post('classes/:id/cancel') @HttpCode(200) @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  cancel(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.live.cancelClass(id, auth.userId); }

  @Post('sessions/:id/cancel') @HttpCode(200) @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  cancelSession(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.live.cancelSession(id, auth.userId); }

  @Post('sessions/:id/host') @HttpCode(200) @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  @ApiOperation({ summary: 'Start/join as host (LiveKit token or meeting link)' })
  async host(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.live.host(id, { userId: auth.userId, name: await staffName(this.prisma, auth.userId) }); }

  @Post('sessions/:id/end') @HttpCode(200) @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  end(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.live.end(id, auth.userId); }

  @Get('sessions/:id/attendance') @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  attendance(@Param('id') id: string) { return this.live.attendance(id); }

  @Get('sessions/:id/attendance.csv') @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  async attendanceCsv(@Param('id') id: string, @Res() res: Response) {
    const csv = await this.live.attendanceCsv(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${id}.csv"`);
    res.end(`﻿${csv}`);
  }

  @Get('sessions/:id/recording') @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  recording(@Param('id') id: string, @Req() req: AppRequest) { return this.live.recordingUrl(id, { userId: null, registrationId: null, staff: true }, apiOrigin(req)); }

  @Get('sessions/:id/admissions') @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  admissions(@Param('id') id: string) { return this.live.admissions(id); }

  @Post('sessions/:id/admissions/:admissionId') @HttpCode(200) @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  decide(@Param('id') id: string, @Param('admissionId') admissionId: string, @Body() dto: DecideDto) { return this.live.decide(id, admissionId, dto.admit); }

  @Get('sessions/:id/polls') @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  async polls(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.interaction.polls(id, await this.who(auth)); }

  @Post('sessions/:id/polls') @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  async createPoll(@Param('id') id: string, @Body() dto: PollDto, @CurrentAuth() auth: AuthContext) { return this.interaction.createPoll(id, await this.who(auth), dto.question, dto.options); }

  @Post('sessions/:id/polls/:pollId/close') @HttpCode(200) @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  async closePoll(@Param('id') id: string, @Param('pollId') pollId: string, @CurrentAuth() auth: AuthContext) { return this.interaction.closePoll(id, pollId, await this.who(auth)); }

  @Get('sessions/:id/questions') @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  async questions(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.interaction.questions(id, await this.who(auth)); }

  @Post('sessions/:id/questions/:questionId/answer') @HttpCode(200) @RequirePermissions(PERMISSIONS.LIVE_MANAGE)
  async answer(@Param('id') id: string, @Param('questionId') questionId: string, @CurrentAuth() auth: AuthContext) { return this.interaction.answer(id, questionId, await this.who(auth)); }
}

@ApiTags('Creator · Batches')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/batches', version: '1' })
export class CreatorBatchesController {
  constructor(private readonly batches: BatchesService) {}

  @Get() @RequirePermissions(PERMISSIONS.STUDENTS_READ)
  list() { return this.batches.list(); }

  @Post() @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  create(@Body() dto: CreateBatchDto, @CurrentAuth() auth: AuthContext) { return this.batches.create(dto, auth.userId); }

  @Get(':id') @RequirePermissions(PERMISSIONS.STUDENTS_READ)
  get(@Param('id') id: string) { return this.batches.get(id); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  update(@Param('id') id: string, @Body() dto: BatchDto, @CurrentAuth() auth: AuthContext) { return this.batches.update(id, dto, auth.userId); }

  @Post(':id/members') @HttpCode(200) @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  @ApiOperation({ summary: 'Add existing students by email (enrols them when the batch has a course)' })
  add(@Param('id') id: string, @Body() dto: MembersDto, @CurrentAuth() auth: AuthContext) { return this.batches.addMembers(id, dto.emails, auth.userId); }

  @Post(':id/members/:memberId/remove') @HttpCode(200) @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  remove(@Param('id') id: string, @Param('memberId') memberId: string, @CurrentAuth() auth: AuthContext) { return this.batches.removeMember(id, memberId, auth.userId); }

  @Post(':id/archive') @HttpCode(200) @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  archive(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.batches.archive(id, auth.userId); }
}

// ── Student ─────────────────────────────────────────────────
@ApiTags('Student · Live')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'learn/live', version: '1' })
export class LearnLiveController {
  constructor(
    private readonly live: LiveService,
    private readonly interaction: LiveInteractionService,
    private readonly prisma: PrismaService,
  ) {}

  private async who(auth: AuthContext) {
    return { userId: auth.userId, registrationId: null, staff: false, name: (await this.prisma.user.findUnique({ where: { id: auth.userId }, select: { fullName: true } }))?.fullName ?? 'Student' };
  }

  @Get('upcoming')
  upcoming(@CurrentAuth() auth: AuthContext) { return this.live.upcomingFor(auth.userId); }

  @Get('recordings')
  recordings(@CurrentAuth() auth: AuthContext) { return this.live.recordingsFor(auth.userId); }

  @Get('sessions/:id/recording')
  recording(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) { return this.live.recordingUrl(id, { userId: auth.userId, registrationId: null }, apiOrigin(req)); }

  @Post('sessions/:id/join') @HttpCode(200)
  @ApiOperation({ summary: 'Join (LiveKit token, waiting-room state, or meeting link)' })
  async join(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.live.join(id, await this.who(auth)); }

  @Get('sessions/:id/admission')
  admission(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.live.admissionStatus(id, `usr_${auth.userId}`); }

  @Get('sessions/:id/polls')
  async polls(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.interaction.polls(id, await this.who(auth)); }

  @Post('sessions/:id/polls/:pollId/vote') @HttpCode(200)
  async vote(@Param('id') id: string, @Param('pollId') pollId: string, @Body() dto: VoteDto, @CurrentAuth() auth: AuthContext) { return this.interaction.vote(id, pollId, await this.who(auth), dto.optionIndex); }

  @Get('sessions/:id/questions')
  async questions(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.interaction.questions(id, await this.who(auth)); }

  @Post('sessions/:id/questions')
  async ask(@Param('id') id: string, @Body() dto: AskDto, @CurrentAuth() auth: AuthContext) { return this.interaction.ask(id, await this.who(auth), dto.text); }

  @Post('sessions/:id/questions/:questionId/upvote') @HttpCode(200)
  async upvote(@Param('id') id: string, @Param('questionId') questionId: string, @CurrentAuth() auth: AuthContext) { return this.interaction.upvote(id, questionId, await this.who(auth)); }
}

// ── Public: webinars and tickets ────────────────────────────
@ApiTags('Webinars (public)')
@Public()
@TenantScoped('academy')
@Controller({ path: 'public', version: '1' })
export class PublicWebinarController {
  constructor(
    private readonly webinars: WebinarsService,
    private readonly interaction: LiveInteractionService,
    private readonly live: LiveService,
  ) {}

  @Get('webinars/:slug')
  get(@Param('slug') slug: string) { return this.webinars.publicGet(slug.slice(0, 120)); }

  @Post('webinars/:slug/register') @HttpCode(200)
  @ApiOperation({ summary: 'Free registration; emails a personal join link' })
  register(@Param('slug') slug: string, @Body() dto: RegisterDto) { return this.webinars.register(slug.slice(0, 120), { name: dto.name, email: dto.email, consent: dto.consent === true }); }

  @Get('live/tickets/:code')
  ticket(@Param('code') code: string) { return this.webinars.ticket(code.slice(0, 32)); }

  @Post('live/tickets/:code/join') @HttpCode(200)
  join(@Param('code') code: string, @Body() dto: TicketJoinDto) { return this.webinars.joinWithTicket(code.slice(0, 32), dto.sessionId); }

  @Get('live/tickets/:code/sessions/:id/admission')
  async admission(@Param('code') code: string, @Param('id') id: string) {
    const who = await this.webinars.who(code.slice(0, 32));
    return this.live.admissionStatus(id, `reg_${who.registrationId}`);
  }

  @Get('live/tickets/:code/sessions/:id/polls')
  async polls(@Param('code') code: string, @Param('id') id: string) { return this.interaction.polls(id, await this.webinars.who(code.slice(0, 32))); }

  @Post('live/tickets/:code/sessions/:id/polls/:pollId/vote') @HttpCode(200)
  async vote(@Param('code') code: string, @Param('id') id: string, @Param('pollId') pollId: string, @Body() dto: VoteDto) { return this.interaction.vote(id, pollId, await this.webinars.who(code.slice(0, 32)), dto.optionIndex); }

  @Get('live/tickets/:code/sessions/:id/questions')
  async questions(@Param('code') code: string, @Param('id') id: string) { return this.interaction.questions(id, await this.webinars.who(code.slice(0, 32))); }

  @Post('live/tickets/:code/sessions/:id/questions')
  async ask(@Param('code') code: string, @Param('id') id: string, @Body() dto: AskDto) { return this.interaction.ask(id, await this.webinars.who(code.slice(0, 32)), dto.text); }
}

// ── LiveKit webhooks ────────────────────────────────────────
@ApiTags('Webhooks')
@Public()
@Controller({ path: 'webhooks/livekit', version: '1' })
export class LiveKitWebhookController {
  constructor(private readonly live: LiveService) {}

  @Post() @HttpCode(200)
  @ApiOperation({ summary: 'LiveKit webhook (Authorization: JWT signed with the API secret, sha256 of body)' })
  receive(@Req() req: Request & { rawBody?: Buffer }, @Headers('authorization') auth?: string) {
    return this.live.handleWebhook(req.rawBody?.toString('utf8') ?? '', auth);
  }
}

// ── plugNmeet webhooks ──────────────────────────────────────
@ApiTags('Webhooks')
@Public()
@Controller({ path: 'webhooks/plugnmeet', version: '1' })
export class PlugNmeetWebhookController {
  constructor(private readonly live: LiveService) {}

  @Post(':sessionId/:token') @HttpCode(200)
  @ApiOperation({ summary: 'plugNmeet room webhook (set per room; the URL carries a per-session secret)' })
  receive(@Param('sessionId') sessionId: string, @Param('token') token: string, @Req() req: Request & { rawBody?: Buffer }) {
    return this.live.handlePlugNmeetWebhook(sessionId, token.slice(0, 64), req.rawBody?.toString('utf8') ?? '');
  }
}
