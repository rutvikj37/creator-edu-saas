import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, RequireRealm } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { AppConfig } from '../../config/app-config.service.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { BackupsService } from './backups.service.js';
import { GoogleDriveBackupProvider } from './providers/google-drive/google-drive.service.js';

class ListBackupsQuery {
  @IsOptional() @IsIn(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'RETRYING']) status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'RETRYING';
  @IsOptional() @IsString() @Length(25, 25) tenantId?: string;
  @IsOptional() @IsIn(['video', 'document']) kind?: 'video' | 'document';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}
class CallbackQuery {
  @IsOptional() @IsString() @MaxLength(2048) code?: string;
  @IsOptional() @IsString() @MaxLength(256) state?: string;
  @IsOptional() @IsString() @MaxLength(256) error?: string;
}
class CourseDocsDto {
  @IsString() @Length(25, 25) courseId: string;
}

/** Backups are platform-level: only Super Admin / platform admins see them. Students never do. */
@ApiTags('Platform · Backups')
@ApiBearerAuth()
@RequireRealm('PLATFORM')
@Controller({ path: 'backups', version: '1' })
export class BackupsController {
  constructor(private readonly backups: BackupsService, private readonly drive: GoogleDriveBackupProvider) {}

  @Get() @RequirePermissions(PERMISSIONS.PLATFORM_SYSTEM_READ)
  list(@Query() q: ListBackupsQuery) { return this.backups.list(q); }

  @Get('drive/quota') @RequirePermissions(PERMISSIONS.PLATFORM_SYSTEM_READ)
  @ApiOperation({ summary: 'Google Drive connection, storage quota and low-space flag' })
  quota() { return this.backups.quota(); }

  @Get('drive/status') @RequirePermissions(PERMISSIONS.PLATFORM_SYSTEM_READ)
  status() { return this.drive.status(); }

  @Post('drive/oauth/start') @HttpCode(200) @RequirePermissions(PERMISSIONS.PLATFORM_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Google consent URL (offline access, drive.file scope)' })
  async start(@CurrentAuth() a: AuthContext) { return { url: await this.drive.authorizationUrl(a.userId) }; }

  @Post('drive/disconnect') @HttpCode(200) @RequirePermissions(PERMISSIONS.PLATFORM_SETTINGS_MANAGE)
  async disconnect() { await this.drive.disconnect(); return { connected: false }; }

  @Post('documents') @HttpCode(200) @RequirePermissions(PERMISSIONS.PLATFORM_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Back up every lesson document of a course' })
  documents(@Body() dto: CourseDocsDto, @CurrentAuth() a: AuthContext) { return this.backups.backupCourseDocuments(dto.courseId, a.userId); }

  @Get(':id') @RequirePermissions(PERMISSIONS.PLATFORM_SYSTEM_READ)
  get(@Param('id') id: string) { return this.backups.get(id); }

  @Post(':id/retry') @HttpCode(200) @RequirePermissions(PERMISSIONS.PLATFORM_SETTINGS_MANAGE)
  retry(@Param('id') id: string, @CurrentAuth() a: AuthContext) { return this.backups.retry(id, a.userId); }

  @Post(':id/restore') @HttpCode(200) @RequirePermissions(PERMISSIONS.PLATFORM_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Verify the backup, then re-upload the original to the video host' })
  restore(@Param('id') id: string, @CurrentAuth() a: AuthContext) { return this.backups.requestRestore(id, a.userId); }
}

/** Google redirects the administrator's browser here; the one-time `state` ties it to that admin. */
@ApiTags('Platform · Backups')
@Controller({ path: 'backups/drive/oauth', version: '1' })
export class DriveOAuthCallbackController {
  constructor(private readonly drive: GoogleDriveBackupProvider, private readonly config: AppConfig) {}

  @Public() @Get('callback')
  async callback(@Query() q: CallbackQuery, @Res() res: Response) {
    const back = new URL('/super-admin/backups', this.config.get('WEB_PUBLIC_URL'));
    try {
      if (q.error || !q.code || !q.state) throw new Error(q.error === 'access_denied' ? 'Access was not granted' : 'Missing authorisation code');
      await this.drive.completeAuthorization(q.code, q.state);
      back.searchParams.set('drive', 'connected');
    } catch (e) {
      back.searchParams.set('drive', 'error');
      back.searchParams.set('message', String((e as Error).message).slice(0, 200));
    }
    res.redirect(302, back.toString());
  }
}
