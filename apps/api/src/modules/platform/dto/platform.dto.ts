import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min,
  ValidateNested, IsDefined,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class TenantListQuery extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'PENDING_DELETION', 'DELETED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) planId?: string;
}

export class SuspendDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 255) reason: string;
}

export class DeleteTenantDto {
  @ApiProperty({ description: 'Must equal the tenant slug' }) @IsString() confirmSlug: string;
}

export class AssignPlanDto {
  @ApiProperty() @IsString() @Length(25, 25) planId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) planPriceId?: string;
}

export class FeatureValueDto {
  @ApiProperty() @IsString() @MaxLength(64) featureKey: string;
  @ApiProperty() @IsBoolean() enabled: boolean;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) limitValue?: number | null;
}

export class OverrideDto extends FeatureValueDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

export class LimitOverridesDto {
  @ApiProperty({ type: [OverrideDto] }) @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => OverrideDto) overrides: OverrideDto[];
}

export class PlanPriceDto {
  @ApiProperty({ enum: ['MONTH', 'YEAR'] }) @IsIn(['MONTH', 'YEAR']) interval: 'MONTH' | 'YEAR';
  @ApiProperty() @Matches(/^[A-Z]{3}$/) currency: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000) amount: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export class PlanDto {
  @ApiProperty() @Transform(trim) @Matches(/^[a-z0-9][a-z0-9-]{1,62}$/, { message: 'Lowercase letters, digits and hyphens' }) code: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 100) name: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] }) @IsIn(['DRAFT', 'ACTIVE', 'ARCHIVED']) status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  @ApiProperty() @IsBoolean() isPublic: boolean;
  @ApiProperty() @IsBoolean() isDefault: boolean;
  @ApiProperty() @IsInt() @Min(0) @Max(365) trialDays: number;
  @ApiProperty() @IsInt() @Min(0) @Max(1000) sortOrder: number;
  @ApiProperty({ type: [FeatureValueDto] }) @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => FeatureValueDto) features: FeatureValueDto[];
  @ApiProperty({ type: [PlanPriceDto] }) @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PlanPriceDto) prices: PlanPriceDto[];
}

export class SettingItemDto {
  @ApiProperty() @IsString() @MaxLength(128) key: string;
  @ApiProperty() @IsDefined() value: unknown;
}

export class UpdateSettingsDto {
  @ApiProperty({ type: [SettingItemDto] }) @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SettingItemDto) items: SettingItemDto[];
}

const ADMIN_ROLE_KEYS = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN'];

export class CreateAdminDto {
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() email: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) fullName: string;
  @ApiProperty({ enum: ADMIN_ROLE_KEYS, isArray: true }) @IsArray() @IsIn(ADMIN_ROLE_KEYS, { each: true }) @ArrayMaxSize(4) roles: string[];
}

export class UpdateAdminRolesDto {
  @ApiProperty({ enum: ADMIN_ROLE_KEYS, isArray: true }) @IsArray() @IsIn(ADMIN_ROLE_KEYS, { each: true }) @ArrayMaxSize(4) roles: string[];
}

export class AuditQuery extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) tenantId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) actorUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

export class DateRangeQuery {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

export class CategoryDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 100) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) parentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}

export class AnnouncementDto {
  @ApiProperty({ enum: ['CREATORS', 'STUDENTS', 'ALL'] }) @IsIn(['CREATORS', 'STUDENTS', 'ALL']) audience: 'CREATORS' | 'STUDENTS' | 'ALL';
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 160) title: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 5000) body: string;
  @ApiProperty({ enum: ['info', 'warning', 'success'] }) @IsIn(['info', 'warning', 'success']) tone: string;
  @ApiProperty() @IsDateString() startsAt: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsDateString() endsAt?: string | null;
}

export class TicketListQuery extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(['OPEN', 'PENDING', 'ON_HOLD', 'RESOLVED', 'CLOSED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']) priority?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['mine', 'unassigned', 'all']) view?: string;
}

export const TICKET_CATEGORIES = ['billing', 'technical', 'account', 'content', 'payments', 'other'] as const;

export class CreateTicketDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 200) subject: string;
  @ApiProperty({ enum: TICKET_CATEGORIES }) @IsIn(TICKET_CATEGORIES) category: string;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] }) @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']) priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 10000) body: string;
}

export const STUDENT_TICKET_CATEGORIES = ['course', 'payment', 'access', 'certificate', 'technical', 'other'] as const;

export class StudentTicketDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 200) subject: string;
  @ApiProperty({ enum: STUDENT_TICKET_CATEGORIES }) @IsIn(STUDENT_TICKET_CATEGORIES) category: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 5000) body: string;
}

export class StudentReplyDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 5000) body: string;
}

export class TicketReplyDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 10000) body: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() internal?: boolean;
}

export class TicketUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(['OPEN', 'PENDING', 'ON_HOLD', 'RESOLVED', 'CLOSED']) status?: 'OPEN' | 'PENDING' | 'ON_HOLD' | 'RESOLVED' | 'CLOSED';
  @ApiPropertyOptional() @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']) priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() assigneeId?: string | null;
}
