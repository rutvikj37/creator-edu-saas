import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsObject, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { FEATURES, PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequireFeature, RequirePermissions, TenantScoped } from '../../common/decorators/auth.decorators.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { AutomationsService, TRIGGERS } from './automations.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
class AutomationDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(TRIGGERS as unknown as string[]) trigger?: string;
  @IsOptional() @IsObject() filter?: { courseId?: string | null } | null;
  @IsOptional() @IsArray() steps?: any[];
  @IsOptional() @IsIn(['ACTIVE', 'PAUSED']) status?: 'ACTIVE' | 'PAUSED';
}
class CreateAutomationDto extends AutomationDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) declare name: string;
  @ApiProperty({ enum: TRIGGERS }) @IsIn(TRIGGERS as unknown as string[]) declare trigger: string;
  @ApiProperty() @IsArray() declare steps: any[];
}

@ApiTags('Creator · Automations')
@ApiBearerAuth()
@TenantScoped('workspace')
@RequireFeature(FEATURES.MARKETING.key)
@Controller({ path: 'creator/automations', version: '1' })
export class CreatorAutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get() @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  list() { return this.automations.list(); }

  @Post() @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  create(@Body() dto: CreateAutomationDto, @CurrentAuth() auth: AuthContext) { return this.automations.create(dto, auth.userId); }

  @Get(':id') @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  get(@Param('id') id: string) { return this.automations.get(id); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  update(@Param('id') id: string, @Body() dto: AutomationDto, @CurrentAuth() auth: AuthContext) { return this.automations.update(id, dto as never, auth.userId); }

  @Delete(':id') @RequirePermissions(PERMISSIONS.MARKETING_MANAGE)
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.automations.remove(id, auth.userId); }
}
