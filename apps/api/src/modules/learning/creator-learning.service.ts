import { Inject, Injectable } from '@nestjs/common';
import { FEATURES } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { Paginated } from '../../common/interceptors/response-envelope.interceptor.js';
import { toSkipTake, type PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { escapeHtml } from '../../core/mail/templates.js';
import { randomToken, sha256 } from '../../core/crypto/crypto.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { LearningService } from './learning.service.js';

@Injectable()
export class CreatorLearningService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly learning: LearningService,
    private readonly entitlements: EntitlementsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async students(q: PaginationQueryDto) {
    const tenantId = this.ctx.requireTenantId();
    const where = { tenantId, deletedAt: null, ...(q.q ? { OR: [{ fullName: { contains: q.q } }, { email: { contains: q.q } }] } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(q), select: { id: true, fullName: true, email: true, phone: true, status: true, emailVerifiedAt: true, lastLoginAt: true, createdAt: true } }),
      this.prisma.user.count({ where }),
    ]);
    const counts = await this.db.enrollment.groupBy({ by: ['userId'], where: { userId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
    return new Paginated(rows.map((r) => ({ ...r, enrollmentCount: counts.find((c) => c.userId === r.id)?._count._all ?? 0 })), { page: q.page, pageSize: q.pageSize, total });
  }

  async student(id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId: this.ctx.requireTenantId() }, select: { id: true, fullName: true, email: true, phone: true, status: true, emailVerifiedAt: true, lastLoginAt: true, createdAt: true } });
    if (!user) throw AppException.notFound('Student not found');
    const [enrollments, certificates, submissions] = await Promise.all([
      this.db.enrollment.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, include: { course: { select: { id: true, title: true } } } }),
      this.db.certificate.findMany({ where: { userId: id } }),
      this.db.assignmentSubmission.count({ where: { userId: id } }),
    ]);
    return { ...user, enrollments, certificates, submissions };
  }

  /** Grants a course to a student by email; new students get an account and a set-password email. */
  async enroll(courseId: string, email: string, actorUserId: string, origin: string) {
    const tenantId = this.ctx.requireTenantId();
    const course = await this.db.course.findFirst({ where: { id: courseId, deletedAt: null } });
    if (!course) throw AppException.notFound('Course not found');
    let user = await this.prisma.user.findUnique({ where: { realmKey_email: { realmKey: tenantId, email } } });
    let invited = false;
    if (!user) {
      const count = await this.prisma.user.count({ where: { tenantId, deletedAt: null } });
      await this.entitlements.assertWithinLimit(tenantId, FEATURES.STUDENTS_MAX.key, count);
      user = await this.prisma.user.create({ data: { realm: 'TENANT', realmKey: tenantId, tenantId, email, fullName: email.split('@')[0].slice(0, 120) } });
      invited = true;
    }
    const enrollment = await this.learning.grant(user.id, courseId, 'MANUAL', actorUserId);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
    let link = `${origin}/learn`;
    if (invited) {
      const token = randomToken(32);
      await this.prisma.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
      link = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
    }
    await this.mail.send({
      to: email, tenantId, tag: 'enrolled',
      subject: `You're enrolled in ${course.title}`,
      html: `<p>You now have access to <strong>${escapeHtml(course.title)}</strong> at ${escapeHtml(tenant.name)}.</p><p><a href="${escapeHtml(link)}">${invited ? 'Set your password and start learning' : 'Start learning'}</a></p>`,
      text: `You now have access to ${course.title} at ${tenant.name}: ${link}`,
    });
    await this.audit.record({ action: 'enrollment.grant', tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Enrollment', targetId: enrollment.id, after: { courseId, email } });
    return { enrollmentId: enrollment.id, invited };
  }

  async revoke(enrollmentId: string, actorUserId: string) {
    const e = await this.db.enrollment.findFirst({ where: { id: enrollmentId } });
    if (!e) throw AppException.notFound('Enrollment not found');
    await this.db.enrollment.update({ where: { id: enrollmentId }, data: { status: 'REVOKED' } });
    await this.audit.record({ action: 'enrollment.revoke', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Enrollment', targetId: enrollmentId });
    return { revoked: true };
  }

  async courseEnrollments(courseId: string) {
    const rows = await this.db.enrollment.findMany({ where: { courseId }, orderBy: { createdAt: 'desc' }, take: 1000 });
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, fullName: true, email: true } });
    return rows.map((r) => ({ ...r, student: users.find((u) => u.id === r.userId) }));
  }

  async discussions(filter: { unanswered?: boolean; courseId?: string }) {
    const roots = await this.db.lessonComment.findMany({ where: { parentId: null, hiddenAt: null, ...(filter.courseId ? { courseId: filter.courseId } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
    const replies = await this.db.lessonComment.findMany({ where: { parentId: { in: roots.map((r) => r.id) }, hiddenAt: null }, orderBy: { createdAt: 'asc' } });
    const ids = [...new Set([...roots, ...replies].map((c) => c.authorId))];
    const [users, lessons] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }),
      this.db.courseLesson.findMany({ where: { id: { in: roots.map((r) => r.lessonId) } }, select: { id: true, title: true, course: { select: { title: true } } } }),
    ]);
    const nm = (id: string) => users.find((u) => u.id === id)?.fullName ?? 'Former member';
    return roots
      .map((r) => ({
        id: r.id, body: r.body, createdAt: r.createdAt, isResolved: r.isResolved, author: nm(r.authorId),
        lesson: lessons.find((l) => l.id === r.lessonId),
        replies: replies.filter((x) => x.parentId === r.id).map((x) => ({ id: x.id, body: x.body, createdAt: x.createdAt, isInstructor: x.isInstructor, author: nm(x.authorId) })),
      }))
      .filter((t) => !filter.unanswered || !t.replies.some((x) => x.isInstructor));
  }

  async reply(commentId: string, body: string, userId: string) {
    const root = await this.db.lessonComment.findFirst({ where: { id: commentId, parentId: null } });
    if (!root) throw AppException.notFound('Thread not found');
    await this.db.lessonComment.create({ data: { courseId: root.courseId, lessonId: root.lessonId, authorId: userId, authorRealm: 'PLATFORM', parentId: root.id, body, isInstructor: true } as never });
    return { replied: true };
  }

  async moderate(commentId: string, action: 'hide' | 'resolve' | 'reopen', userId: string) {
    const c = await this.db.lessonComment.findFirst({ where: { id: commentId } });
    if (!c) throw AppException.notFound('Comment not found');
    await this.db.lessonComment.update({ where: { id: commentId }, data: action === 'hide' ? { hiddenAt: new Date() } : { isResolved: action === 'resolve' } });
    if (action === 'hide') await this.audit.record({ action: 'discussion.hide', tenantId: this.ctx.tenantId, actorUserId: userId, actorRealm: 'PLATFORM', targetType: 'LessonComment', targetId: commentId });
    return { ok: true };
  }
}
