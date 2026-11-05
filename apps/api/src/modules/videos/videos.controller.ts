import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { ClientMetaParam, CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AppRequest, AuthContext } from '../../core/tenancy/request-context.js';
import type { ClientMeta } from '../auth/services/session.service.js';
import { apiOrigin } from '../files/files.controller.js';
import { CompleteUploadDto, HeartbeatDto, InitiateUploadDto, ListVideosQuery, PlaybackAuthorizeDto, UpdateVideoDto } from './dto/videos.dto.js';
import { VideoPlaybackService } from './services/video-playback.service.js';
import { VideoProcessingService } from './services/video-processing.service.js';
import { VideoUploadService } from './services/video-upload.service.js';
import { VideoWebhookService } from './services/video-webhook.service.js';
import { VideoUsageService } from './services/video-usage.service.js';
import { VideosService } from './videos.service.js';

const uploadLimit = { default: { limit: () => Number(process.env.VIDEO_UPLOAD_RATE_LIMIT_PER_MINUTE ?? 30), ttl: 60_000 } };
const playbackLimit = { default: { limit: () => Number(process.env.VIDEO_PLAYBACK_RATE_LIMIT_PER_MINUTE ?? 60), ttl: 60_000 } };
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// ── /api/v1/videos (provider pipeline) ───────────────────────

@ApiTags('Videos')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'videos', version: '1' })
export class VideosController {
  constructor(
    private readonly videos: VideosService,
    private readonly upload: VideoUploadService,
    private readonly processing: VideoProcessingService,
  ) {}

  @Post('upload/initiate') @HttpCode(201) @Throttle(uploadLimit) @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  @ApiOperation({ summary: 'Create a video and return short-lived credentials for a direct browser → Bunny (TUS) upload' })
  initiate(@Body() dto: InitiateUploadDto, @CurrentAuth() a: AuthContext) { return this.upload.initiate(dto, a.userId); }

  @Post('upload/complete') @HttpCode(200) @Throttle(uploadLimit) @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  @ApiOperation({ summary: 'Report the upload outcome; status advances only after the provider confirms' })
  complete(@Body() dto: CompleteUploadDto, @CurrentAuth() a: AuthContext) {
    return dto.outcome === 'started' ? this.upload.started(dto.videoId, dto.uploadSessionId) : this.upload.complete({ ...dto, outcome: dto.outcome }, a.userId);
  }

  @Get() @RequirePermissions(PERMISSIONS.COURSES_READ)
  list(@Query() q: ListVideosQuery) { return this.videos.list(q); }

  @Get('config') @RequirePermissions(PERMISSIONS.COURSES_READ)
  @ApiOperation({ summary: 'Upload settings for the browser (no credentials)' })
  config() { return this.upload.clientConfig(); }

  @Get(':id') @RequirePermissions(PERMISSIONS.COURSES_READ)
  get(@Param('id') id: string) { return this.videos.details(id); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateVideoDto, @CurrentAuth() a: AuthContext) { return this.videos.update(id, dto, a.userId); }

  @Delete(':id') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  remove(@Param('id') id: string, @CurrentAuth() a: AuthContext) { return this.videos.remove(id, a.userId); }

  @Get(':id/processing-status') @RequirePermissions(PERMISSIONS.COURSES_READ)
  @ApiOperation({ summary: 'Current status; in-flight provider videos are re-read from the provider (manual refresh)' })
  status(@Param('id') id: string) { return this.processing.status(id); }

  @Post(':id/retry-processing') @HttpCode(200) @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  retry(@Param('id') id: string) { return this.processing.retryProcessing(id); }

  @Get(':id/preview') @RequirePermissions(PERMISSIONS.COURSES_READ)
  preview(@Param('id') id: string, @Req() req: AppRequest) { return this.videos.preview(id, apiOrigin(req)); }
}

@ApiTags('Videos · Student')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'videos', version: '1' })
export class VideoPlaybackController {
  constructor(private readonly playback: VideoPlaybackService) {}

  @Post(':id/playback-authorize') @HttpCode(200) @Throttle(playbackLimit)
  @ApiOperation({ summary: 'Short-lived token-authenticated player URL for an entitled student (not DRM)' })
  authorize(@Param('id') id: string, @Body() dto: PlaybackAuthorizeDto, @CurrentAuth() a: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    return this.playback.authorize(a.userId, dto.lessonId, id, meta);
  }
}

@ApiTags('Videos · Webhooks')
@Controller({ path: 'videos/webhooks', version: '1' })
export class VideoWebhookController {
  constructor(private readonly webhooks: VideoWebhookService) {}

  @Public() @Post('bunny') @HttpCode(200)
  @ApiOperation({ summary: 'Bunny Stream webhook (URL carries ?secret=BUNNY_STREAM_WEBHOOK_SECRET)' })
  bunny(@Query('secret') secret: string | undefined, @Req() req: AppRequest & { rawBody?: Buffer }) {
    return this.webhooks.receive(secret, req.rawBody);
  }
}

// ── legacy routes kept for existing clients (Phase 6) ────────

class CreateVideoDto {
  @ApiProperty() @IsString() @Length(25, 25) fileId: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(86400) durationSeconds?: number;
}

@ApiTags('Creator · Videos')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/videos', version: '1' })
export class CreatorVideosController {
  constructor(private readonly videos: VideosService) {}

  @Get() @RequirePermissions(PERMISSIONS.COURSES_READ)
  list() { return this.videos.list(); }

  @Post() @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  @ApiOperation({ summary: 'Add an uploaded VIDEO_SOURCE file to the video library (storage delivery)' })
  create(@Body() dto: CreateVideoDto, @CurrentAuth() auth: AuthContext) { return this.videos.create(dto, auth.userId); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateVideoDto, @CurrentAuth() auth: AuthContext) { return this.videos.update(id, dto, auth.userId); }

  @Get(':id/preview') @RequirePermissions(PERMISSIONS.COURSES_READ)
  preview(@Param('id') id: string, @Req() req: AppRequest) { return this.videos.preview(id, apiOrigin(req)); }

  @Delete(':id') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.videos.remove(id, auth.userId); }
}

@ApiTags('Student · Video')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'learn', version: '1' })
export class LearnVideoController {
  constructor(private readonly videos: VideosService) {}

  @Post('lessons/:lessonId/video') @HttpCode(200) @Throttle(playbackLimit)
  @ApiOperation({ summary: 'Authorise playback of a lesson video (signed URL or provider token embed)' })
  start(@Param('lessonId') id: string, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta, @Req() req: AppRequest) {
    return this.videos.startPlayback(auth.userId, id, meta, apiOrigin(req));
  }

  @Put('video-sessions/:sessionId/heartbeat')
  heartbeat(@Param('sessionId') id: string, @Body() dto: HeartbeatDto, @CurrentAuth() auth: AuthContext) {
    return this.videos.heartbeat(auth.userId, id, dto.positionSeconds, dto.durationSeconds);
  }

  @Delete('video-sessions/:sessionId')
  end(@Param('sessionId') id: string, @CurrentAuth() auth: AuthContext) {
    return this.videos.endPlayback(auth.userId, id);
  }
}

// ── platform administration ──────────────────────────────────

class UsageQuery {
  @IsOptional() @IsString() @Length(7, 7) period?: string;
}

@ApiTags('Platform · Videos')
@ApiBearerAuth()
@RequireRealm('PLATFORM')
@Controller({ path: 'platform/videos', version: '1' })
export class PlatformVideoUsageController {
  constructor(private readonly usage: VideoUsageService) {}

  @Get('usage') @RequirePermissions(PERMISSIONS.PLATFORM_SYSTEM_READ)
  @ApiOperation({ summary: 'Video usage across academies (estimates; nothing is charged)' })
  dashboard(@Query() q: UsageQuery) {
    return this.usage.dashboard(q.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.period) ? q.period : undefined);
  }
}
