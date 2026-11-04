import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** Password policy (NIST 800-63B style): length over complexity, max to bound hashing cost. */
export const PASSWORD_RULE = { min: 10, max: 128 };

export class RegisterCreatorDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) fullName: string;
  @ApiProperty() @Transform(lower) @IsEmail({}, { message: 'Enter a valid email address' }) @MaxLength(191) email: string;
  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional() @Transform(trim) @Matches(/^\+[1-9]\d{7,14}$/, { message: 'Use international format, e.g. +919876543210' })
  phone?: string;
  @ApiProperty() @IsString() @MinLength(PASSWORD_RULE.min, { message: `Password must be at least ${PASSWORD_RULE.min} characters` }) @MaxLength(PASSWORD_RULE.max) password: string;
  @ApiProperty({ example: 'IN' }) @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @Matches(/^[A-Z]{2}$/, { message: 'Select a country' }) country: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) businessName: string;
}

export class RegisterStudentDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) fullName: string;
  @ApiProperty() @Transform(lower) @IsEmail({}, { message: 'Enter a valid email address' }) @MaxLength(191) email: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @Matches(/^\+[1-9]\d{7,14}$/, { message: 'Use international format, e.g. +919876543210' }) phone?: string;
  @ApiProperty() @IsString() @MinLength(PASSWORD_RULE.min, { message: `Password must be at least ${PASSWORD_RULE.min} characters` }) @MaxLength(PASSWORD_RULE.max) password: string;
}

export class LoginDto {
  @ApiProperty() @Transform(lower) @IsEmail({}, { message: 'Enter a valid email address' }) email: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(PASSWORD_RULE.max) password: string;
}

export class MfaLoginDto {
  @ApiProperty() @IsString() mfaToken: string;
  @ApiProperty() @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' }) code: string;
}

export class TokenDto {
  @ApiProperty() @IsString() @Length(20, 200) token: string;
}

export class CodeDto {
  @ApiProperty() @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' }) code: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @Transform(lower) @IsEmail({}, { message: 'Enter a valid email address' }) email: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @Length(20, 200) token: string;
  @ApiProperty() @IsString() @MinLength(PASSWORD_RULE.min, { message: `Password must be at least ${PASSWORD_RULE.min} characters` }) @MaxLength(PASSWORD_RULE.max) password: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MaxLength(PASSWORD_RULE.max) currentPassword: string;
  @ApiProperty() @IsString() @MinLength(PASSWORD_RULE.min, { message: `Password must be at least ${PASSWORD_RULE.min} characters` }) @MaxLength(PASSWORD_RULE.max) newPassword: string;
}

export class SendOtpDto {
  @ApiProperty({ enum: ['EMAIL_VERIFY', 'PHONE_VERIFY'] }) @IsIn(['EMAIL_VERIFY', 'PHONE_VERIFY']) purpose: 'EMAIL_VERIFY' | 'PHONE_VERIFY';
}

export class DisableMfaDto {
  @ApiProperty() @IsString() @MaxLength(PASSWORD_RULE.max) password: string;
  @ApiProperty() @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' }) code: string;
}

export class SwitchTenantDto {
  @ApiProperty() @IsString() @Length(25, 25) tenantId: string;
}

export class HandoffDto {
  @ApiProperty() @IsString() @Length(20, 100) code: string;
}
