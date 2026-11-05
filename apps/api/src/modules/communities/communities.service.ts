import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { isEnrollmentUsable } from '../learning/access.js';
import { NotificationsService } from '../notifications/notifications.service.js';

export interface Actor {
  userId: string;
  staff: boolean;
}

export interface CommunityInput {
  name?: string;
  description?: string | null;
  access?: 'ALL_STUDENTS' | 'COURSE' | 'MEMBERSHIP';
  courseId?: string | null;
  membershipPlanId?: string | null;
  staffOnlyPosts?: boolean;
}

const PAGE = 20;

/** Discussion spaces for students, moderated by the academy team. */
@Injectable()
export class CommunitiesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── spaces (staff) ────────────────────────────────────────
  private async validate(input: CommunityInput) {
    const errors: { field: string; message: string }[] = [];
    if (input.name !== undefined && (!input.name.trim() || input.name.length > 120)) errors.push({ field: 'name', message: '1–120 characters' });
    if (input.access === 'COURSE' && !(input.courseId && (await this.db.course.findFirst({ where: { id: input.courseId, deletedAt: null } })))) errors.push({ field: 'courseId', message: 'Choose a course' });
    if (input.access === 'MEMBERSHIP' && !(input.membershipPlanId && (await this.db.membershipPlan.findFirst({ where: { id: input.membershipPlanId } })))) errors.push({ field: 'membershipPlanId', message: 'Choose a membership plan' });
    if (errors.length) throw AppException.validation(errors);
  }

  async listAll() {
    const rows = await this.db.community.findMany({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, include: { _count: { select: { posts: true } } } });
    const openReports = await this.db.communityReport.count({ where: { status: 'OPEN' } });
    return { communities: rows.map(({ _count, ...c }) => ({ ...c, postCount: _count.posts })), openReports };
  }

  async create(input: CommunityInput & { name: string; access: 'ALL_STUDENTS' | 'COURSE' | 'MEMBERSHIP' }, actorUserId: string) {
    await this.validate(input);
    const c = await this.db.community.create({
      data: { name: input.name.trim(), description: input.description?.trim() || null, access: input.access, courseId: input.access === 'COURSE' ? input.courseId : null, membershipPlanId: input.access === 'MEMBERSHIP' ? input.membershipPlanId : null, staffOnlyPosts: Boolean(input.staffOnlyPosts), createdById: actorUserId } as never,
    });
    await this.audit.record({ action: 'community.create', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Community', targetId: c.id });
    return c;
  }

  async update(id: string, input: CommunityInput, actorUserId: string) {
    const c = await this.db.community.findFirst({ where: { id } });
    if (!c) throw AppException.notFound('Community not found');
    await this.validate({ ...input, access: input.access ?? (c.access as never), courseId: input.courseId ?? c.courseId, membershipPlanId: input.membershipPlanId ?? c.membershipPlanId });
    const u = await this.db.community.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.staffOnlyPosts !== undefined ? { staffOnlyPosts: input.staffOnlyPosts } : {}),
        ...(input.access ? { access: input.access, courseId: input.access === 'COURSE' ? input.courseId ?? c.courseId : null, membershipPlanId: input.access === 'MEMBERSHIP' ? input.membershipPlanId ?? c.membershipPlanId : null } : {}),
      },
    });
    await this.audit.record({ action: 'community.update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Community', targetId: id });
    return u;
  }

  async archive(id: string, actorUserId: string) {
    const r = await this.db.community.updateMany({ where: { id }, data: { status: 'ARCHIVED' } });
    if (!r.count) throw AppException.notFound('Community not found');
    await this.audit.record({ action: 'community.archive', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Community', targetId: id });
    return { archived: true };
  }

  // ── access ────────────────────────────────────────────────
  private async mayAccess(c: { access: string; courseId: string | null; membershipPlanId: string | null; status: string }, actor: Actor) {
    if (c.status !== 'ACTIVE') return false;
    if (actor.staff) return true;
    if (c.access === 'ALL_STUDENTS') return true;
    if (c.access === 'COURSE') return isEnrollmentUsable(await this.db.enrollment.findFirst({ where: { userId: actor.userId, courseId: c.courseId! } }));
    if (c.access === 'MEMBERSHIP') return Boolean(await this.db.membership.findFirst({ where: { userId: actor.userId, planId: c.membershipPlanId!, status: 'ACTIVE', currentPeriodEnd: { gt: new Date() } } }));
    return false;
  }

  private async community(id: string, actor: Actor) {
    const c = await this.db.community.findFirst({ where: { id } });
    if (!c || !(await this.mayAccess(c, actor))) throw AppException.notFound('Community not found');
    return c;
  }

  async accessibleFor(actor: Actor) {
    const rows = await this.db.community.findMany({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
    const out = [];
    for (const c of rows) if (await this.mayAccess(c, actor)) out.push({ id: c.id, name: c.name, description: c.description, staffOnlyPosts: c.staffOnlyPosts });
    return out;
  }

  // ── posts ─────────────────────────────────────────────────
  private async authors(ids: string[]) {
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  private postView(p: any, names: Map<string, string>, actor: Actor) {
    const likes = p.likes as string[];
    return {
      id: p.id, communityId: p.communityId, title: p.title, body: p.body, pinned: p.pinned, locked: p.locked, hidden: Boolean(p.hiddenAt), commentCount: p.commentCount, createdAt: p.createdAt,
      author: { name: names.get(p.authorId) ?? 'Former member', staff: p.authorRole === 'staff' }, mine: p.authorId === actor.userId, likeCount: likes.length, likedByMe: likes.includes(actor.userId),
    };
  }

  async posts(communityId: string, actor: Actor, cursor?: string) {
    const c = await this.community(communityId, actor);
    const rows = await this.db.communityPost.findMany({
      where: { communityId: c.id, ...(actor.staff ? {} : { hiddenAt: null }) }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: PAGE + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const names = await this.authors(rows.map((r) => r.authorId));
    return { community: { id: c.id, name: c.name, description: c.description, staffOnlyPosts: c.staffOnlyPosts }, items: rows.slice(0, PAGE).map((p) => this.postView(p, names, actor)), nextCursor: rows.length > PAGE ? rows[PAGE - 1].id : null };
  }

  async post(postId: string, actor: Actor) {
    const p = await this.db.communityPost.findFirst({ where: { id: postId } });
    if (!p || (p.hiddenAt && !actor.staff)) throw AppException.notFound('Post not found');
    await this.community(p.communityId, actor);
    const comments = await this.db.communityComment.findMany({ where: { postId, ...(actor.staff ? {} : { hiddenAt: null }) }, orderBy: { createdAt: 'asc' }, take: 500 });
    const names = await this.authors([p.authorId, ...comments.map((c) => c.authorId)]);
    return {
      ...this.postView(p, names, actor),
      comments: comments.map((c) => ({ id: c.id, body: c.body, hidden: Boolean(c.hiddenAt), createdAt: c.createdAt, author: { name: names.get(c.authorId) ?? 'Former member', staff: c.authorRole === 'staff' }, mine: c.authorId === actor.userId })),
    };
  }

  private rateLimit(count: number) {
    if (count >= 10) throw AppException.conflict('You are posting too quickly. Please wait a minute.');
  }

  async createPost(communityId: string, actor: Actor, input: { title?: string | null; body: string }) {
    const c = await this.community(communityId, actor);
    if (c.staffOnlyPosts && !actor.staff) throw AppException.forbidden('Only the academy team can post here.');
    const body = input.body.trim();
    if (!body || body.length > 5000) throw AppException.validation([{ field: 'body', message: '1–5000 characters' }]);
    this.rateLimit(await this.db.communityPost.count({ where: { authorId: actor.userId, createdAt: { gt: new Date(Date.now() - 60_000) } } }));
    const p = await this.db.communityPost.create({ data: { communityId: c.id, authorId: actor.userId, authorRole: actor.staff ? 'staff' : 'student', title: input.title?.trim().slice(0, 200) || null, body, likes: [] } as never });
    return this.post(p.id, actor);
  }

  async comment(postId: string, actor: Actor, text: string) {
    const p = await this.db.communityPost.findFirst({ where: { id: postId, hiddenAt: null } });
    if (!p) throw AppException.notFound('Post not found');
    const c = await this.community(p.communityId, actor);
    if (p.locked && !actor.staff) throw AppException.conflict('Comments are closed on this post.');
    const body = text.trim();
    if (!body || body.length > 2000) throw AppException.validation([{ field: 'body', message: '1–2000 characters' }]);
    this.rateLimit(await this.db.communityComment.count({ where: { authorId: actor.userId, createdAt: { gt: new Date(Date.now() - 60_000) } } }));
    await this.db.communityComment.create({ data: { postId, authorId: actor.userId, authorRole: actor.staff ? 'staff' : 'student', body } as never });
    await this.db.communityPost.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } });
    if (p.authorId !== actor.userId) {
      const [t, me] = await Promise.all([this.prisma.tenant.findUnique({ where: { id: p.tenantId }, select: { name: true } }), this.prisma.user.findUnique({ where: { id: actor.userId }, select: { fullName: true } })]);
      await this.notifications.notify({ userId: p.authorId, tenantId: p.tenantId, category: 'community', title: `New reply in ${c.name}`, body: `${me?.fullName ?? 'Someone'}: ${body.slice(0, 140)}`, link: `/learn/communities/${c.id}/posts/${p.id}`, brand: t?.name ?? '' }).catch(() => undefined);
    }
    return this.post(postId, actor);
  }

  async like(postId: string, actor: Actor) {
    const p = await this.db.communityPost.findFirst({ where: { id: postId, hiddenAt: null } });
    if (!p) throw AppException.notFound('Post not found');
    await this.community(p.communityId, actor);
    const likes = p.likes as string[];
    await this.db.communityPost.update({ where: { id: postId }, data: { likes: likes.includes(actor.userId) ? likes.filter((x) => x !== actor.userId) : [...likes, actor.userId] } });
    return this.post(postId, actor);
  }

  async deleteOwnPost(postId: string, actor: Actor) {
    const p = await this.db.communityPost.findFirst({ where: { id: postId } });
    if (!p || (p.authorId !== actor.userId && !actor.staff)) throw AppException.notFound('Post not found');
    await this.db.communityPost.delete({ where: { id: postId } });
    return { deleted: true };
  }

  async deleteOwnComment(commentId: string, actor: Actor) {
    const c = await this.db.communityComment.findFirst({ where: { id: commentId } });
    if (!c || (c.authorId !== actor.userId && !actor.staff)) throw AppException.notFound('Comment not found');
    await this.db.communityComment.delete({ where: { id: commentId } });
    await this.db.communityPost.update({ where: { id: c.postId }, data: { commentCount: { decrement: 1 } } });
    return { deleted: true };
  }

  async report(actor: Actor, input: { postId?: string; commentId?: string; reason: string }) {
    if (!input.postId && !input.commentId) throw AppException.validation([{ field: 'postId', message: 'Report a post or comment' }]);
    const postId = input.postId ?? (await this.db.communityComment.findFirst({ where: { id: input.commentId } }))?.postId;
    if (!postId) throw AppException.notFound('Not found');
    await this.post(postId, actor); // access check
    await this.db.communityReport.create({ data: { postId: input.postId ?? null, commentId: input.commentId ?? null, reporterId: actor.userId, reason: input.reason.trim().slice(0, 300) } as never });
    return { reported: true };
  }

  // ── moderation (staff) ────────────────────────────────────
  async moderatePost(postId: string, action: 'pin' | 'unpin' | 'lock' | 'unlock' | 'hide' | 'unhide', actorUserId: string) {
    const p = await this.db.communityPost.findFirst({ where: { id: postId } });
    if (!p) throw AppException.notFound('Post not found');
    const data = { pin: { pinned: true }, unpin: { pinned: false }, lock: { locked: true }, unlock: { locked: false }, hide: { hiddenAt: new Date() }, unhide: { hiddenAt: null } }[action];
    await this.db.communityPost.update({ where: { id: postId }, data });
    if (action === 'hide') await this.db.communityReport.updateMany({ where: { postId, status: 'OPEN' }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    await this.audit.record({ action: `community.post_${action}`, tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'CommunityPost', targetId: postId });
    return { ok: true };
  }

  async hideComment(commentId: string, hide: boolean, actorUserId: string) {
    const r = await this.db.communityComment.updateMany({ where: { id: commentId }, data: { hiddenAt: hide ? new Date() : null } });
    if (!r.count) throw AppException.notFound('Comment not found');
    if (hide) await this.db.communityReport.updateMany({ where: { commentId, status: 'OPEN' }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    await this.audit.record({ action: hide ? 'community.comment_hide' : 'community.comment_unhide', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'CommunityComment', targetId: commentId });
    return { ok: true };
  }

  async reports() {
    const rows = await this.db.communityReport.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' }, take: 200 });
    const posts = await this.db.communityPost.findMany({ where: { id: { in: rows.map((r) => r.postId).filter(Boolean) as string[] } }, select: { id: true, title: true, body: true, communityId: true } });
    const comments = await this.db.communityComment.findMany({ where: { id: { in: rows.map((r) => r.commentId).filter(Boolean) as string[] } }, select: { id: true, body: true, postId: true } });
    return rows.map((r) => ({ ...r, post: posts.find((p) => p.id === r.postId) ?? null, comment: comments.find((c) => c.id === r.commentId) ?? null }));
  }

  async resolveReport(id: string) {
    const r = await this.db.communityReport.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    if (!r.count) throw AppException.notFound('Report not found');
    return { resolved: true };
  }
}
