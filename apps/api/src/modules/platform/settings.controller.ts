import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@ce/shared';
import { ClientMetaParam, CurrentAuth, RequirePermissions, RequireRealm } from '../../common/decorators/auth.decorators.js';
import { AppException, type FieldError } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { CryptoService } from '../../core/crypto/crypto.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import type { ClientMeta } from '../auth/services/session.service.js';
import { UpdateSettingsDto } from './dto/platform.dto.js';
import { SETTING_GROUPS, SETTINGS, SETTINGS_BY_KEY } from './settings.registry.js';

@ApiTags('Platform · Settings')
@ApiBearerAuth()
@RequireRealm('PLATFORM')
@Controller({ path: 'platform/settings', version: '1' })
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PLATFORM_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'All editable settings grouped; secret values are masked' })
  async list() {
    const rows = await this.prisma.platformSetting.findMany({ where: { key: { in: SETTINGS.map((s) => s.key) } } });
    const values = new Map(rows.map((r) => [r.key, r]));
    return SETTING_GROUPS.map((group) => ({
      group,
      items: SETTINGS.filter((s) => s.group === group).map((s) => {
        const row = values.get(s.key);
        return { key: s.key, label: s.label, secret: Boolean(s.secret), value: s.secret ? (row ? '••••••••' : null) : (row?.value ?? null), updatedAt: row?.updatedAt ?? null };
      }),
    }));
  }

  @Put()
  @RequirePermissions(PERMISSIONS.PLATFORM_SETTINGS_MANAGE)
  async update(@Body() dto: UpdateSettingsDto, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    const errors: FieldError[] = [];
    const parsed: Array<{ key: string; group: string; value: unknown; secret: boolean }> = [];
    for (const item of dto.items) {
      const def = SETTINGS_BY_KEY.get(item.key);
      if (!def) {
        errors.push({ field: item.key, message: 'Unknown setting' });
        continue;
      }
      const r = def.schema.safeParse(item.value);
      if (!r.success) errors.push({ field: item.key, message: r.error.issues[0]?.message ?? 'Invalid value' });
      else parsed.push({ key: def.key, group: def.group, value: r.data, secret: Boolean(def.secret) });
    }
    if (errors.length) throw AppException.validation(errors);

    const before = await this.prisma.platformSetting.findMany({ where: { key: { in: parsed.map((p) => p.key) } } });
    await this.prisma.$transaction(
      parsed.map((p) => {
        const value = (p.secret ? this.crypto.encrypt(JSON.stringify(p.value)) : p.value) as never;
        return this.prisma.platformSetting.upsert({
          where: { key: p.key },
          update: { value, isSecret: p.secret, updatedBy: auth.userId },
          create: { key: p.key, group: p.group, value, isSecret: p.secret, updatedBy: auth.userId },
        });
      }),
    );
    await this.audit.record({
      action: 'settings.update', actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'PlatformSetting',
      before: Object.fromEntries(before.map((b) => [b.key, b.isSecret ? '[secret]' : b.value])),
      after: Object.fromEntries(parsed.map((p) => [p.key, p.secret ? '[secret]' : p.value])),
      ip: meta.ip, userAgent: meta.userAgent,
    });
    return this.list();
  }
}
