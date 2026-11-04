import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const QUESTION_TYPES = ['MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE', 'FILL_BLANK', 'SHORT', 'LONG', 'MATCHING', 'FILE_UPLOAD'] as const;

export class QuizSettingsDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(5000) instructions?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(30) @Max(86400) timeLimitSeconds?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) passPercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1) negativeMarkRatio?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100) maxAttempts?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() shuffleQuestions?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() shuffleOptions?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(500) randomPickCount?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showResults?: boolean;
}

export class OptionDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 1000) label: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isCorrect?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) matchKey?: string | null;
}

export class QuestionDto {
  @ApiProperty({ enum: QUESTION_TYPES }) @IsIn(QUESTION_TYPES) type: (typeof QUESTION_TYPES)[number];
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 5000) prompt: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(5000) explanation?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.25) @Max(1000) points?: number;
  @ApiPropertyOptional({ type: [OptionDto] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => OptionDto) options?: OptionDto[];
  @ApiPropertyOptional() @IsOptional() @IsObject() meta?: { answers?: string[]; caseSensitive?: boolean } | null;
}

export class OrderDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) ids: string[];
}

export class AnswerDto {
  @ApiProperty() @IsString() @Length(25, 25) questionId: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() response?: Record<string, unknown> | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) fileAssetId?: string | null;
}

export class ManualGradeItemDto {
  @ApiProperty() @IsString() @Length(25, 25) questionId: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) points: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(5000) feedback?: string;
}

export class ManualGradeDto {
  @ApiProperty({ type: [ManualGradeItemDto] }) @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ManualGradeItemDto) grades: ManualGradeItemDto[];
}

export class AssignmentSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsObject() instructions?: Record<string, unknown> | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) maxPoints?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowLate?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowFiles?: boolean;
}

export class SubmitAssignmentDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(20000) text?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) fileAssetIds?: string[];
}

export class GradeSubmissionDto {
  @ApiProperty() @IsInt() @Min(0) points: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(10000) feedback?: string;
  @ApiProperty({ enum: ['GRADED', 'RETURNED'] }) @IsIn(['GRADED', 'RETURNED']) status: 'GRADED' | 'RETURNED';
}
