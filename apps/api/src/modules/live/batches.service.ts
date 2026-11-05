import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { LearningService } from '../learning/learning.service.js';

export interface BatchInput {
  name?: string;
  description?: string | null;
  courseId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  capacity?: number | null;
}

/** Cohorts of students. A batch linked to a course enrols its members (source BATCH). */
@Injectable()
export class BatchesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly learning: LearningService,
    private readonly audit: AuditService,
  ) {}

  private async validate(input: BatchInput) {
    const errors: { field: string; message: string }[] = [];
    if (input.name !== undefined && (!input.name.trim() || input.name.trim().length > 120)) errors.push({ field: 'name', message: '1–120 characters' });
    if (input.courseId && !(await this.db.course.findFirst({ where: { id: input.courseId, deletedAt: null } }))) errors.push({ field: 'courseId', message: 'Course not found' });
    if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) errors.push({ field: 'endsAt', message: 'End must be after the start' });
    if (errors.length) throw AppException.validation(errors);
  }

  async list() {
    const rows = await this.db.batch.findMany({ where: { archivedAt: null }, include: { _count: { select: { members: true } } }, orderBy: { createdAt: 'desc' } });
    return rows.map(({ _count, ...b }) => ({ ...b, memberCount: _count.members }));
  }

  async create(input: BatchInput & { name: string }, actorUserId: string) {
    await this.validate(input);
    const b = await this.db.batch.create({
      data: { name: input.name.trim(), description: input.description?.trim() || null, courseId: input.courseId ?? null, startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null, capacity: input.capacity ?? null, createdById: actorUserId } as never,
    });
    await this.audit.record({ action: 'batch.create', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Batch', targetId: b.id, after: { name: b.name } });
    return this.get(b.id);
  }

  async get(id: string) {
    const b = await this.db.batch.findFirst({ where: { id, archivedAt: null }, include: { members: { orderBy: { addedAt: 'asc' } } } });
    if (!b) throw AppException.notFound('Batch not found');
    const users = await this.prisma.user.findMany({ where: { id: { in: b.members.map((m) => m.userId) } }, select: { id: true, fullName: true, email: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return { ...b, members: b.members.map((m) => ({ id: m.id, addedAt: m.addedAt, user: byId.get(m.userId) ?? null })) };
  }

  async update(id: string, input: BatchInput, actorUserId: string) {
    await this.get(id);
    await this.validate(input);
    await this.db.batch.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.courseId !== undefined ? { courseId: input.courseId } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt ? new Date(input.startsAt) : null } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt ? new Date(input.endsAt) : null } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      },
    });
    await this.audit.record({ action: 'batch.update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Batch', targetId: id, after: input as never });
    return this.get(id);
  }

  /** Adds existing students of this academy by email. Unknown emails are reported back, not created. */
  async addMembers(id: string, emails: string[], actorUserId: string) {
    const b = await this.get(id);
    const tenantId = this.ctx.requireTenantId();
    const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 500);
    const users = await this.prisma.user.findMany({ where: { tenantId, realm: 'TENANT', email: { in: wanted }, deletedAt: null }, select: { id: true, email: true } });
    const existing = new Set(b.members.map((m) => m.user?.id));
    const toAdd = users.filter((u) => !existing.has(u.id));
    if (b.capacity && b.members.length + toAdd.length > b.capacity) throw AppException.validation([{ field: 'emails', message: `This batch holds ${b.capacity} students` }]);
    for (const u of toAdd) {
      await this.db.batchMember.create({ data: { batchId: id, userId: u.id } as never });
      if (b.courseId) await this.learning.grant(u.id, b.courseId, 'BATCH', actorUserId);
    }
    await this.audit.record({ action: 'batch.members_add', tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Batch', targetId: id, after: { added: toAdd.length } });
    const found = new Set(users.map((u) => u.email));
    return { added: toAdd.length, notFound: wanted.filter((e) => !found.has(e)), batch: await this.get(id) };
  }

  async removeMember(id: string, memberId: string, actorUserId: string) {
    await this.get(id);
    const r = await this.db.batchMember.deleteMany({ where: { id: memberId, batchId: id } });
    if (!r.count) throw AppException.notFound('Member not found');
    await this.audit.record({ action: 'batch.member_remove', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Batch', targetId: id });
    return this.get(id);
  }

  async archive(id: string, actorUserId: string) {
    await this.get(id);
    await this.db.batch.update({ where: { id }, data: { archivedAt: new Date() } });
    await this.audit.record({ action: 'batch.archive', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Batch', targetId: id });
    return { archived: true };
  }
}
