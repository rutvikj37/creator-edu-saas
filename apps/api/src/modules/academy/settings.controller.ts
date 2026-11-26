import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { AppException } from '../../common/errors/app-exception.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AcademyPreferencesService, PREFERENCE_SECTIONS, TOGGLEABLE_EMAILS, type PreferenceSection } from '../../core/settings/academy-preferences.service.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { FIELD_TYPES, fieldView, fieldsForLearner, saveFieldValues } from './custom-fields.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class CustomFieldDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) label: string;
  @ApiProperty({ enum: FIELD_TYPES }) @IsIn(FIELD_TYPES as unknown as string[]) type: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(80, { each: true }) options?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional({ description: 'Learners can change their answer later' }) @IsOptional() @IsBoolean() editable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showInSignup?: boolean;
  @ApiPropertyOptional({ description: 'Ask before a learner opens a course for the first time' }) @IsOptional() @IsBoolean() askBeforeCourse?: boolean;
}
class UpdateCustomFieldDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 80) label?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(80, { each: true }) options?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() editable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showInSignup?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() askBeforeCourse?: boolean;
}
class OrderDto { @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @Length(25, 25, { each: true }) ids: string[]; }

const MAX_FIELDS = 20;

/** Settings → Communications, User experience, Signup & login (stored per academy). */
@ApiTags('Creator · Settings')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/settings', version: '1' })
export class CreatorSettingsController {
  constructor(private readonly prefs: AcademyPreferencesService, private readonly ctx: TenantContext, private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private section(s: string): PreferenceSection {
    if (!PREFERENCE_SECTIONS.includes(s as PreferenceSection)) throw AppException.notFound();
    return s as PreferenceSection;
  }

  @Get('preferences/:section') @RequirePermissions(PERMISSIONS.ACADEMY_MANAGE)
  async getPreferences(@Param('section') section: string) {
    const s = this.section(section);
    const value = await this.prefs.get(this.ctx.requireTenantId(), s);
    return s === 'communications' ? { ...value, emailTypes: TOGGLEABLE_EMAILS } : value;
  }

  @Put('preferences/:section') @RequirePermissions(PERMISSIONS.ACADEMY_MANAGE)
  @ApiOperation({ summary: 'Save communications, user experience or signup & login settings (fields not sent stay as they are)' })
  async savePreferences(@Param('section') section: string, @Body() body: Record<string, unknown>, @CurrentAuth() auth: AuthContext) {
    const s = this.section(section);
    const tenantId = this.ctx.requireTenantId();
    const { emailTypes: _ignored, ...input } = (body ?? {}) as Record<string, unknown>;
    const value = await this.prefs.save(tenantId, s, input as never);
    await this.audit.record({ action: `settings.${s}.update`, tenantId, actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'Tenant', targetId: tenantId, after: value as never });
    return s === 'communications' ? { ...value, emailTypes: TOGGLEABLE_EMAILS } : value;
  }

  // ── custom fields ─────────────────────────────────────────
  @Get('custom-fields') @RequirePermissions(PERMISSIONS.STUDENTS_READ)
  async fields() {
    const rows = await this.prisma.customField.findMany({ where: { tenantId: this.ctx.requireTenantId() }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(fieldView);
  }

  @Post('custom-fields') @RequirePermissions(PERMISSIONS.ACADEMY_MANAGE)
  async createField(@Body() dto: CustomFieldDto, @CurrentAuth() auth: AuthContext) {
    const tenantId = this.ctx.requireTenantId();
    const count = await this.prisma.customField.count({ where: { tenantId } });
    if (count >= MAX_FIELDS) throw AppException.conflict(`You can add up to ${MAX_FIELDS} custom fields.`);
    const options = cleanOptions(dto.type, dto.options);
    const f = await this.prisma.customField.create({
      data: { tenantId, label: dto.label, type: dto.type, options: options as never, required: dto.required ?? false, editable: dto.editable ?? true, showInSignup: dto.showInSignup ?? true, askBeforeCourse: dto.askBeforeCourse ?? false, position: count },
    });
    await this.audit.record({ action: 'custom_field.create', tenantId, actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'CustomField', targetId: f.id, after: { label: f.label, type: f.type } });
    return fieldView(f);
  }

  @Put('custom-fields/order') @RequirePermissions(PERMISSIONS.ACADEMY_MANAGE)
  async reorder(@Body() dto: OrderDto) {
    const tenantId = this.ctx.requireTenantId();
    for (const [i, id] of dto.ids.entries()) await this.prisma.customField.updateMany({ where: { tenantId, id }, data: { position: i } });
    return this.fields();
  }

  @Patch('custom-fields/:id') @RequirePermissions(PERMISSIONS.ACADEMY_MANAGE)
  async updateField(@Param('id') id: string, @Body() dto: UpdateCustomFieldDto) {
    const tenantId = this.ctx.requireTenantId();
    const f = await this.prisma.customField.findFirst({ where: { tenantId, id } });
    if (!f) throw AppException.notFound('Field not found');
    const data: Record<string, unknown> = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    if (dto.options) data.options = cleanOptions(f.type, dto.options) as never;
    return fieldView(await this.prisma.customField.update({ where: { id }, data }));
  }

  @Delete('custom-fields/:id') @HttpCode(200) @RequirePermissions(PERMISSIONS.ACADEMY_MANAGE)
  async deleteField(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    const tenantId = this.ctx.requireTenantId();
    const f = await this.prisma.customField.findFirst({ where: { tenantId, id } });
    if (!f) throw AppException.notFound('Field not found');
    await this.prisma.customField.delete({ where: { id } });
    await this.audit.record({ action: 'custom_field.delete', tenantId, actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'CustomField', targetId: id, before: { label: f.label } });
    return { deleted: true };
  }

  @Get('custom-fields/answers/:userId') @RequirePermissions(PERMISSIONS.STUDENTS_READ)
  async answers(@Param('userId') userId: string) {
    return (await fieldsForLearner(this.prisma, this.ctx.requireTenantId(), userId)).fields;
  }
}

function cleanOptions(type: string, options?: string[]) {
  if (type !== 'SELECT') return null;
  const list = [...new Set((options ?? []).map((o) => o.trim()).filter(Boolean))];
  if (list.length < 2) throw AppException.validation([{ field: 'options', message: 'Add at least two choices' }]);
  return list;
}

/** Learners answer the academy's custom fields from their profile or before opening a course. */
@ApiTags('Student · Profile')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'learn/custom-fields', version: '1' })
export class LearnCustomFieldsController {
  constructor(private readonly prisma: PrismaService, private readonly ctx: TenantContext) {}

  @Get()
  mine(@CurrentAuth() auth: AuthContext) { return fieldsForLearner(this.prisma, this.ctx.requireTenantId(), auth.userId); }

  @Put()
  async save(@Body() body: { values?: Record<string, unknown> }, @CurrentAuth() auth: AuthContext) {
    const tenantId = this.ctx.requireTenantId();
    if (!body?.values || typeof body.values !== 'object' || Array.isArray(body.values)) throw AppException.validation([{ field: 'values', message: 'Send your answers' }]);
    await saveFieldValues(this.prisma, tenantId, auth.userId, body.values, 'profile');
    return fieldsForLearner(this.prisma, tenantId, auth.userId);
  }
}
