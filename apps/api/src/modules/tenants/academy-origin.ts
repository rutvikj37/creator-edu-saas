import type { AppConfig } from '../../config/app-config.service.js';
import type { PrismaService } from '../../core/prisma/prisma.service.js';

/** Public base URL of an academy: its primary address (platform subdomain or verified own domain). */
export async function academyOrigin(prisma: PrismaService, config: AppConfig, tenantId: string) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true, name: true, domains: { where: { status: 'VERIFIED', isPrimary: true }, take: 1, select: { hostname: true } } } });
  const web = new URL(config.get('WEB_PUBLIC_URL'));
  const root = config.get('PLATFORM_ROOT_DOMAIN');
  const primary = t.domains[0]?.hostname ?? `${t.slug}.${root}`;
  const origin = primary.endsWith(`.${root}`) ? `${web.protocol}//${primary}${web.port ? `:${web.port}` : ''}` : `https://${primary}`;
  return { origin, name: t.name };
}
