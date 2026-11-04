import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@ce/shared';
import { ClientMetaParam, CurrentAuth, RequirePermissions, RequireRealm } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import type { ClientMeta } from '../auth/services/session.service.js';
import { slugify } from '../tenants/slug.js';
import { AnnouncementDto, CategoryDto } from './dto/platform.dto.js';

/** Platform course categories and announcements. */
@ApiTags('Platform · Content')
@ApiBearerAuth()
@Controller({ version: '1' })
export class ContentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── categories ────────────────────────────────────────────
  @Public()
  @Get('public/categories')
  @ApiOperation({ summary: 'Platform course categories' })
  categories() {
    return this.prisma.courseCategory.findMany({ where: { scopeKey: 'platform' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, slug: true, parentId: true, sortOrder: true } });
  }

  @Post('platform/categories')
  @RequireRealm('PLATFORM')
  @RequirePermissions(PERMISSIONS.PLATFORM_CONTENT_MANAGE)
  async createCategory(@Body() dto: CategoryDto, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    const slug = slugify(dto.name);
    if (await this.prisma.courseCategory.findUnique({ where: { scopeKey_slug: { scopeKey: 'platform', slug } } })) throw AppException.conflict('A category with this name already exists.');
    if (dto.parentId && !(await this.prisma.courseCategory.findFirst({ where: { id: dto.parentId, scopeKey: 'platform' } }))) throw AppException.validation([{ field: 'parentId', message: 'Parent not found' }]);
    const c = await this.prisma.courseCategory.create({ data: { scopeKey: 'platform', name: dto.name, slug, parentId: dto.parentId ?? null, sortOrder: dto.sortOrder ?? 0 } });
    await this.audit.record({ action: 'category.create', actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'CourseCategory', targetId: c.id, after: dto, ip: meta.ip, userAgent: meta.userAgent });
    return c;
  }

  @Put('platform/categories/:id')
  @RequireRealm('PLATFORM')
  @RequirePermissions(PERMISSIONS.PLATFORM_CONTENT_MANAGE)
  async updateCategory(@Param('id') id: string, @Body() dto: CategoryDto, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    const c = await this.prisma.courseCategory.findFirst({ where: { id, scopeKey: 'platform' } });
    if (!c) throw AppException.notFound('Category not found');
    if (dto.parentId === id) throw AppException.validation([{ field: 'parentId', message: 'A category cannot be its own parent' }]);
    const updated = await this.prisma.courseCategory.update({ where: { id }, data: { name: dto.name, slug: slugify(dto.name), parentId: dto.parentId ?? null, sortOrder: dto.sortOrder ?? c.sortOrder } });
    await this.audit.record({ action: 'category.update', actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'CourseCategory', targetId: id, before: c, after: dto, ip: meta.ip, userAgent: meta.userAgent });
    return updated;
  }

  @Delete('platform/categories/:id')
  @RequireRealm('PLATFORM')
  @RequirePermissions(PERMISSIONS.PLATFORM_CONTENT_MANAGE)
  async deleteCategory(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    const c = await this.prisma.courseCategory.findFirst({ where: { id, scopeKey: 'platform' } });
    if (!c) throw AppException.notFound('Category not found');
    await this.prisma.courseCategory.delete({ where: { id } });
    await this.audit.record({ action: 'category.delete', actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'CourseCategory', targetId: id, before: c, ip: meta.ip, userAgent: meta.userAgent });
    return { deleted: true };
  }

  // ── announcements ─────────────────────────────────────────
  @Get('platform/announcements')
  @RequireRealm('PLATFORM')
  @RequirePermissions(PERMISSIONS.PLATFORM_CONTENT_MANAGE)
  listAnnouncements() {
    return this.prisma.announcement.findMany({ orderBy: { startsAt: 'desc' } });
  }

  private validateWindow(dto: AnnouncementDto) {
    if (dto.endsAt && new Date(dto.endsAt) <= new Date(dto.startsAt)) throw AppException.validation([{ field: 'endsAt', message: 'End must be after start' }]);
  }

  @Post('platform/announcements')
  @RequireRealm('PLATFORM')
  @RequirePermissions(PERMISSIONS.PLATFORM_CONTENT_MANAGE)
  async createAnnouncement(@Body() dto: AnnouncementDto, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    this.validateWindow(dto);
    const a = await this.prisma.announcement.create({ data: { ...dto, startsAt: new Date(dto.startsAt), endsAt: dto.endsAt ? new Date(dto.endsAt) : null, createdBy: auth.userId } });
    await this.audit.record({ action: 'announcement.create', actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'Announcement', targetId: a.id, after: dto, ip: meta.ip, userAgent: meta.userAgent });
    return a;
  }

  @Put('platform/announcements/:id')
  @RequireRealm('PLATFORM')
  @RequirePermissions(PERMISSIONS.PLATFORM_CONTENT_MANAGE)
  async updateAnnouncement(@Param('id') id: string, @Body() dto: AnnouncementDto, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    this.validateWindow(dto);
    if (!(await this.prisma.announcement.findUnique({ where: { id } }))) throw AppException.notFound('Announcement not found');
    const a = await this.prisma.announcement.update({ where: { id }, data: { ...dto, startsAt: new Date(dto.startsAt), endsAt: dto.endsAt ? new Date(dto.endsAt) : null } });
    await this.audit.record({ action: 'announcement.update', actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'Announcement', targetId: id, after: dto, ip: meta.ip, userAgent: meta.userAgent });
    return a;
  }

  @Delete('platform/announcements/:id')
  @RequireRealm('PLATFORM')
  @RequirePermissions(PERMISSIONS.PLATFORM_CONTENT_MANAGE)
  async deleteAnnouncement(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @ClientMetaParam() meta: ClientMeta) {
    if (!(await this.prisma.announcement.findUnique({ where: { id } }))) throw AppException.notFound('Announcement not found');
    await this.prisma.announcement.delete({ where: { id } });
    await this.audit.record({ action: 'announcement.delete', actorUserId: auth.userId, actorRealm: 'PLATFORM', targetType: 'Announcement', targetId: id, ip: meta.ip, userAgent: meta.userAgent });
    return { deleted: true };
  }

  @Get('announcements/active')
  @ApiOperation({ summary: 'Announcements currently visible to the signed-in user' })
  activeAnnouncements(@CurrentAuth() auth: AuthContext) {
    const now = new Date();
    return this.prisma.announcement.findMany({
      where: { audience: { in: ['ALL', auth.realm === 'PLATFORM' ? 'CREATORS' : 'STUDENTS'] }, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: { startsAt: 'desc' },
      take: 5,
      select: { id: true, title: true, body: true, tone: true, startsAt: true },
    });
  }
}
