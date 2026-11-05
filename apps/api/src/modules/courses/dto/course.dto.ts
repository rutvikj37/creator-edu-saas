import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUrl, Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CourseListQuery extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(['DRAFT', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED']) status?: string;
}

export class CreateCourseDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) title: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) shortDescription?: string;
}

export class UpdateCourseDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(3, 200) title?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z0-9](?:[a-z0-9-]{1,218}[a-z0-9])$/, { message: 'Lowercase letters, digits and hyphens' }) slug?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) shortDescription?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() description?: Record<string, unknown> | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) thumbnailFileId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) bannerFileId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) categorySlug?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z]{2}(-[A-Z]{2})?$/) language?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ALL_LEVELS']) level?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'ALL_LEVELS';
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(200, { each: true }) objectives?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(200, { each: true }) prerequisites?: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) durationMinutes?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isFree?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) priceAmount?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) compareAtAmount?: number | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['PUBLIC', 'UNLISTED', 'PRIVATE']) visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  @ApiPropertyOptional() @IsOptional() @IsIn(['LIFETIME', 'FIXED_DAYS', 'FIXED_DATE']) accessType?: 'LIFETIME' | 'FIXED_DAYS' | 'FIXED_DATE';
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(3650) accessDays?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() accessUntil?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsIn(['NONE', 'DAYS_AFTER_ENROLL', 'DATE']) dripType?: 'NONE' | 'DAYS_AFTER_ENROLL' | 'DATE';
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100) completionPercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() certificateEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(70) seoTitle?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(170) seoDescription?: string | null;
}

export class PublishCourseDto {
  @ApiPropertyOptional({ description: 'Schedule for later instead of publishing now' }) @IsOptional() @IsDateString() publishAt?: string;
}

export class SectionDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(3650) dripOffsetDays?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() unlockAt?: string | null;
}

export const LESSON_TYPES = ['VIDEO', 'AUDIO', 'PDF', 'DOCUMENT', 'TEXT', 'IMAGE', 'LINK', 'QUIZ', 'ASSIGNMENT', 'LIVE', 'DOWNLOAD'] as const;

export class CreateLessonDto {
  @ApiProperty() @IsString() @Length(25, 25) sectionId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) parentLessonId?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) title: string;
  @ApiProperty({ enum: LESSON_TYPES }) @IsIn(LESSON_TYPES) type: (typeof LESSON_TYPES)[number];
}

export class UpdateLessonDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() content?: Record<string, unknown> | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) fileAssetId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) videoAssetId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https', 'http'], require_protocol: true }) @MaxLength(1000) externalUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(86400 * 10) durationSeconds?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isFreePreview?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublished?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRequired?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(3650) dripOffsetDays?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() unlockAt?: string | null;
}

export class OrderLessonDto {
  @ApiProperty() @IsString() @Length(25, 25) id: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) children?: string[];
}

export class OrderSectionDto {
  @ApiProperty() @IsString() @Length(25, 25) id: string;
  @ApiProperty({ type: [OrderLessonDto] }) @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => OrderLessonDto) lessons: OrderLessonDto[];
}

export class CurriculumOrderDto {
  @ApiProperty({ type: [OrderSectionDto] }) @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => OrderSectionDto) sections: OrderSectionDto[];
}

export class InstructorsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) userIds: string[];
}
