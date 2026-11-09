import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { ClientMetaParam, CurrentAuth, RequirePermissions, RequireRealm } from '../../common/decorators/auth.decorators.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import {
  EDITABLE_TEMPLATES, editableTemplate, missingRequired, renderContent, sampleVars, unknownPlaceholders,
  type EditableTemplate, type TemplateContent,
} from '../../core/mail/editable-templates.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import type { ClientMeta } from '../auth/services/session.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class TemplateContentDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) subject: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) heading: string;
  @ApiProperty() @IsString() @Length(1, 20000) body: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(60) ctaLabel?: string | null;
}

/** Wording of built-in transactional emails, editable by Super Admin. */
@ApiTags('Platform · Email templates')
@ApiBearerAuth()
@RequireRealm('PLATFORM')
@Controller({ path: 'platform/email-templates', version: '1' })
export class EmailTemplatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private find(key: string): EditableTemplate {
    const tpl = editableTemplate(key);
    if (!tpl) throw AppException.notFound('Email template not found');
    return tpl;
  }

  private validate(tpl: EditableTemplate, c: TemplateContent) {
    const errors = [
      ...unknownPlaceholders(c, tpl).map((v) => ({ field: 'body', message: `{{${v}}} is not available in this email` })),
      ...missingRequired(c, tpl).map((v) => ({ field: 'body', message: `Keep {{${v}}} in the message — the email is useless without it` })),
    ];
    if (errors.length) throw AppException.validation(errors);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PLATFORM_CONTENT_MANAGE)
  @ApiOperation({ summary: 'Built-in emails and whether each one has been reworded' })
  async list() {
    const rows = await this.prisma.emailTemplateOverride.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return EDITABLE_TEMPLATES.map((t) => {
      const o = byKey.get(t.key);
      return { key: t.key, name: t.name, description: t.description, subject: o?.subject ?? t.defaults.subject, customized: Boolean(o), updatedAt: o?.updatedAt ?? null };
    });
  }

  @Get(':key')
  @RequirePermissions(PERMISSIONS.PLATFORM_CONTENT_MANAGE)
  @ApiOperation({ summary: 'One email: variables, built-in wording and the current override' })
  async get(@Param('key') key: string) {
    const tpl = this.find(key);
    const o = await this.prisma.emailTemplateOverride.findUnique({ where: { key } });
    const content = o ? { subject: o.subject, heading: o.heading, body: o.body, ctaLabel: o.ctaLabel } : { ...tpl.defaults, ctaLabel: tpl.defaults.ctaLabel ?? null };
    return {
      key: tpl.key, name: tpl.name, description: tpl.description, variables: tpl.variables, required: tpl.required, hasButton: Boolean(tpl.ctaVar),
      defaults: tpl.defaults, content, customized: Boolean(o), updatedAt: o?.updatedAt ?? null,
    };
  }

  @Put(':key')
  @RequirePermissions(PERMISSIONS.PLATFORM_CONTENT_MANAGE)
  @ApiOperation({ summary: 'Save new wording for an email' })
  async save(@Param('key') key: string, @Body() dto: TemplateContentDto, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    const tpl = this.find(key);
    this.validate(tpl, dto);
    const data = { subject: dto.subject, heading: dto.heading, body: dto.body.replace(/\r\n/g, '\n'), ctaLabel: dto.ctaLabel || null, updatedById: auth.userId };
    const before = await this.prisma.emailTemplateOverride.findUnique({ where: { key } });
    await this.prisma.emailTemplateOverride.upsert({ where: { key }, update: data, create: { key, ...data } });
    this.mail.invalidateOverrides();
    await this.audit.record({ action: 'email_template.update', actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'EmailTemplate', targetId: key, before, after: data, ip: meta.ip, userAgent: meta.userAgent });
    return this.get(key);
  }

  @Delete(':key')
  @RequirePermissions(PERMISSIONS.PLATFORM_CONTENT_MANAGE)
  @ApiOperation({ summary: 'Go back to the built-in wording' })
  async reset(@Param('key') key: string, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    this.find(key);
    const before = await this.prisma.emailTemplateOverride.findUnique({ where: { key } });
    if (before) {
      await this.prisma.emailTemplateOverride.delete({ where: { key } });
      this.mail.invalidateOverrides();
      await this.audit.record({ action: 'email_template.reset', actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'EmailTemplate', targetId: key, before, ip: meta.ip, userAgent: meta.userAgent });
    }
    return this.get(key);
  }

  @Post(':key/preview')
  @RequirePermissions(PERMISSIONS.PLATFORM_CONTENT_MANAGE)
  @ApiOperation({ summary: 'Render unsaved wording with sample values' })
  preview(@Param('key') key: string, @Body() dto: TemplateContentDto) {
    const tpl = this.find(key);
    this.validate(tpl, dto);
    return renderContent(tpl, dto, sampleVars(tpl));
  }

  @Post(':key/test')
  @RequirePermissions(PERMISSIONS.PLATFORM_CONTENT_MANAGE)
  @ApiOperation({ summary: 'Email the unsaved wording, filled with sample values, to yourself' })
  async test(@Param('key') key: string, @Body() dto: TemplateContentDto, @CurrentAuth() auth: AuthContext) {
    const tpl = this.find(key);
    this.validate(tpl, dto);
    const me = await this.prisma.user.findUnique({ where: { id: auth.userId }, select: { email: true } });
    if (!me) throw AppException.notFound('User not found');
    const r = renderContent(tpl, dto, sampleVars(tpl));
    await this.mail.send({ to: me.email, tag: `template-test-${key}`, subject: `[Test] ${r.subject}`, html: r.html, text: r.text });
    return { sentTo: me.email };
  }
}
