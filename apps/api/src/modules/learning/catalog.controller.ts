import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { TenantScoped } from '../../common/decorators/auth.decorators.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import type { AppRequest } from '../../core/tenancy/request-context.js';
import { FilesService } from '../files/files.service.js';
import { apiOrigin } from '../files/files.controller.js';
import { ReviewsService } from './reviews.service.js';

/** Public course catalogue of the academy on the current host. */
@ApiTags('Academy (public) · Catalog')
@Public()
@TenantScoped('academy')
@Controller({ path: 'public/courses', version: '1' })
export class CatalogController {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly reviews: ReviewsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Published, publicly listed courses' })
  async list(@Query('q') q: string | undefined, @Query('category') category: string | undefined, @Req() req: AppRequest) {
    const rows = await this.db.course.findMany({
      where: { status: 'PUBLISHED', visibility: 'PUBLIC', deletedAt: null, ...(q ? { title: { contains: q.slice(0, 100) } } : {}), ...(category ? { categorySlug: category } : {}) },
      orderBy: { publishedAt: 'desc' },
      take: 100,
      include: { _count: { select: { lessons: { where: { isPublished: true } }, enrollments: true } } },
    });
    const ratings = await this.reviews.summaries(rows.map((c) => c.id));
    return Promise.all(rows.map(async (c) => ({
      ratingAverage: ratings.get(c.id)?.average ?? null, ratingCount: ratings.get(c.id)?.count ?? 0,
      id: c.id, slug: c.slug, title: c.title, shortDescription: c.shortDescription, level: c.level, language: c.language, categorySlug: c.categorySlug,
      isFree: c.isFree, priceAmount: c.priceAmount?.toString() ?? null, compareAtAmount: c.compareAtAmount?.toString() ?? null, currency: c.currency,
      lessonCount: c._count.lessons, studentCount: c._count.enrollments, durationMinutes: c.durationMinutes,
      thumbnailUrl: await this.files.urlFor(c.thumbnailFileId, apiOrigin(req), 86_400),
    })));
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Course landing data with curriculum outline' })
  async detail(@Param('slug') slug: string, @Req() req: AppRequest) {
    const c = await this.db.course.findFirst({ where: { slug, status: 'PUBLISHED', visibility: { in: ['PUBLIC', 'UNLISTED'] }, deletedAt: null } });
    if (!c) throw AppException.notFound('Course not found');
    const [sections, instructors, students] = await Promise.all([
      this.db.courseSection.findMany({ where: { courseId: c.id }, orderBy: { position: 'asc' }, include: { lessons: { where: { isPublished: true }, orderBy: { position: 'asc' }, select: { id: true, title: true, type: true, durationSeconds: true, isFreePreview: true, parentLessonId: true } } } }),
      this.db.courseInstructor.findMany({ where: { courseId: c.id }, orderBy: { isPrimary: 'desc' } }),
      this.db.enrollment.count({ where: { courseId: c.id } }),
    ]);
    const people = await this.prisma.user.findMany({ where: { id: { in: instructors.map((i) => i.userId) } }, select: { id: true, fullName: true } });
    return {
      id: c.id, slug: c.slug, title: c.title, shortDescription: c.shortDescription, description: c.description, level: c.level, language: c.language,
      objectives: c.objectives ?? [], prerequisites: c.prerequisites ?? [], durationMinutes: c.durationMinutes, certificateEnabled: c.certificateEnabled,
      isFree: c.isFree, priceAmount: c.priceAmount?.toString() ?? null, compareAtAmount: c.compareAtAmount?.toString() ?? null, currency: c.currency,
      accessType: c.accessType, accessDays: c.accessDays, seoTitle: c.seoTitle ?? c.title, seoDescription: c.seoDescription ?? c.shortDescription,
      thumbnailUrl: await this.files.urlFor(c.thumbnailFileId, apiOrigin(req), 86_400), bannerUrl: await this.files.urlFor(c.bannerFileId, apiOrigin(req), 86_400),
      instructors: instructors.map((i) => people.find((p) => p.id === i.userId)?.fullName).filter(Boolean),
      studentCount: students,
      rating: (await this.reviews.summaries([c.id])).get(c.id),
      sections: sections.filter((s) => s.lessons.length).map((s) => ({ id: s.id, title: s.title, lessons: s.lessons })),
    };
  }

  @Get(':slug/preview/:lessonId')
  @ApiOperation({ summary: 'Content of a free-preview lesson (no sign-in needed)' })
  async preview(@Param('slug') slug: string, @Param('lessonId') lessonId: string, @Req() req: AppRequest) {
    const c = await this.db.course.findFirst({ where: { slug, status: 'PUBLISHED', deletedAt: null } });
    const l = c && (await this.db.courseLesson.findFirst({ where: { id: lessonId, courseId: c.id, isPublished: true, isFreePreview: true } }));
    if (!l) throw AppException.notFound('Preview not available');
    return { id: l.id, title: l.title, type: l.type, content: l.content, externalUrl: l.externalUrl, fileUrl: await this.files.urlFor(l.fileAssetId, apiOrigin(req), 600) };
  }
}
