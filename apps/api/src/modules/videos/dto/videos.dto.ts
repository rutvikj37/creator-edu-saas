import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class InitiateUploadDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) title: string;
  @ApiProperty({ description: 'Original file name (sanitised server-side)' }) @IsString() @Length(1, 255) filename: string;
  @ApiProperty({ description: 'File size in bytes' }) @Type(() => Number) @IsInt() @Min(1) size: number;
  @ApiProperty({ example: 'video/mp4' }) @IsString() @MaxLength(127) mimeType: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) courseId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) lessonId?: string | null;
  @ApiPropertyOptional({ description: 'Retry the upload of this existing video' }) @IsOptional() @IsString() @Length(25, 25) videoId?: string | null;
}

export class CompleteUploadDto {
  @ApiProperty() @IsString() @Length(25, 25) videoId: string;
  @ApiProperty() @IsString() @Length(25, 25) uploadSessionId: string;
  @ApiProperty({ enum: ['started', 'success', 'failed', 'cancelled'] }) @IsIn(['started', 'success', 'failed', 'cancelled']) outcome: 'started' | 'success' | 'failed' | 'cancelled';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) error?: string;
}

export class ListVideosQuery {
  @IsOptional() @IsIn(['CREATED', 'UPLOAD_AUTHORIZED', 'UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'DELETING']) status?: string;
  @IsOptional() @IsString() @Length(25, 25) courseId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class UpdateVideoDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(86400) durationSeconds?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @Length(25, 25) courseId?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Assign to this video lesson (null detaches the library link)' }) @IsOptional() @IsString() @Length(25, 25) lessonId?: string | null;
}

export class PlaybackAuthorizeDto {
  @ApiProperty() @IsString() @Length(25, 25) lessonId: string;
}

export class HeartbeatDto {
  @ApiProperty() @IsNumber() @Min(0) @Max(864000) positionSeconds: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) @Max(86400) durationSeconds?: number;
}
