import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { FilesService } from '../files/files.service.js';
import { CertificatesService } from '../certificates/certificates.service.js';
import { enrollmentExpiry, isEnrollmentUsable, progressPercent, unlockTime } from './access.js';

type LessonRow = Awaited<ReturnType<TenantPrismaClient['courseLesson']['findFirst']>> & object;

@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly files: FilesService,
    private readonly certificates: CertificatesService,
  ) {}

  // ── enrolment ─────────────────────────────────────────────
  async enrollment(userId: string, courseId: string) {
    const e = await this.db.enrollment.findFirst({ where: { userId, courseId } });
    if (e && e.status === 'ACTIVE' && e.expiresAt && e.expiresAt <= new Date()) {
      return this.db.enrollment.update({ where: { id: e.id }, data: { status: 'EXPIRED' } });
    }
    return e;
  }

  /** Grants access. Used for free enrolment, manual grants and (Phase 7) verified purchases. */
  async grant(userId: string, courseId: string, source: 'FREE' | 'MANUAL' | 'PURCHASE' | 'MEMBERSHIP' | 'BUNDLE' | 'BATCH', grantedById?: string) {
    const course = await this.db.course.findFirst({ where: { id: courseId, deletedAt: null } });
    if (!course) throw AppException.notFound('Course not found');
    const existing = await this.db.enrollment.findFirst({ where: { userId, courseId } });
    const start = new Date();
    const expiresAt = enrollmentExpiry(course, start);
    if (existing) {
      if (isEnrollmentUsable(existing)) return existing;
      return this.db.enrollment.update({ where: { id: existing.id }, data: { status: 'ACTIVE', startedAt: start, expiresAt, source, grantedById } });
    }
    return this.db.enrollment.create({ data: { userId, courseId, source, expiresAt, grantedById } as never });
  }

  async enrollFree(userId: string, courseId: string) {
    const course = await this.db.course.findFirst({ where: { id: courseId, deletedAt: null, status: 'PUBLISHED' } });
    if (!course || course.visibility === 'PRIVATE') throw AppException.notFound('Course not found');
    if (!course.isFree) throw AppException.forbidden('This course requires purchase.');
    return this.grant(userId, courseId, 'FREE');
  }

  async myEnrollments(userId: string, apiOrigin: string) {
    const rows = await this.db.enrollment.findMany({ where: { userId, status: { not: 'REVOKED' } }, orderBy: [{ lastAccessedAt: 'desc' }, { createdAt: 'desc' }], include: { course: true } });
    return Promise.all(
      rows.map(async (e) => ({
        id: e.id, status: e.status, progressPercent: e.progressPercent, startedAt: e.startedAt, expiresAt: e.expiresAt, completedAt: e.completedAt, lastAccessedAt: e.lastAccessedAt, lastLessonId: e.lastLessonId,
        usable: isEnrollmentUsable(e),
        course: { id: e.course.id, title: e.course.title, slug: e.course.slug, thumbnailUrl: await this.files.urlFor(e.course.thumbnailFileId, apiOrigin) },
      })),
    );
  }

  // ── player ────────────────────────────────────────────────
  private async courseTree(courseId: string) {
    return this.db.courseSection.findMany({
      where: { courseId },
      orderBy: { position: 'asc' },
      include: { lessons: { where: { isPublished: true }, orderBy: { position: 'asc' } } },
    });
  }

  private lockInfo(course: { dripType: string }, enrolledAt: Date, section: { dripOffsetDays: number | null; unlockAt: Date | null }, lesson: { dripOffsetDays: number | null; unlockAt: Date | null }) {
    const at = unlockTime({ dripType: course.dripType as never, enrolledAt, section, lesson });
    return { locked: Boolean(at && at > new Date()), unlocksAt: at };
  }

  /** Curriculum with per-lesson lock and completion state for an enrolled student. */
  async player(userId: string, courseId: string) {
    const course = await this.db.course.findFirst({ where: { id: courseId, deletedAt: null } });
    if (!course) throw AppException.notFound('Course not found');
    const enrollment = await this.enrollment(userId, courseId);
    if (!isEnrollmentUsable(enrollment)) throw AppException.forbidden(enrollment?.status === 'EXPIRED' ? 'Your access to this course has expired.' : 'Enrol in this course to start learning.');
    const [sections, progress, bookmarks] = await Promise.all([
      this.courseTree(courseId),
      this.db.lessonProgress.findMany({ where: { enrollmentId: enrollment!.id } }),
      this.db.courseBookmark.findMany({ where: { userId, courseId }, select: { lessonId: true } }),
    ]);
    const done = new Map(progress.map((p) => [p.lessonId, p]));
    const marked = new Set(bookmarks.map((b) => b.lessonId));
    const view = (s: (typeof sections)[number], l: LessonRow) => ({
      id: l.id, title: l.title, type: l.type, durationSeconds: l.durationSeconds, isRequired: l.isRequired, parentLessonId: l.parentLessonId,
      completed: Boolean(done.get(l.id)?.completedAt), positionSeconds: done.get(l.id)?.positionSeconds ?? 0, bookmarked: marked.has(l.id),
      ...this.lockInfo(course, enrollment!.startedAt, s, l),
    });
    return {
      course: { id: course.id, title: course.title, certificateEnabled: course.certificateEnabled, completionPercent: course.completionPercent },
      enrollment: { id: enrollment!.id, status: enrollment!.status, progressPercent: enrollment!.progressPercent, expiresAt: enrollment!.expiresAt, completedAt: enrollment!.completedAt, lastLessonId: enrollment!.lastLessonId },
      sections: sections.map((s) => {
        const lessons = s.lessons.map((l) => view(s, l));
        return { id: s.id, title: s.title, lessons: lessons.filter((l) => !l.parentLessonId).map((l) => ({ ...l, children: lessons.filter((c) => c.parentLessonId === l.id) })) };
      }),
    };
  }

  /** Loads a lesson the student may open, or throws with a precise reason. */
  async accessibleLesson(userId: string, lessonId: string) {
    const lesson = await this.db.courseLesson.findFirst({ where: { id: lessonId, isPublished: true }, include: { section: true, course: true } });
    if (!lesson || lesson.course.deletedAt) throw AppException.notFound('Lesson not found');
    const enrollment = await this.enrollment(userId, lesson.courseId);
    if (!isEnrollmentUsable(enrollment)) {
      if (lesson.isFreePreview && lesson.course.status === 'PUBLISHED') return { lesson, enrollment: null };
      throw AppException.forbidden(enrollment?.status === 'EXPIRED' ? 'Your access to this course has expired.' : 'Enrol in this course to open this lesson.');
    }
    const lock = this.lockInfo(lesson.course, enrollment!.startedAt, lesson.section, lesson);
    if (lock.locked) throw AppException.forbidden(`This lesson unlocks on ${lock.unlocksAt!.toISOString().slice(0, 10)}.`);
    return { lesson, enrollment };
  }

  async lessonContent(userId: string, lessonId: string, apiOrigin: string) {
    const { lesson, enrollment } = await this.accessibleLesson(userId, lessonId);
    if (enrollment) await this.db.enrollment.update({ where: { id: enrollment.id }, data: { lastLessonId: lesson.id, lastAccessedAt: new Date() } });
    const file = lesson.fileAssetId ? await this.db.fileAsset.findUnique({ where: { id: lesson.fileAssetId } }) : null;
    return {
      id: lesson.id, title: lesson.title, type: lesson.type, content: lesson.content, externalUrl: lesson.externalUrl, durationSeconds: lesson.durationSeconds, courseId: lesson.courseId,
      // Short-lived signed URL; downloads are only offered for DOWNLOAD lessons.
      file: file && file.status === 'READY' ? { fileName: file.fileName, mimeType: file.mimeType, sizeBytes: Number(file.sizeBytes), url: await this.files.urlFor(file.id, apiOrigin, 600), downloadable: lesson.type === 'DOWNLOAD' } : null,
      hasVideo: lesson.type === 'VIDEO' && Boolean(lesson.videoAssetId),
      preview: !enrollment,
    };
  }

  // ── progress ──────────────────────────────────────────────
  async savePosition(userId: string, lessonId: string, positionSeconds: number) {
    const { lesson, enrollment } = await this.accessibleLesson(userId, lessonId);
    if (!enrollment) return { saved: false };
    await this.db.lessonProgress.upsert({
      where: { tenantId_enrollmentId_lessonId: { tenantId: this.ctx.requireTenantId(), enrollmentId: enrollment.id, lessonId: lesson.id } },
      update: { positionSeconds },
      create: { enrollmentId: enrollment.id, lessonId: lesson.id, positionSeconds } as never,
    });
    return { saved: true };
  }

  /** Marks a lesson complete (quizzes/assignments call this when their rule is met). */
  async complete(userId: string, lessonId: string, opts: { system?: boolean } = {}) {
    const { lesson, enrollment } = await this.accessibleLesson(userId, lessonId);
    if (!enrollment) throw AppException.forbidden('Enrol to track progress.');
    if (!opts.system && (lesson.type === 'QUIZ' || lesson.type === 'ASSIGNMENT')) {
      throw AppException.validation([{ field: 'lesson', message: lesson.type === 'QUIZ' ? 'Pass the quiz to complete this lesson.' : 'Submit the assignment to complete this lesson.' }]);
    }
    const tenantId = this.ctx.requireTenantId();
    await this.db.lessonProgress.upsert({
      where: { tenantId_enrollmentId_lessonId: { tenantId, enrollmentId: enrollment.id, lessonId: lesson.id } },
      update: { completedAt: new Date() },
      create: { enrollmentId: enrollment.id, lessonId: lesson.id, completedAt: new Date() } as never,
    });
    return this.recompute(enrollment.id);
  }

  async uncomplete(userId: string, lessonId: string) {
    const { lesson, enrollment } = await this.accessibleLesson(userId, lessonId);
    if (!enrollment) throw AppException.forbidden('Enrol to track progress.');
    await this.db.lessonProgress.updateMany({ where: { enrollmentId: enrollment.id, lessonId: lesson.id }, data: { completedAt: null } });
    return this.recompute(enrollment.id);
  }

  /** Recomputes progress; completing the course issues a certificate when enabled. */
  async recompute(enrollmentId: string) {
    const enrollment = await this.db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId }, include: { course: true } });
    const [required, progress] = await Promise.all([
      this.db.courseLesson.findMany({ where: { courseId: enrollment.courseId, isPublished: true, isRequired: true }, select: { id: true } }),
      this.db.lessonProgress.findMany({ where: { enrollmentId, completedAt: { not: null } }, select: { lessonId: true } }),
    ]);
    const percent = progressPercent(required.map((r) => r.id), new Set(progress.map((p) => p.lessonId)));
    const completedNow = percent >= enrollment.course.completionPercent && !enrollment.completedAt && required.length > 0;
    const updated = await this.db.enrollment.update({
      where: { id: enrollmentId },
      data: { progressPercent: percent, ...(completedNow ? { completedAt: new Date(), status: 'COMPLETED' } : {}) },
    });
    let certificate = null;
    if ((completedNow || updated.completedAt) && enrollment.course.certificateEnabled) {
      certificate = await this.certificates.issueFor(updated.id);
    }
    return { progressPercent: updated.progressPercent, completedAt: updated.completedAt, certificate: certificate && { id: certificate.id, number: certificate.number } };
  }

  // ── notes, bookmarks, comments ───────────────────────────
  async notes(userId: string, courseId: string) {
    return this.db.lessonNote.findMany({ where: { userId, courseId }, orderBy: { createdAt: 'desc' } });
  }

  async addNote(userId: string, lessonId: string, body: string, positionSeconds?: number) {
    const { lesson, enrollment } = await this.accessibleLesson(userId, lessonId);
    if (!enrollment) throw AppException.forbidden('Enrol to take notes.');
    return this.db.lessonNote.create({ data: { userId, courseId: lesson.courseId, lessonId: lesson.id, body, positionSeconds: positionSeconds ?? null } as never });
  }

  async updateNote(userId: string, noteId: string, body: string) {
    const n = await this.db.lessonNote.findFirst({ where: { id: noteId, userId } });
    if (!n) throw AppException.notFound('Note not found');
    return this.db.lessonNote.update({ where: { id: noteId }, data: { body } });
  }

  async deleteNote(userId: string, noteId: string) {
    const n = await this.db.lessonNote.findFirst({ where: { id: noteId, userId } });
    if (!n) throw AppException.notFound('Note not found');
    await this.db.lessonNote.delete({ where: { id: noteId } });
    return { deleted: true };
  }

  async toggleBookmark(userId: string, lessonId: string) {
    const { lesson } = await this.accessibleLesson(userId, lessonId);
    const existing = await this.db.courseBookmark.findFirst({ where: { userId, lessonId } });
    if (existing) {
      await this.db.courseBookmark.delete({ where: { id: existing.id } });
      return { bookmarked: false };
    }
    await this.db.courseBookmark.create({ data: { userId, courseId: lesson.courseId, lessonId } as never });
    return { bookmarked: true };
  }

  async comments(lessonId: string) {
    const rows = await this.db.lessonComment.findMany({ where: { lessonId, hiddenAt: null }, orderBy: { createdAt: 'asc' } });
    const authors = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, fullName: true } });
    const name = new Map(authors.map((a) => [a.id, a.fullName]));
    const view = (c: (typeof rows)[number]) => ({ id: c.id, body: c.body, isInstructor: c.isInstructor, isResolved: c.isResolved, createdAt: c.createdAt, author: name.get(c.authorId) ?? 'Former member', authorId: c.authorId });
    return rows.filter((r) => !r.parentId).map((r) => ({ ...view(r), replies: rows.filter((x) => x.parentId === r.id).map(view) })).reverse();
  }

  async addComment(userId: string, lessonId: string, body: string, parentId?: string) {
    const { lesson, enrollment } = await this.accessibleLesson(userId, lessonId);
    if (!enrollment) throw AppException.forbidden('Enrol to join the discussion.');
    if (parentId && !(await this.db.lessonComment.findFirst({ where: { id: parentId, lessonId, parentId: null } }))) throw AppException.validation([{ field: 'parentId', message: 'Thread not found' }]);
    return this.db.lessonComment.create({ data: { courseId: lesson.courseId, lessonId, authorId: userId, authorRealm: 'TENANT', parentId: parentId ?? null, body } as never });
  }
}
