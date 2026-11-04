import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsInt, IsObject, IsOptional, IsString, IsUrl, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const hex = /^#[0-9a-fA-F]{6}$/;
export const FONT_CHOICES = ['Inter', 'Poppins', 'Roboto', 'Lato', 'Merriweather', 'Playfair Display', 'Noto Sans', 'Mukta', 'Hind Vadodara'];

export class SocialLinksDto {
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) website?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) youtube?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) instagram?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) linkedin?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) x?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) facebook?: string;
}

export class UpdateAcademyDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 120) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(160) tagline?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(5000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) categorySlug?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) logoFileId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) faviconFileId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsEmail() supportEmail?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsObject() @ValidateNested() @Type(() => SocialLinksDto) socialLinks?: SocialLinksDto;
  @ApiPropertyOptional() @IsOptional() @Matches(hex, { message: 'Use a hex colour like #4f46e5' }) primaryColor?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(hex, { message: 'Use a hex colour like #0d9488' }) accentColor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fontHeading?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fontBody?: string;
}

export class UpdateBusinessDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(200) legalName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(200) addressLine1?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(200) addressLine2?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) state?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(20) postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() gstRegistered?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @Matches(/^([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])?$/, { message: 'Invalid GSTIN format' }) gstin?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @Matches(/^([A-Z]{5}[0-9]{4}[A-Z])?$/, { message: 'Invalid PAN format' }) pan?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z0-9-]{1,12}$/, { message: 'Up to 12 letters, digits or hyphens' }) invoicePrefix?: string;
}

export class OnboardingStepDto {
  @ApiPropertyOptional() @IsInt() @Min(1) @Max(10) step: number;
}
