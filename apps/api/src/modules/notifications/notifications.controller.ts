import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import { CurrentAuth } from '../../common/decorators/auth.decorators.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { NotificationsService } from './notifications.service.js';

class PrefDto {
  @ApiProperty() @IsString() @MaxLength(32) category: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() email?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sms?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() whatsapp?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() push?: boolean;
}
class PrefsDto {
  @ApiProperty({ type: [PrefDto] }) @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PrefDto) items: PrefDto[];
}
class PushKeysDto {
  @IsString() @Length(10, 200) p256dh: string;
  @IsString() @Length(4, 100) auth: string;
}
class PushSubDto {
  @ApiProperty() @IsString() @Length(10, 700) endpoint: string;
  @ApiProperty() @ValidateNested() @Type(() => PushKeysDto) keys: PushKeysDto;
}
class PushUnsubDto {
  @ApiProperty() @IsString() @Length(10, 700) endpoint: string;
}

/** The signed-in user's notifications (works on platform and academy hosts). */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query('cursor') cursor?: string) { return this.notifications.list(auth.userId, cursor?.slice(0, 25)); }

  @Post(':id/read') @HttpCode(200)
  read(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.notifications.markRead(auth.userId, id); }

  @Post('read-all') @HttpCode(200)
  readAll(@CurrentAuth() auth: AuthContext) { return this.notifications.markAllRead(auth.userId); }

  @Get('preferences')
  prefs(@CurrentAuth() auth: AuthContext) { return this.notifications.preferences(auth.userId); }

  @Put('preferences')
  setPrefs(@Body() dto: PrefsDto, @CurrentAuth() auth: AuthContext) { return this.notifications.setPreferences(auth.userId, dto.items); }

  @Post('push/subscriptions') @HttpCode(200)
  subscribe(@Body() dto: PushSubDto, @CurrentAuth() auth: AuthContext, @Req() req: Request) {
    return this.notifications.subscribePush(auth.userId, { endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth }, req.get('user-agent'));
  }

  @Delete('push/subscriptions')
  unsubscribe(@Body() dto: PushUnsubDto, @CurrentAuth() auth: AuthContext) { return this.notifications.unsubscribePush(auth.userId, dto.endpoint); }
}
