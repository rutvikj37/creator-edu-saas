import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SUPPORTED_LOCALES } from '@ce/shared';
import { Public } from '../../common/decorators/public.decorator.js';
import { AppConfig } from '../../config/app-config.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';

/** Public bootstrap info the SPA needs before login (branding and locale support). */
@ApiTags('System')
@Public()
@Controller({ path: 'system', version: '1' })
export class SystemController {
  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  @Get('info')
  @ApiOperation({ summary: 'Public platform info (name, locales, root domain)' })
  async info() {
    const rows = await this.prisma.platformSetting.findMany({
      where: { group: 'branding', isSecret: false },
      select: { key: true, value: true },
    });
    const branding = Object.fromEntries(rows.map((r) => [r.key.replace(/^branding\./, ''), r.value]));
    return {
      name: (branding.name as string | undefined) ?? this.config.get('APP_NAME'),
      branding,
      rootDomain: this.config.get('PLATFORM_ROOT_DOMAIN'),
      locales: SUPPORTED_LOCALES,
      apiVersion: 'v1',
    };
  }
}
