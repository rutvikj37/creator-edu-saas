import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
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

class PartNumbersDto {
  @ApiProperty({ type: [Number] }) @IsArray() @ArrayMaxSize(100) @IsInt({ each: true }) @Min(1, { each: true }) @Max(10000, { each: true }) partNumbers: number[];
}
class PartDto {
  @ApiProperty() @IsInt() @Min(1) @Max(10000) partNumber: number;
  @ApiProperty() @IsString() @MaxLength(200) etag: string;
}
class CompletePartsDto {
  @ApiProperty({ type: [PartDto] }) @IsArray() @ArrayMaxSize(10000) @ValidateNested({ each: true }) @Type(() => PartDto) parts: PartDto[];
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

  @Post(':id/parts')
  @HttpCode(200)
  @ApiOperation({ summary: 'Signed URLs for multipart upload parts (S3, large videos)' })
  parts(@Param('id') id: string, @Body() dto: PartNumbersDto) {
    return this.files.signParts(id, dto.partNumbers);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify the uploaded object (size + content signature) and mark it ready' })
  async complete(@Param('id') id: string, @Body() body: Partial<CompletePartsDto>, @Req() req: AppRequest) {
    if (body?.parts?.length) await this.files.completeMultipart(id, body.parts);
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

  /** Supports HTTP Range so video players can seek (206 Partial Content). */
  @Get(':token')
  async get(@Param('token') token: string, @Query('download') download: string | undefined, @Req() req: Request, @Res() res: Response) {
    const t = this.storage.driver === 'local' ? this.storage.verifyLocalToken(token) : null;
    if (!t || t.op !== 'get') throw AppException.forbidden('Link is invalid or expired');
    let size: number;
    try {
      size = await this.storage.localSize(t.key);
    } catch {
      throw AppException.notFound('File not found');
    }
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${(t.name ?? 'file').replace(/"/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Accept-Ranges', 'bytes');
    if (t.type) res.setHeader('Content-Type', t.type);
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : size - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : size - 1;
      if (start < 0) start = 0;
      if (end >= size) end = size - 1;
      if (start > end || start >= size) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      this.storage.localReadStream(t.key, { start, end }).on('error', () => res.end()).pipe(res);
      return;
    }
    res.setHeader('Content-Length', String(size));
    this.storage.localReadStream(t.key).on('error', () => res.end()).pipe(res);
  }
}
