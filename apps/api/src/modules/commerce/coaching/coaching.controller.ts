import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../../common/decorators/auth.decorators.js';
import { Public } from '../../../common/decorators/public.decorator.js';
import type { AuthContext } from '../../../core/tenancy/request-context.js';
import { apiOrigin } from '../../files/files.controller.js';
import { CoachingService } from './coaching.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class FaqDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 300) question: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 2000) answer: string;
}
class CoachDto {
  @ApiProperty() @IsString() @Length(25, 25) userId: string;
  @ApiProperty({ minimum: 1, maximum: 10, description: 'Share of bookings: 2 gets twice as many as 1' }) @IsInt() @Min(1) @Max(10) weight: number;
}
class SessionDto {
  @ApiPropertyOptional({ description: 'Existing session to keep' }) @IsOptional() @IsString() @Length(25, 25) id?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) title: string;
  @ApiProperty({ minimum: 15, maximum: 480 }) @IsInt() @Min(15) @Max(480) durationMin: number;
  @ApiProperty({ description: 'Rich-text (TipTap) document' }) @IsObject() agenda: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Length(25, 25, { each: true }) attachmentIds?: string[];
}
class UpdateProgramDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 100) title?: string;
  @ApiPropertyOptional({ description: 'Rich-text (TipTap) document' }) @IsOptional() @IsObject() description?: Record<string, unknown> | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) coverFileId?: string | null;
  @ApiPropertyOptional({ type: [FaqDto] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => FaqDto) faqs?: FaqDto[];
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) planName?: string | null;
  @ApiPropertyOptional({ description: 'What the buyer pays; 0 = free' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) priceAmount?: number;
  @ApiPropertyOptional({ description: 'Original price shown struck through' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) compareAtAmount?: number | null;
  @ApiPropertyOptional({ type: [CoachDto] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CoachDto) coaches?: CoachDto[];
  @ApiPropertyOptional({ type: [SessionDto] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => SessionDto) sessions?: SessionDto[];
}
class CreateProgramDto extends UpdateProgramDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) declare title: string;
}
class StatusDto {
  @ApiProperty({ enum: ['PUBLISHED', 'DRAFT', 'ARCHIVED'] }) @IsIn(['PUBLISHED', 'DRAFT', 'ARCHIVED']) status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED';
}
class HoursDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = Sunday' }) @IsInt() @Min(0) @Max(6) weekday: number;
  @ApiProperty({ description: 'Minutes after midnight' }) @IsInt() @Min(0) @Max(1440) startMinute: number;
  @ApiProperty() @IsInt() @Min(0) @Max(1440) endMinute: number;
}
class ProfileDto {
  @ApiPropertyOptional({ example: 'Asia/Kolkata' }) @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @ApiPropertyOptional({ description: 'Personal Zoom/Meet link used for bookings' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(500) meetingUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(720) minNoticeHours?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(240) bufferMin?: number;
  @ApiPropertyOptional({ type: [HoursDto] }) @IsOptional() @IsArray() @ArrayMaxSize(70) @ValidateNested({ each: true }) @Type(() => HoursDto) hours?: HoursDto[];
}
class BookingsQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(['BOOKED', 'CANCELLED', 'COMPLETED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) programId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) coachId?: string;
  @ApiPropertyOptional({ enum: ['upcoming', 'past'] }) @IsOptional() @IsIn(['upcoming', 'past']) when?: string;
  @ApiPropertyOptional({ description: 'Calendar range start (ISO)' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
class BookingStatusDto {
  @ApiProperty({ enum: ['CANCELLED', 'COMPLETED'] }) @IsIn(['CANCELLED', 'COMPLETED']) status: 'CANCELLED' | 'COMPLETED';
}
class BookDto {
  @ApiProperty() @IsString() @Length(25, 25) sessionId: string;
  @ApiProperty({ description: 'A start time from the slots list (ISO)' }) @IsDateString() startsAt: string;
}

@ApiTags('Creator · Coaching')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/coaching', version: '1' })
export class CreatorCoachingController {
  constructor(private readonly coaching: CoachingService) {}

  @Get('stats') @RequirePermissions(PERMISSIONS.COURSES_READ)
  stats() { return this.coaching.stats(); }

  @Get('programs') @RequirePermissions(PERMISSIONS.COURSES_READ)
  list(@Req() req: Request) { return this.coaching.list(apiOrigin(req)); }

  @Get('programs/:id') @RequirePermissions(PERMISSIONS.COURSES_READ)
  get(@Param('id') id: string, @Req() req: Request) { return this.coaching.get(id, apiOrigin(req)); }

  @Post('programs') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  create(@Body() dto: CreateProgramDto, @CurrentAuth() auth: AuthContext, @Req() req: Request) { return this.coaching.create(dto, auth.userId, apiOrigin(req)); }

  @Patch('programs/:id') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateProgramDto, @CurrentAuth() auth: AuthContext, @Req() req: Request) { return this.coaching.update(id, dto, auth.userId, apiOrigin(req)); }

  @Post('programs/:id/status') @HttpCode(200) @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  status(@Param('id') id: string, @Body() dto: StatusDto, @CurrentAuth() auth: AuthContext, @Req() req: Request) { return this.coaching.setStatus(id, dto.status, auth.userId, apiOrigin(req)); }

  @Get('bookings') @RequirePermissions(PERMISSIONS.COURSES_READ) @ApiOperation({ summary: 'Bookings (paged), or a from/to range for the calendar' })
  bookings(@Query() q: BookingsQuery) { return this.coaching.bookings(q); }

  @Post('bookings/:id/status') @HttpCode(200) @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  bookingStatus(@Param('id') id: string, @Body() dto: BookingStatusDto, @CurrentAuth() auth: AuthContext) { return this.coaching.setBookingStatus(id, dto.status, auth.userId); }

  @Get('team') @RequirePermissions(PERMISSIONS.COURSES_READ) @ApiOperation({ summary: 'Team members who can coach' })
  team() { return this.coaching.team(); }

  @Get('availability/me') @ApiOperation({ summary: 'My coaching hours (any team member)' })
  myProfile(@CurrentAuth() auth: AuthContext) { return this.coaching.profile(auth.userId); }

  @Put('availability/me')
  saveMine(@Body() dto: ProfileDto, @CurrentAuth() auth: AuthContext) { return this.coaching.saveProfile(auth.userId, dto, auth.userId); }

  @Get('availability/:userId') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  profile(@Param('userId') userId: string) { return this.coaching.profile(userId); }

  @Put('availability/:userId') @RequirePermissions(PERMISSIONS.COURSES_MANAGE) @ApiOperation({ summary: "Set a coach's hours on their behalf" })
  saveProfile(@Param('userId') userId: string, @Body() dto: ProfileDto, @CurrentAuth() auth: AuthContext) { return this.coaching.saveProfile(userId, dto, auth.userId); }
}

@ApiTags('Academy (public) · Coaching')
@Public()
@TenantScoped('academy')
@Controller({ path: 'public/coaching', version: '1' })
export class PublicCoachingController {
  constructor(private readonly coaching: CoachingService) {}

  @Get()
  list(@Req() req: Request) { return this.coaching.publicList(apiOrigin(req)); }

  @Get(':slug')
  get(@Param('slug') slug: string, @Req() req: Request) { return this.coaching.publicGet(slug, apiOrigin(req)); }
}

@ApiTags('Student · Coaching')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'learn/coaching', version: '1' })
export class LearnCoachingController {
  constructor(private readonly coaching: CoachingService) {}

  @Get() @ApiOperation({ summary: 'My coaching programs with each session and its booking' })
  mine(@CurrentAuth() auth: AuthContext, @Req() req: Request) { return this.coaching.mine(auth.userId, apiOrigin(req)); }

  @Post(':programId/claim') @HttpCode(200) @ApiOperation({ summary: 'Get a free program' })
  claim(@Param('programId') id: string, @CurrentAuth() auth: AuthContext) { return this.coaching.claimFree(auth.userId, id); }

  @Get(':programId/sessions/:sessionId/slots') @ApiOperation({ summary: 'Free start times over the next 30 days' })
  slots(@Param('programId') programId: string, @Param('sessionId') sessionId: string, @CurrentAuth() auth: AuthContext) { return this.coaching.slots(auth.userId, programId, sessionId); }

  @Post(':programId/bookings') @ApiOperation({ summary: 'Book a session at a free time (a coach is assigned by weight)' })
  book(@Param('programId') programId: string, @Body() dto: BookDto, @CurrentAuth() auth: AuthContext) { return this.coaching.book(auth.userId, programId, dto.sessionId, dto.startsAt); }

  @Post('bookings/:id/cancel') @HttpCode(200)
  cancel(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.coaching.cancelByStudent(auth.userId, id); }

  @Post('bookings/:id/attachments/:fileId') @HttpCode(200) @ApiOperation({ summary: 'Short-lived link to a session attachment' })
  attachment(@Param('id') id: string, @Param('fileId') fileId: string, @CurrentAuth() auth: AuthContext, @Req() req: Request) { return this.coaching.attachment(auth.userId, id, fileId, apiOrigin(req)); }
}
