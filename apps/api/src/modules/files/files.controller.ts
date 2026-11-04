import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentAuth, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { AppException } from '../../common/errors/app-exception.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { FILE_RULES } from '../../core/storage/file-rules.js';
import type { AppRequest, AuthContext } from '../../core/tenancy/request-context.js';
import { FilesService } from './files.service.js';

export class BeginUploadDto {
  @ApiProperty({ enum: Object.keys(FILE_RULES) }) @IsIn(Object.keys(FILE_RULES)) purpose: string;
  @ApiProperty() @IsString() @MaxLength(255) fileName: string;
  @ApiProperty() @Matches(/^[\w.+-]+\/[\w.+-]+$/) mimeType: string;
  @ApiProperty() @IsInt() @Min(1) @Max(21_474_836_480) sizeBytes: number;
}

export const apiOrigin = (req: Request) => `${req.protocol}://${req.get('host')}`;

@ApiTags('Creator · Files')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/files', version: '1' })
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @ApiOperation({ summary: 'Begin an upload; returns a short-lived direct upload URL' })
  begin(@Body() dto: BeginUploadDto, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.files.begin({ ...dto, ownerUserId: auth.userId, apiOrigin: apiOrigin(req) });
  }

  @Post(':id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify the uploaded object (size + content signature) and mark it ready' })
  complete(@Param('id') id: string, @Req() req: AppRequest) {
    return this.files.complete(id, apiOrigin(req));
  }
}

/**
 * Development-only storage endpoints backing the 'local' driver. Access is granted solely by
 * the HMAC-signed, expiring token in the URL (same model as S3 presigned URLs).
 */
@ApiTags('Files (local driver)')
@Public()
@Controller({ path: 'files/local', version: '1' })
export class LocalStorageController {
  constructor(private readonly storage: StorageService) {}

  @Put(':token')
  @HttpCode(200)
  async put(@Param('token') token: string, @Req() req: Request) {
    const t = this.storage.driver === 'local' ? this.storage.verifyLocalToken(token) : null;
    if (!t || t.op !== 'put') throw AppException.forbidden('Upload link is invalid or expired');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > (t.size ?? 0)) throw AppException.validation([{ field: 'file', message: 'File larger than declared' }]);
      chunks.push(chunk as Buffer);
    }
    await this.storage.writeLocal(t.key, Buffer.concat(chunks));
    return { stored: true };
  }

  @Get(':token')
  get(@Param('token') token: string, @Query('download') download: string | undefined, @Res() res: Response) {
    const t = this.storage.driver === 'local' ? this.storage.verifyLocalToken(token) : null;
    if (!t || t.op !== 'get') throw AppException.forbidden('Link is invalid or expired');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${(t.name ?? 'file').replace(/"/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    this.storage.localReadStream(t.key).on('error', () => res.status(404).end()).pipe(res);
  }
}
