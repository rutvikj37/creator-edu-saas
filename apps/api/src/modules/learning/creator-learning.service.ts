import { Inject, Injectable, Logger } from '@nestjs/common';
import { FEATURES } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { Paginated } from '../../common/interceptors/response-envelope.interceptor.js';
import { toSkipTake, type PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { AppConfig } from '../../config/app-config.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { emailTemplates, escapeHtml } from '../../core/mail/templates.js';
import { randomToken, sha256 } from '../../core/crypto/crypto.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { academyOrigin } from '../tenants/academy-origin.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { LearningService } from './learning.service.js';

export type StudentInput = { email: string; fullName: string; phone?: string | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Strips spaces, dashes, dots and brackets. Returns null when empty, false when it isn't a phone number. */
export function normalizePhone(raw: string | null | undefined): string | null | false {
  const v = (raw ?? '').replace(/[\s\-().]/g, '');
  if (!v) return null;
  return /^\+?\d{7,15}$/.test(v) ? v : false;
}

export interface StudentFilters {
  joinedFrom?: string; joinedTo?: string; activeFrom?: string; neverSignedIn?: string; courseId?: string;
  membershipPlanId?: string; membershipStatus?: 'active' | 'expired'; coachingProgramId?: string; communityId?: string; webinarId?: string;
  verifiedEmail?: 'yes' | 'no'; verifiedMobile?: 'yes' | 'no'; deactivated?: 'yes' | 'no';
  source?: 'website' | 'checkout' | 'google' | 'added'; utmSource?: string; marketingConsent?: 'yes' | 'no'; tag?: string;
  customFieldId?: string; customValue?: string;
}

@Injectable()
export class CreatorLearningService {
  private readonly logger = new Logger(CreatorLearningService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly ctx: TenantContext,
    private readonly learning: LearningService,
    private readonly entitlements: EntitlementsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async students(q: PaginationQueryDto & StudentFilters) {
    const tenantId = this.ctx.requireTenantId();
    const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
    const where: Record<string, unknown> = { tenantId, deletedAt: null, ...(q.q ? { OR: [{ fullName: { contains: q.q } }, { email: { contains: q.q } }] } : {}) };
    if (q.joinedFrom || q.joinedTo) where.createdAt = { ...(q.joinedFrom ? { gte: day(q.joinedFrom) } : {}), ...(q.joinedTo ? { lt: new Date(day(q.joinedTo).getTime() + 86_400_000) } : {}) };
    if (q.neverSignedIn === 'true') where.lastLoginAt = null;
    else if (q.activeFrom) where.lastLoginAt = { gte: day(q.activeFrom) };
    if (q.verifiedEmail) where.emailVerifiedAt = q.verifiedEmail === 'yes' ? { not: null } : null;
    if (q.verifiedMobile) where.phoneVerifiedAt = q.verifiedMobile === 'yes' ? { not: null } : null;
    if (q.deactivated === 'yes') where.status = { not: 'ACTIVE' };
    else if (q.deactivated === 'no') where.status = 'ACTIVE';
    // Each filter that needs another table narrows a set of user ids; the sets are intersected.
    const sets = await this.studentIdSets(tenantId, q);
    if (sets.length) {
      let ids = sets[0];
      for (const s2 of sets.slice(1)) ids = new Set([...ids].filter((x) => s2.has(x)));
      where.id = { in: [...ids] };
    }
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(q), select: { id: true, fullName: true, email: true, phone: true, status: true, emailVerifiedAt: true, lastLoginAt: true, createdAt: true } }),
      this.prisma.user.count({ where }),
    ]);
    const counts = await this.db.enrollment.groupBy({ by: ['userId'], where: { userId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
    return new Paginated(rows.map((r) => ({ ...r, enrollmentCount: counts.find((c) => c.userId === r.id)?._count._all ?? 0 })), { page: q.page, pageSize: q.pageSize, total });
  }

  /** User-id sets for the learner filters that live in other tables (course, membership, coaching, club, webinar, source, UTM, consent, tag). */
  private async studentIdSets(tenantId: string, q: StudentFilters): Promise<Set<string>[]> {
    const sets: Set<string>[] = [];
    const ids = (rows: { userId: string | null }[]) => new Set(rows.map((r) => r.userId).filter((x): x is string => Boolean(x)));
    const LIMIT = 50_000;
    if (q.courseId) sets.push(ids(await this.db.enrollment.findMany({ where: { courseId: q.courseId }, select: { userId: true }, take: LIMIT })));
    if (q.membershipPlanId || q.membershipStatus) {
      const now = new Date();
      const status = q.membershipStatus === 'active' ? { status: 'ACTIVE', currentPeriodEnd: { gt: now } } : q.membershipStatus === 'expired' ? { OR: [{ status: { not: 'ACTIVE' } }, { currentPeriodEnd: { lte: now } }] } : {};
      sets.push(ids(await this.db.membership.findMany({ where: { ...(q.membershipPlanId ? { planId: q.membershipPlanId } : {}), ...status }, select: { userId: true }, take: LIMIT })));
    }
    if (q.coachingProgramId) sets.push(ids(await this.db.coachingAccess.findMany({ where: { programId: q.coachingProgramId }, select: { userId: true }, take: LIMIT })));
    if (q.communityId) {
      // A club's members are the learners with access to its course or membership plan (or everyone for an open club).
      const club = await this.db.community.findFirst({ where: { id: q.communityId }, select: { courseId: true, membershipPlanId: true } });
      if (!club) sets.push(new Set());
      else if (club.courseId) sets.push(ids(await this.db.enrollment.findMany({ where: { courseId: club.courseId }, select: { userId: true }, take: LIMIT })));
      else if (club.membershipPlanId) sets.push(ids(await this.db.membership.findMany({ where: { planId: club.membershipPlanId, status: 'ACTIVE' }, select: { userId: true }, take: LIMIT })));
    }
    if (q.webinarId) sets.push(ids(await this.db.webinarRegistration.findMany({ where: { liveClassId: q.webinarId, cancelledAt: null }, select: { userId: true }, take: LIMIT })));
    if (q.source) {
      // How the account started: a sign-up on the website, a guest checkout, Google, or added by the academy.
      const starts = await this.prisma.loginHistory.findMany({ where: { realmKey: tenantId, success: true, method: { in: ['register', 'checkout', 'google'] } }, select: { userId: true, method: true }, distinct: ['userId'], orderBy: { createdAt: 'asc' }, take: LIMIT });
      const method = ({ website: 'register', checkout: 'checkout', google: 'google' } as Record<string, string | undefined>)[q.source];
      if (method) sets.push(new Set(starts.filter((x) => x.method === method && x.userId).map((x) => x.userId!)));
      else {
        const self = new Set(starts.map((x) => x.userId).filter(Boolean) as string[]);
        const all = await this.prisma.user.findMany({ where: { tenantId, deletedAt: null }, select: { id: true }, take: LIMIT });
        sets.push(new Set(all.map((u) => u.id).filter((x) => !self.has(x))));
      }
    }
    if (q.utmSource) sets.push(ids(await this.db.order.findMany({ where: { attribution: { path: '$.source', equals: q.utmSource } }, select: { userId: true }, take: LIMIT })));
    if (q.marketingConsent || q.tag) {
      const leads = await this.db.lead.findMany({
        where: { ...(q.marketingConsent === 'yes' ? { marketingConsent: true, unsubscribedAt: null } : {}), ...(q.tag ? { tags: { array_contains: q.tag } } : {}) },
        select: { userId: true, email: true }, take: LIMIT,
      });
      const byEmail = leads.filter((l) => !l.userId).map((l) => l.email);
      const linked = byEmail.length ? await this.prisma.user.findMany({ where: { tenantId, email: { in: byEmail } }, select: { id: true } }) : [];
      const yes = new Set([...ids(leads), ...linked.map((u) => u.id)]);
      if (q.marketingConsent === 'no') {
        const all = await this.prisma.user.findMany({ where: { tenantId, deletedAt: null }, select: { id: true }, take: LIMIT });
        sets.push(new Set(all.map((u) => u.id).filter((x) => !yes.has(x))));
      } else sets.push(yes);
    }
    if (q.customFieldId && q.customValue !== undefined) {
      sets.push(ids(await this.db.customFieldValue.findMany({ where: { fieldId: q.customFieldId, value: { contains: q.customValue } }, select: { userId: true }, take: LIMIT })));
    }
    return sets;
  }

  /** Choices for the learner filters that come from data: UTM sources seen at checkout and contact tags. */
  async studentFilterOptions() {
    const [orders, leads] = await Promise.all([
      this.db.order.findMany({ where: { attribution: { not: null as never } }, select: { attribution: true }, orderBy: { createdAt: 'desc' }, take: 5000 }),
      this.db.lead.findMany({ select: { tags: true }, take: 5000 }),
    ]);
    const utm = new Set<string>();
    for (const o of orders) { const src = (o.attribution as { source?: unknown } | null)?.source; if (typeof src === 'string' && src) utm.add(src.slice(0, 60)); }
    const tags = new Set<string>();
    for (const l of leads) for (const t of Array.isArray(l.tags) ? l.tags : []) if (typeof t === 'string') tags.add(t);
    return { utmSources: [...utm].sort(), tags: [...tags].sort() };
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
  async enroll(courseId: string, email: string, actorUserId: string) {
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
    const { origin, name: brand } = await academyOrigin(this.prisma, this.config, tenantId);
    let link = `${origin}/learn`;
    if (invited) {
      const token = randomToken(32);
      await this.prisma.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
      link = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
    }
    try {
      await this.mail.send({
        to: email, tenantId, tag: 'enrolled',
        subject: `You're enrolled in ${course.title}`,
        html: `<p>You now have access to <strong>${escapeHtml(course.title)}</strong> at ${escapeHtml(brand)}.</p><p><a href="${escapeHtml(link)}">${invited ? 'Set your password and start learning' : 'Start learning'}</a></p>`,
        text: `You now have access to ${course.title} at ${brand}: ${link}`,
      });
    } catch (e) {
      this.logger.warn({ err: (e as Error).message, email, tenantId }, 'enrollment email failed to enqueue');
    }
    await this.audit.record({ action: 'enrollment.grant', tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Enrollment', targetId: enrollment.id, after: { courseId, email } });
    return { enrollmentId: enrollment.id, invited };
  }

  /** Creates one student account, optionally enrols it in courses and emails a set-password link. */
  async addStudent(input: StudentInput & { courseIds?: string[]; sendInvite?: boolean }, actorUserId: string) {
    const tenantId = this.ctx.requireTenantId();
    const courses = await this.coursesById(input.courseIds ?? []);
    const email = input.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { realmKey_email: { realmKey: tenantId, email } }, select: { id: true } })) {
      throw AppException.conflict('A student with this email already exists. Open them from the list to enrol them in a course.');
    }
    const phone = input.phone || null;
    if (phone && (await this.prisma.user.findUnique({ where: { realmKey_phone: { realmKey: tenantId, phone } }, select: { id: true } }))) {
      throw AppException.conflict('Another student already uses this phone number.');
    }
    const count = await this.prisma.user.count({ where: { tenantId, deletedAt: null } });
    await this.entitlements.assertWithinLimit(tenantId, FEATURES.STUDENTS_MAX.key, count);
    const fullName = input.fullName.trim().slice(0, 120);
    const user = await this.prisma.user.create({ data: { realm: 'TENANT', realmKey: tenantId, tenantId, email, phone, fullName } });
    for (const c of courses) await this.learning.grant(user.id, c.id, 'MANUAL', actorUserId);
    if (input.sendInvite !== false) await this.sendWelcome(tenantId, user.id, email, fullName, courses);
    await this.audit.record({ action: 'student.create', tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'User', targetId: user.id, after: { email, courseIds: courses.map((c) => c.id) } });
    return { id: user.id, invited: input.sendInvite !== false, enrolled: courses.length };
  }

  /**
   * Bulk import from a parsed CSV. Rows are validated one by one so a bad row never blocks the rest:
   * new emails get an account, existing students are only enrolled in the chosen courses.
   */
  async importStudents(rows: StudentInput[], opts: { courseIds?: string[]; sendInvite?: boolean }, actorUserId: string) {
    const tenantId = this.ctx.requireTenantId();
    const courses = await this.coursesById(opts.courseIds ?? []);
    const sendInvite = opts.sendInvite !== false;
    const failed: { row: number; email: string; reason: string }[] = [];
    let created = 0;
    let existing = 0;
    let count = await this.prisma.user.count({ where: { tenantId, deletedAt: null } });
    const seen = new Set<string>();

    for (const [i, raw] of rows.entries()) {
      const row = i + 2; // spreadsheet row number: header is row 1
      const email = (raw.email ?? '').trim().toLowerCase();
      const fullName = (raw.fullName ?? '').trim() || email.split('@')[0];
      const phone = normalizePhone(raw.phone);
      const fail = (reason: string) => failed.push({ row, email: raw.email ?? '', reason });
      if (!EMAIL_RE.test(email) || email.length > 191) { fail('Invalid email address'); continue; }
      if (seen.has(email)) { fail('Duplicate email in file'); continue; }
      seen.add(email);
      if (phone === false) { fail('Invalid phone number'); continue; }
      try {
        const found = await this.prisma.user.findUnique({ where: { realmKey_email: { realmKey: tenantId, email } }, select: { id: true } });
        if (found) {
          for (const c of courses) await this.learning.grant(found.id, c.id, 'MANUAL', actorUserId);
          existing++;
          continue;
        }
        if (phone && (await this.prisma.user.findUnique({ where: { realmKey_phone: { realmKey: tenantId, phone } }, select: { id: true } }))) {
          fail('Phone number already used by another student');
          continue;
        }
        await this.entitlements.assertWithinLimit(tenantId, FEATURES.STUDENTS_MAX.key, count);
        const user = await this.prisma.user.create({ data: { realm: 'TENANT', realmKey: tenantId, tenantId, email, phone: phone || null, fullName: fullName.slice(0, 120) } });
        count++;
        created++;
        for (const c of courses) await this.learning.grant(user.id, c.id, 'MANUAL', actorUserId);
        if (sendInvite) await this.sendWelcome(tenantId, user.id, email, user.fullName, courses);
      } catch (e) {
        fail(e instanceof AppException ? e.message : 'Could not create this student');
      }
    }
    await this.audit.record({ action: 'student.import', tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Tenant', targetId: tenantId, after: { rows: rows.length, created, existing, failed: failed.length, courseIds: courses.map((c) => c.id) } });
    return { total: rows.length, created, existing, failed };
  }

  private async coursesById(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const courses = await this.db.course.findMany({ where: { id: { in: unique }, deletedAt: null }, select: { id: true, title: true } });
    if (courses.length !== unique.length) throw AppException.notFound('One of the selected courses was not found');
    return courses;
  }

  /**
   * Emails a new student a 7-day set-password link on the academy portal.
   * Enqueue failures are logged so student creation still succeeds.
   */
  private async sendWelcome(tenantId: string, userId: string, email: string, fullName: string, courses: { title: string }[]) {
    const { origin, name: brand } = await academyOrigin(this.prisma, this.config, tenantId);
    const token = randomToken(32);
    await this.prisma.passwordReset.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
    const url = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
    const coursesBlock = courses.length ? `You have access to:\n\n${courses.map((c) => `- ${c.title}`).join('\n')}` : '';
    try {
      await this.mail.send({
        to: email, tenantId, tag: 'student-invite',
        ...emailTemplates.studentInvite({ brand, name: fullName, url, courses: coursesBlock }),
      });
    } catch (e) {
      this.logger.warn({ err: (e as Error).message, email, tenantId }, 'student invite email failed to enqueue');
    }
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
