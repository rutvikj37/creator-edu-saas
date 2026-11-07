import { Inject, Injectable } from '@nestjs/common';
import { FEATURES } from '@ce/shared';
import { AppException, type FieldError } from '../../common/errors/app-exception.js';
import { Paginated } from '../../common/interceptors/response-envelope.interceptor.js';
import { toOrderBy, toSkipTake } from '../../common/dto/pagination.dto.js';
import { RichTextError, validateRichText } from '../../common/richtext/richtext.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { FilesService } from '../files/files.service.js';
import { slugify } from '../tenants/slug.js';
import type { CourseListQuery, CreateCourseDto, CreateLessonDto, CurriculumOrderDto, SectionDto, UpdateCourseDto, UpdateLessonDto } from './dto/course.dto.js';

/** Lesson types whose content can be authored now. Others arrive with their modules (quiz/assignment: Phase 5, live: Phase 9). */
export const AUTHORABLE_TYPES = new Set(['TEXT', 'LINK', 'PDF', 'DOCUMENT', 'IMAGE', 'AUDIO', 'DOWNLOAD', 'VIDEO', 'QUIZ', 'ASSIGNMENT']);
const FILE_TYPES: Record<string, string[]> = { PDF: ['LESSON_FILE'], DOCUMENT: ['LESSON_FILE'], IMAGE: ['LESSON_FILE', 'IMAGE'], AUDIO: ['LESSON_FILE'], DOWNLOAD: ['LESSON_FILE'] };
const FILE_MIME: Record<string, (m: string) => boolean> = {
  PDF: (m) => m === 'application/pdf',
  IMAGE: (m) => m.startsWith('image/'),
  AUDIO: (m) => m.startsWith('audio/'),
  DOCUMENT: (m) => m.startsWith('application/') || m.startsWith('text/'),
  DOWNLOAD: () => true,
};

type Actor = { userId: string };

@Injectable()
export class CoursesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly entitlements: EntitlementsService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  private richText(field: string, doc: unknown) {
    if (doc === null || doc === undefined) return;
    try {
      validateRichText(doc);
    } catch (e) {
      if (e instanceof RichTextError) throw AppException.validation([{ field, message: e.message }]);
      throw e;
    }
  }

  private async uniqueSlug(base: string, excludeId?: string) {
    const root = slugify(base).slice(0, 200);
    for (let i = 0; i < 100; i++) {
      const candidate = i === 0 ? root : `${root}-${i + 1}`;
      const hit = await this.db.course.findFirst({ where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
      if (!hit) return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
  }

  async get(id: string) {
    const c = await this.db.course.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw AppException.notFound('Course not found');
    return c;
  }

  private present(c: Prisma.CourseGetPayload<object>, extra: object = {}) {
    return { ...c, priceAmount: c.priceAmount?.toString() ?? null, compareAtAmount: c.compareAtAmount?.toString() ?? null, ...extra };
  }

  async list(q: CourseListQuery, apiOrigin: string) {
    const where: Prisma.CourseWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status as never } : { status: { not: 'ARCHIVED' } }),
      ...(q.q ? { title: { contains: q.q } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.course.findMany({ where, orderBy: toOrderBy(q.sort, ['createdAt', 'updatedAt', 'title', 'status'] as const, { updatedAt: 'desc' }), ...toSkipTake(q), include: { _count: { select: { lessons: true, sections: true, enrollments: { where: { status: 'ACTIVE' } } } } } }),
      this.db.course.count({ where }),
    ]);
    const items = await Promise.all(rows.map(async ({ _count, ...c }) => this.present(c, { lessonCount: _count.lessons, sectionCount: _count.sections, studentCount: _count.enrollments, thumbnailUrl: await this.files.urlFor(c.thumbnailFileId, apiOrigin) })));
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  async create(dto: CreateCourseDto, actor: Actor) {
    const tenantId = this.ctx.requireTenantId();
    const count = await this.db.course.count({ where: { deletedAt: null, status: { not: 'ARCHIVED' } } });
    await this.entitlements.assertWithinLimit(tenantId, FEATURES.COURSES_MAX.key, count);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultCurrency: true } });
    const isFree = dto.isFree ?? false;
    const price = isFree ? null : dto.priceAmount ?? null;
    const compare = isFree ? null : dto.compareAtAmount ?? null;
    if (compare !== null && price !== null && compare <= price) throw AppException.validation([{ field: 'compareAtAmount', message: 'Original price must be higher than the selling price' }]);
    const slug = await this.uniqueSlug(dto.title);
    // Explicit tenantId on every row (composite tenant FKs); one transaction.
    const course = await this.prisma.$transaction(async (tx) => {
      const c = await tx.course.create({
        data: { tenantId, title: dto.title, shortDescription: dto.shortDescription, slug, createdById: actor.userId, currency: tenant.defaultCurrency, description: (dto.description ?? undefined) as never, isFree, priceAmount: price, compareAtAmount: compare },
      });
      await tx.courseSection.create({ data: { tenantId, courseId: c.id, title: 'Introduction', position: 0 } });
      await tx.courseInstructor.create({ data: { tenantId, courseId: c.id, userId: actor.userId, isPrimary: true } });
      return c;
    });
    await this.audit.record({ action: 'course.create', tenantId, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Course', targetId: course.id, after: { title: dto.title } });
    return this.present(course);
  }

  async detail(id: string, apiOrigin: string) {
    const c = await this.get(id);
    const instructors = await this.db.courseInstructor.findMany({ where: { courseId: id } });
    const users = await this.prisma.user.findMany({ where: { id: { in: instructors.map((i) => i.userId) } }, select: { id: true, fullName: true, email: true } });
    return this.present(c, {
      thumbnailUrl: await this.files.urlFor(c.thumbnailFileId, apiOrigin),
      bannerUrl: await this.files.urlFor(c.bannerFileId, apiOrigin),
      instructors: instructors.map((i) => ({ ...users.find((u) => u.id === i.userId), isPrimary: i.isPrimary })),
    });
  }

  async update(id: string, dto: UpdateCourseDto, actor: Actor, apiOrigin: string) {
    const c = await this.get(id);
    this.richText('description', dto.description);
    if (dto.thumbnailFileId) await this.files.assertUsable(dto.thumbnailFileId, ['COURSE_THUMBNAIL', 'IMAGE']);
    if (dto.bannerFileId) await this.files.assertUsable(dto.bannerFileId, ['COURSE_BANNER', 'IMAGE']);
    if (dto.slug && dto.slug !== c.slug && (await this.db.course.findFirst({ where: { slug: dto.slug, id: { not: id } } }))) {
      throw AppException.validation([{ field: 'slug', message: 'Another course already uses this URL' }]);
    }
    if (dto.categorySlug && !(await this.prisma.courseCategory.findFirst({ where: { slug: dto.categorySlug, scopeKey: 'platform' } }))) {
      throw AppException.validation([{ field: 'categorySlug', message: 'Unknown category' }]);
    }
    const isFree = dto.isFree ?? c.isFree;
    const price = dto.priceAmount !== undefined ? dto.priceAmount : c.priceAmount === null ? null : Number(c.priceAmount);
    const compare = dto.compareAtAmount !== undefined ? dto.compareAtAmount : c.compareAtAmount === null ? null : Number(c.compareAtAmount);
    if (!isFree && compare !== null && price !== null && compare <= price) throw AppException.validation([{ field: 'compareAtAmount', message: 'Original price must be higher than the selling price' }]);
    const accessType = dto.accessType ?? c.accessType;
    if (accessType === 'FIXED_DAYS' && !(dto.accessDays ?? c.accessDays)) throw AppException.validation([{ field: 'accessDays', message: 'Enter the number of days of access' }]);
    if (accessType === 'FIXED_DATE' && !(dto.accessUntil ?? c.accessUntil)) throw AppException.validation([{ field: 'accessUntil', message: 'Choose the date access ends' }]);

    const updated = await this.db.course.update({
      where: { id },
      data: {
        ...dto,
        description: dto.description as never,
        tags: dto.tags as never,
        objectives: dto.objectives as never,
        prerequisites: dto.prerequisites as never,
        accessUntil: dto.accessUntil === undefined ? undefined : dto.accessUntil ? new Date(dto.accessUntil) : null,
        ...(isFree ? { priceAmount: null, compareAtAmount: null } : {}),
      },
    });
    await this.audit.record({ action: 'course.update', tenantId: this.ctx.tenantId, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Course', targetId: id, after: { fields: Object.keys(dto) } });
    return this.detail(updated.id, apiOrigin);
  }

  /** Problems preventing publication; empty = publishable. */
  async publishProblems(id: string): Promise<FieldError[]> {
    const c = await this.get(id);
    const lessons = await this.db.courseLesson.findMany({ where: { courseId: id, isPublished: true } });
    const [quizzes, assignments] = await Promise.all([
      this.db.quiz.findMany({ where: { courseId: id, questions: { some: {} } }, select: { lessonId: true } }),
      this.db.assignment.findMany({ where: { courseId: id }, select: { lessonId: true, instructions: true } }),
    ]);
    const quizIds = new Set(quizzes.map((q) => q.lessonId));
    const readyVideos = new Set((await this.db.videoAsset.findMany({ where: { status: 'READY', deletedAt: null, id: { in: lessons.map((l) => l.videoAssetId).filter(Boolean) as string[] } }, select: { id: true } })).map((v) => v.id));
    const assignmentIds = new Set(assignments.filter((a) => a.instructions).map((a) => a.lessonId));
    const problems: FieldError[] = [];
    if (!c.isFree && (c.priceAmount === null || Number(c.priceAmount) <= 0)) problems.push({ field: 'priceAmount', message: 'Set a price or mark the course as free' });
    if (!lessons.length) problems.push({ field: 'curriculum', message: 'Add at least one published lesson' });
    for (const l of lessons) {
      const missing =
        (l.type === 'TEXT' && !l.content) ||
        (l.type === 'LINK' && !l.externalUrl) ||
        (FILE_TYPES[l.type] && !l.fileAssetId) ||
        (l.type === 'VIDEO' && !readyVideos.has(l.videoAssetId ?? '')) || l.type === 'LIVE' ||
        (l.type === 'QUIZ' && !quizIds.has(l.id)) ||
        (l.type === 'ASSIGNMENT' && !assignmentIds.has(l.id));
      if (missing) {
        const what = l.type === 'VIDEO' ? 'attach a video from your library' : l.type === 'QUIZ' ? 'add at least one question' : l.type === 'ASSIGNMENT' ? 'write the instructions' : l.type === 'TEXT' ? 'add content' : l.type === 'LINK' ? 'add a URL' : FILE_TYPES[l.type] ? 'upload a file' : 'finish configuring it';
        problems.push({ field: `lesson:${l.id}`, message: `“${l.title}”: ${what}, or unpublish the lesson` });
      }
    }
    return problems;
  }

  async publish(id: string, publishAt: string | undefined, actor: Actor) {
    const c = await this.get(id);
    if (c.status === 'ARCHIVED') throw AppException.conflict('Restore the course before publishing.');
    const problems = await this.publishProblems(id);
    if (problems.length) throw AppException.validation(problems, 'This course is not ready to publish');
    const scheduled = publishAt && new Date(publishAt) > new Date();
    const updated = await this.db.course.update({
      where: { id },
      data: scheduled ? { status: 'SCHEDULED', publishAt: new Date(publishAt!) } : { status: 'PUBLISHED', publishAt: null, publishedAt: c.publishedAt ?? new Date() },
    });
    await this.audit.record({ action: scheduled ? 'course.schedule' : 'course.publish', tenantId: this.ctx.tenantId, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Course', targetId: id, after: { publishAt: publishAt ?? null } });
    return this.present(updated);
  }

  async setStatus(id: string, status: 'UNPUBLISHED' | 'ARCHIVED' | 'DRAFT', actor: Actor) {
    const c = await this.get(id);
    if (status === 'DRAFT' && c.status !== 'ARCHIVED') throw AppException.conflict('Only archived courses can be restored.');
    const updated = await this.db.course.update({ where: { id }, data: { status, publishAt: null } });
    await this.audit.record({ action: `course.${status.toLowerCase()}`, tenantId: this.ctx.tenantId, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Course', targetId: id });
    return this.present(updated);
  }

  async remove(id: string, actor: Actor) {
    const c = await this.get(id);
    if (c.status === 'PUBLISHED' || c.status === 'SCHEDULED') throw AppException.conflict('Unpublish the course before deleting it.');
    await this.db.course.update({ where: { id }, data: { deletedAt: new Date(), slug: `${c.slug}-deleted-${Date.now().toString(36)}`.slice(0, 220) } });
    await this.audit.record({ action: 'course.delete', tenantId: this.ctx.tenantId, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Course', targetId: id });
    return { deleted: true };
  }

  async duplicate(id: string, actor: Actor) {
    const tenantId = this.ctx.requireTenantId();
    const src = await this.get(id);
    const count = await this.db.course.count({ where: { deletedAt: null, status: { not: 'ARCHIVED' } } });
    await this.entitlements.assertWithinLimit(tenantId, FEATURES.COURSES_MAX.key, count);
    const sections = await this.db.courseSection.findMany({ where: { courseId: id }, orderBy: { position: 'asc' }, include: { lessons: { orderBy: { position: 'asc' } } } });
    const slug = await this.uniqueSlug(`${src.title} copy`);
    const copy = await this.prisma.$transaction(async (tx) => {
      const { id: _id, createdAt, updatedAt, publishedAt, publishAt, slug: _s, status, deletedAt, ...fields } = src;
      const c = await tx.course.create({ data: { ...fields, description: fields.description as never, tags: fields.tags as never, objectives: fields.objectives as never, prerequisites: fields.prerequisites as never, title: `${src.title} (copy)`.slice(0, 200), slug, status: 'DRAFT', createdById: actor.userId } });
      await tx.courseInstructor.create({ data: { tenantId, courseId: c.id, userId: actor.userId, isPrimary: true } });
      for (const s of sections) {
        const ns = await tx.courseSection.create({ data: { tenantId, courseId: c.id, title: s.title, position: s.position, dripOffsetDays: s.dripOffsetDays, unlockAt: s.unlockAt } });
        const idMap = new Map<string, string>();
        // parents first so sub-lessons can reference the new ids
        for (const l of [...s.lessons].sort((a, b) => Number(Boolean(a.parentLessonId)) - Number(Boolean(b.parentLessonId)))) {
          const { id: oldId, createdAt: _c, updatedAt: _u, courseId: _ci, sectionId: _si, parentLessonId, ...lf } = l;
          const nl = await tx.courseLesson.create({ data: { ...lf, content: lf.content as never, courseId: c.id, sectionId: ns.id, parentLessonId: parentLessonId ? idMap.get(parentLessonId) ?? null : null } });
          idMap.set(oldId, nl.id);
        }
      }
      return c;
    });
    await this.audit.record({ action: 'course.duplicate', tenantId, actorUserId: actor.userId, actorRealm: 'PLATFORM', targetType: 'Course', targetId: copy.id, before: { sourceId: id } });
    return this.present(copy);
  }

  async setInstructors(id: string, userIds: string[]) {
    const tenantId = this.ctx.requireTenantId();
    await this.get(id);
    const members = await this.db.tenantMember.findMany({ where: { userId: { in: userIds }, status: 'ACTIVE' }, select: { userId: true } });
    if (members.length !== new Set(userIds).size) throw AppException.validation([{ field: 'userIds', message: 'Instructors must be active staff of this academy' }]);
    if (!userIds.length) throw AppException.validation([{ field: 'userIds', message: 'A course needs at least one instructor' }]);
    await this.prisma.$transaction([
      this.prisma.courseInstructor.deleteMany({ where: { tenantId, courseId: id, userId: { notIn: userIds } } }),
      ...userIds.map((userId, i) => this.prisma.courseInstructor.upsert({ where: { tenantId_courseId_userId: { tenantId, courseId: id, userId } }, update: { isPrimary: i === 0 }, create: { tenantId, courseId: id, userId, isPrimary: i === 0 } })),
    ]);
    return this.db.courseInstructor.findMany({ where: { courseId: id } });
  }

  // ── curriculum ────────────────────────────────────────────
  async curriculum(id: string) {
    await this.get(id);
    const sections = await this.db.courseSection.findMany({
      where: { courseId: id },
      orderBy: { position: 'asc' },
      include: { lessons: { orderBy: { position: 'asc' }, include: { file: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } } } } },
    });
    return sections.map((s) => {
      const lessons = s.lessons.map((l) => ({ ...l, file: l.file ? { ...l.file, sizeBytes: Number(l.file.sizeBytes) } : null }));
      return {
        ...s,
        lessons: lessons.filter((l) => !l.parentLessonId).map((l) => ({ ...l, children: lessons.filter((c) => c.parentLessonId === l.id) })),
      };
    });
  }

  async addSection(courseId: string, dto: SectionDto) {
    await this.get(courseId);
    const max = await this.db.courseSection.aggregate({ where: { courseId }, _max: { position: true } });
    return this.db.courseSection.create({ data: { courseId, title: dto.title, position: (max._max.position ?? -1) + 1, dripOffsetDays: dto.dripOffsetDays ?? null, unlockAt: dto.unlockAt ? new Date(dto.unlockAt) : null } as never });
  }

  private async section(courseId: string, sectionId: string) {
    const s = await this.db.courseSection.findFirst({ where: { id: sectionId, courseId } });
    if (!s) throw AppException.notFound('Section not found');
    return s;
  }

  async updateSection(courseId: string, sectionId: string, dto: SectionDto) {
    await this.section(courseId, sectionId);
    return this.db.courseSection.update({ where: { id: sectionId }, data: { title: dto.title, dripOffsetDays: dto.dripOffsetDays ?? null, unlockAt: dto.unlockAt ? new Date(dto.unlockAt) : null } });
  }

  async removeSection(courseId: string, sectionId: string) {
    await this.section(courseId, sectionId);
    if ((await this.db.courseSection.count({ where: { courseId } })) === 1) throw AppException.conflict('A course needs at least one section.');
    await this.db.courseLesson.updateMany({ where: { sectionId, parentLessonId: { not: null } }, data: { parentLessonId: null } });
    await this.db.courseSection.delete({ where: { id: sectionId } });
    return { deleted: true };
  }

  async addLesson(courseId: string, dto: CreateLessonDto) {
    await this.get(courseId);
    if (!AUTHORABLE_TYPES.has(dto.type)) throw AppException.validation([{ field: 'type', message: 'This lesson type is not available yet' }]);
    await this.section(courseId, dto.sectionId);
    if (dto.parentLessonId) {
      const parent = await this.db.courseLesson.findFirst({ where: { id: dto.parentLessonId, courseId, sectionId: dto.sectionId } });
      if (!parent) throw AppException.validation([{ field: 'parentLessonId', message: 'Parent lesson not found in this section' }]);
      if (parent.parentLessonId) throw AppException.validation([{ field: 'parentLessonId', message: 'Sub-lessons cannot be nested further' }]);
    }
    const max = await this.db.courseLesson.aggregate({ where: { sectionId: dto.sectionId, parentLessonId: dto.parentLessonId ?? null }, _max: { position: true } });
    const lesson = await this.db.courseLesson.create({
      data: { courseId, sectionId: dto.sectionId, parentLessonId: dto.parentLessonId ?? null, title: dto.title, type: dto.type, position: (max._max.position ?? -1) + 1, isPublished: dto.type !== 'VIDEO' } as never,
    });
    if (dto.type === 'QUIZ') await this.db.quiz.create({ data: { courseId, lessonId: lesson.id } as never });
    if (dto.type === 'ASSIGNMENT') await this.db.assignment.create({ data: { courseId, lessonId: lesson.id } as never });
    return lesson;
  }

  private async lesson(courseId: string, lessonId: string) {
    const l = await this.db.courseLesson.findFirst({ where: { id: lessonId, courseId } });
    if (!l) throw AppException.notFound('Lesson not found');
    return l;
  }

  async updateLesson(courseId: string, lessonId: string, dto: UpdateLessonDto) {
    const l = await this.lesson(courseId, lessonId);
    if (dto.content !== undefined) {
      if (l.type !== 'TEXT' && dto.content !== null) throw AppException.validation([{ field: 'content', message: 'Only text lessons have rich content' }]);
      this.richText('content', dto.content);
    }
    if (dto.fileAssetId) {
      if (!FILE_TYPES[l.type]) throw AppException.validation([{ field: 'fileAssetId', message: 'This lesson type does not take a file' }]);
      const f = await this.files.assertUsable(dto.fileAssetId, FILE_TYPES[l.type]);
      if (!FILE_MIME[l.type](f.mimeType)) throw AppException.validation([{ field: 'fileAssetId', message: `This file type does not fit a ${l.type.toLowerCase()} lesson` }]);
    }
    if (dto.externalUrl && l.type !== 'LINK') throw AppException.validation([{ field: 'externalUrl', message: 'Only link lessons take a URL' }]);
    if (dto.videoAssetId !== undefined) {
      if (l.type !== 'VIDEO') throw AppException.validation([{ field: 'videoAssetId', message: 'Only video lessons take a video' }]);
      if (dto.videoAssetId) {
        const v = await this.db.videoAsset.findFirst({ where: { id: dto.videoAssetId, deletedAt: null } });
        if (!v || v.status !== 'READY') throw AppException.validation([{ field: 'videoAssetId', message: 'Video not found or not ready' }]);
        if (dto.durationSeconds === undefined && v.durationSeconds) dto.durationSeconds = v.durationSeconds;
      }
    }
    const videoId = dto.videoAssetId !== undefined ? dto.videoAssetId : l.videoAssetId;
    if (dto.isPublished && l.type === 'VIDEO' && !videoId) throw AppException.validation([{ field: 'isPublished', message: 'Attach a video before publishing this lesson' }]);
    if (dto.videoAssetId === null && l.type === 'VIDEO') dto.isPublished = false;
    return this.db.courseLesson.update({
      where: { id: lessonId },
      data: { ...dto, content: dto.content as never, unlockAt: dto.unlockAt === undefined ? undefined : dto.unlockAt ? new Date(dto.unlockAt) : null },
    });
  }

  async removeLesson(courseId: string, lessonId: string) {
    await this.lesson(courseId, lessonId);
    await this.db.courseLesson.deleteMany({ where: { parentLessonId: lessonId } });
    await this.db.courseLesson.delete({ where: { id: lessonId } });
    return { deleted: true };
  }

  /**
   * Applies a full curriculum ordering (sections, lessons, one level of sub-lessons). The payload
   * must contain exactly the course's existing ids, so items can't be dropped or moved in from elsewhere.
   */
  async reorder(courseId: string, dto: CurriculumOrderDto) {
    await this.get(courseId);
    const [sections, lessons] = await Promise.all([
      this.db.courseSection.findMany({ where: { courseId }, select: { id: true } }),
      this.db.courseLesson.findMany({ where: { courseId }, select: { id: true } }),
    ]);
    const sectionIds = dto.sections.map((s) => s.id);
    const lessonIds = dto.sections.flatMap((s) => s.lessons.flatMap((l) => [l.id, ...(l.children ?? [])]));
    const same = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));
    if (!same(sectionIds, sections.map((s) => s.id)) || !same(lessonIds, lessons.map((l) => l.id))) {
      throw AppException.validation([{ field: 'sections', message: 'Curriculum changed elsewhere. Reload and try again.' }]);
    }
    const tenantId = this.ctx.requireTenantId();
    await this.prisma.$transaction(
      dto.sections.flatMap((s, si) => [
        this.prisma.courseSection.update({ where: { tenantId_id: { tenantId, id: s.id } }, data: { position: si } }),
        ...s.lessons.flatMap((l, li) => [
          this.prisma.courseLesson.update({ where: { tenantId_id: { tenantId, id: l.id } }, data: { sectionId: s.id, parentLessonId: null, position: li } }),
          ...(l.children ?? []).map((cid, ci) => this.prisma.courseLesson.update({ where: { tenantId_id: { tenantId, id: cid } }, data: { sectionId: s.id, parentLessonId: l.id, position: ci } })),
        ]),
      ]),
    );
    return this.curriculum(courseId);
  }

  /** Publishes scheduled courses whose time has come (called by the worker every minute). */
  async publishDue(): Promise<number> {
    const due = await this.prisma.course.findMany({ where: { status: 'SCHEDULED', publishAt: { lte: new Date() }, deletedAt: null }, select: { id: true, tenantId: true } });
    for (const c of due) await this.prisma.course.update({ where: { id: c.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishAt: null } });
    return due.length;
  }
}
