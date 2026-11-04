import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { RichTextError, validateRichText } from '../../common/richtext/richtext.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { FilesService } from '../files/files.service.js';
import { LearningService } from '../learning/learning.service.js';
import type { AssignmentSettingsDto, GradeSubmissionDto, SubmitAssignmentDto } from './dto.js';

@Injectable()
export class AssignmentsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly files: FilesService,
    private readonly learning: LearningService,
  ) {}

  async forLesson(courseId: string, lessonId: string) {
    const lesson = await this.db.courseLesson.findFirst({ where: { id: lessonId, courseId, type: 'ASSIGNMENT' } });
    if (!lesson) throw AppException.notFound('Assignment lesson not found');
    return (await this.db.assignment.findFirst({ where: { lessonId } })) ?? this.db.assignment.create({ data: { courseId, lessonId } as never });
  }

  async update(courseId: string, lessonId: string, dto: AssignmentSettingsDto) {
    if (dto.instructions) {
      try {
        validateRichText(dto.instructions);
      } catch (e) {
        if (e instanceof RichTextError) throw AppException.validation([{ field: 'instructions', message: e.message }]);
        throw e;
      }
    }
    const a = await this.forLesson(courseId, lessonId);
    return this.db.assignment.update({ where: { id: a.id }, data: { ...dto, instructions: dto.instructions as never, dueAt: dto.dueAt === undefined ? undefined : dto.dueAt ? new Date(dto.dueAt) : null } });
  }

  private async fileViews(ids: unknown, apiOrigin: string) {
    const list = Array.isArray(ids) ? (ids as string[]) : [];
    const rows = await this.db.fileAsset.findMany({ where: { id: { in: list }, status: 'READY' } });
    return Promise.all(rows.map(async (f) => ({ id: f.id, fileName: f.fileName, sizeBytes: Number(f.sizeBytes), url: await this.files.urlFor(f.id, apiOrigin, 600) })));
  }

  async submissions(assignmentId: string, apiOrigin: string) {
    const a = await this.db.assignment.findFirst({ where: { id: assignmentId } });
    if (!a) throw AppException.notFound('Assignment not found');
    const rows = await this.db.assignmentSubmission.findMany({ where: { assignmentId }, orderBy: { submittedAt: 'desc' } });
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, fullName: true, email: true } });
    return Promise.all(rows.map(async (r) => ({ ...r, files: await this.fileViews(r.fileAssetIds, apiOrigin), student: users.find((u) => u.id === r.userId) })));
  }

  async grade(submissionId: string, dto: GradeSubmissionDto, graderId: string) {
    const s = await this.db.assignmentSubmission.findFirst({ where: { id: submissionId }, include: { assignment: true } });
    if (!s) throw AppException.notFound('Submission not found');
    if (dto.points > s.assignment.maxPoints) throw AppException.validation([{ field: 'points', message: `Maximum is ${s.assignment.maxPoints}` }]);
    return this.db.assignmentSubmission.update({ where: { id: submissionId }, data: { points: dto.points, feedback: dto.feedback ?? null, status: dto.status, gradedById: graderId, gradedAt: new Date() } });
  }

  // ── student ───────────────────────────────────────────────
  async forStudent(userId: string, lessonId: string, apiOrigin: string) {
    const { lesson, enrollment } = await this.learning.accessibleLesson(userId, lessonId);
    if (lesson.type !== 'ASSIGNMENT') throw AppException.notFound('Assignment not found');
    if (!enrollment) throw AppException.forbidden('Enrol to submit assignments.');
    const a = await this.db.assignment.findFirst({ where: { lessonId } });
    if (!a) throw AppException.notFound('Assignment not found');
    const sub = await this.db.assignmentSubmission.findFirst({ where: { assignmentId: a.id, userId } });
    return {
      id: a.id, instructions: a.instructions, dueAt: a.dueAt, maxPoints: a.maxPoints, allowLate: a.allowLate, allowFiles: a.allowFiles,
      submission: sub && { ...sub, files: await this.fileViews(sub.fileAssetIds, apiOrigin) },
      canSubmit: !sub || sub.status === 'RETURNED' || (sub.status === 'SUBMITTED' && (!a.dueAt || a.dueAt > new Date() || a.allowLate)),
    };
  }

  async submit(userId: string, lessonId: string, dto: SubmitAssignmentDto, apiOrigin: string) {
    const view = await this.forStudent(userId, lessonId, apiOrigin);
    if (!view.canSubmit) throw AppException.conflict(view.submission?.status === 'GRADED' ? 'This assignment has been graded.' : 'The deadline has passed.');
    const fileIds = view.allowFiles ? (dto.fileAssetIds ?? []) : [];
    if (!dto.text?.trim() && !fileIds.length) throw AppException.validation([{ field: 'text', message: 'Write an answer or attach a file' }]);
    if (fileIds.length) {
      const owned = await this.db.fileAsset.count({ where: { id: { in: fileIds }, ownerUserId: userId, status: 'READY', purpose: 'SUBMISSION' } });
      if (owned !== new Set(fileIds).size) throw AppException.validation([{ field: 'fileAssetIds', message: 'Attach files you uploaded for this submission' }]);
    }
    const isLate = Boolean(view.dueAt && view.dueAt < new Date());
    const tenantId = this.ctx.requireTenantId();
    await this.db.assignmentSubmission.upsert({
      where: { tenantId_assignmentId_userId: { tenantId, assignmentId: view.id, userId } },
      update: { text: dto.text ?? null, fileAssetIds: fileIds as never, status: 'SUBMITTED', isLate, submittedAt: new Date(), points: null, gradedAt: null },
      create: { assignmentId: view.id, userId, text: dto.text ?? null, fileAssetIds: fileIds as never, isLate } as never,
    });
    await this.learning.complete(userId, lessonId, { system: true });
    return this.forStudent(userId, lessonId, apiOrigin);
  }
}
