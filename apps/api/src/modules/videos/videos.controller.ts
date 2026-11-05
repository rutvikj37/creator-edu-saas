import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { ClientMetaParam, CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import type { AppRequest, AuthContext } from '../../core/tenancy/request-context.js';
import type { ClientMeta } from '../auth/services/session.service.js';
import { apiOrigin } from '../files/files.controller.js';
import { VideosService } from './videos.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
class CreateVideoDto {
  @ApiProperty() @IsString() @Length(25, 25) fileId: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(86400) durationSeconds?: number;
}
class UpdateVideoDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(86400) durationSeconds?: number | null;
}
class HeartbeatDto {
  @ApiProperty() @IsNumber() @Min(0) @Max(864000) positionSeconds: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) @Max(86400) durationSeconds?: number;
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
  @ApiOperation({ summary: 'Add an uploaded VIDEO_SOURCE file to the video library' })
  create(@Body() dto: CreateVideoDto, @CurrentAuth() auth: AuthContext) { return this.videos.create(dto, auth.userId); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateVideoDto) { return this.videos.update(id, dto); }

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

  @Post('lessons/:lessonId/video')
  @HttpCode(200)
  @ApiOperation({ summary: 'Authorise playback and get a short-lived signed stream URL' })
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
