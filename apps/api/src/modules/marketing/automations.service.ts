import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AppException } from '../../common/errors/app-exception.js';
import { RichTextError, richTextToHtml, richTextToPlain, validateRichText } from '../../common/richtext/richtext.js';
import { AuditService } from '../../core/audit/audit.service.js';
import type { AppEventMap, AppEventName } from '../../core/events/app-events.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { emailTemplates } from '../../core/mail/templates.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { QUEUES } from '../../core/queue/queue.constants.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { enrollmentExpiry, isEnrollmentUsable } from '../learning/access.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { LeadsService } from './leads.service.js';

export const AUTOMATION_STEP_JOB = 'automation-step';
export const TRIGGERS = ['student.registered', 'course.enrolled', 'course.completed', 'order.paid', 'lead.created'] as const;
const MAX_STEPS = 20;
const MAX_WAIT_MINUTES = 60 * 24 * 90;

export type Step =
  | { type: 'wait'; minutes: number }
  | { type: 'email'; subject: string; content: unknown }
  | { type: 'tag'; tag: string }
  | { type: 'enroll'; courseId: string }
  | { type: 'batch'; batchId: string }
  | { type: 'notify'; title: string; body: string };

export interface AutomationInput {
  name?: string;
  trigger?: string;
  filter?: { courseId?: string | null } | null;
  steps?: Step[];
}

/**
 * Trigger → steps workflows. Each person goes through an automation once per trigger occurrence
 * (dedupe key). Emails to leads require marketing consent; nobody who unsubscribed is emailed.
 */
@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly leads: LeadsService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.MARKETING) private readonly queue: Queue,
  ) {}

  // ── definitions ───────────────────────────────────────────
  private async validate(input: AutomationInput) {
    const errors: { field: string; message: string }[] = [];
    if (input.name !== undefined && (!input.name.trim() || input.name.length > 120)) errors.push({ field: 'name', message: '1–120 characters' });
    if (input.trigger !== undefined && !(TRIGGERS as readonly string[]).includes(input.trigger)) errors.push({ field: 'trigger', message: 'Choose a trigger' });
    if (input.filter?.courseId && !(await this.db.course.findFirst({ where: { id: input.filter.courseId } }))) errors.push({ field: 'filter.courseId', message: 'Course not found' });
    if (input.steps !== undefined) {
      if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > MAX_STEPS) errors.push({ field: 'steps', message: `Add 1–${MAX_STEPS} steps` });
      for (const [i, s] of (input.steps ?? []).entries()) {
        const at = `steps.${i}`;
        switch (s?.type) {
          case 'wait':
            if (!Number.isInteger(s.minutes) || s.minutes < 1 || s.minutes > MAX_WAIT_MINUTES) errors.push({ field: at, message: 'Wait 1 minute to 90 days' });
            break;
          case 'email':
            if (!s.subject?.trim() || s.subject.length > 200) errors.push({ field: `${at}.subject`, message: 'Add a subject' });
            try {
              validateRichText(s.content);
              if (!richTextToPlain(s.content).trim()) errors.push({ field: `${at}.content`, message: 'Write the email' });
            } catch (e) {
              errors.push({ field: `${at}.content`, message: e instanceof RichTextError ? e.message : 'Invalid content' });
            }
            break;
          case 'tag':
            if (!s.tag?.trim() || s.tag.length > 40) errors.push({ field: at, message: 'Add a tag' });
            break;
          case 'enroll':
            if (!(await this.db.course.findFirst({ where: { id: s.courseId, deletedAt: null } }))) errors.push({ field: at, message: 'Course not found' });
            break;
          case 'batch':
            if (!(await this.db.batch.findFirst({ where: { id: s.batchId, archivedAt: null } }))) errors.push({ field: at, message: 'Batch not found' });
            break;
          case 'notify':
            if (!s.title?.trim() || s.title.length > 160 || !s.body?.trim() || s.body.length > 500) errors.push({ field: at, message: 'Add a title and message' });
            break;
          default:
            errors.push({ field: at, message: 'Unknown step' });
        }
      }
      if ((input.steps ?? []).some((s) => s?.type === 'enroll' || s?.type === 'batch') && input.trigger === 'lead.created') errors.push({ field: 'steps', message: 'Leads have no student account to enrol' });
    }
    if (errors.length) throw AppException.validation(errors);
  }

  async list() {
    const rows = await this.db.automation.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { runs: true } } } });
    return rows.map(({ _count, ...a }) => ({ ...a, runCount: _count.runs }));
  }

  async get(id: string) {
    const a = await this.db.automation.findFirst({ where: { id } });
    if (!a) throw AppException.notFound('Automation not found');
    const runs = await this.db.automationRun.findMany({ where: { automationId: id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, email: true, name: true, status: true, stepIndex: true, nextAt: true, error: true, createdAt: true, log: true } });
    return { ...a, runs };
  }

  async create(input: Required<Pick<AutomationInput, 'name' | 'trigger' | 'steps'>> & AutomationInput, actorUserId: string) {
    await this.validate(input);
    const a = await this.db.automation.create({ data: { name: input.name.trim(), trigger: input.trigger, filter: (input.filter ?? null) as never, steps: input.steps as never, createdById: actorUserId } as never });
    await this.audit.record({ action: 'automation.create', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Automation', targetId: a.id, after: { trigger: a.trigger } });
    return this.get(a.id);
  }

  async update(id: string, input: AutomationInput & { status?: 'ACTIVE' | 'PAUSED' }, actorUserId: string) {
    const a = await this.db.automation.findFirst({ where: { id } });
    if (!a) throw AppException.notFound('Automation not found');
    await this.validate({ ...input, trigger: input.trigger ?? a.trigger });
    await this.db.automation.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
        ...(input.filter !== undefined ? { filter: (input.filter ?? null) as never } : {}),
        ...(input.steps !== undefined ? { steps: input.steps as never } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });
    if (input.status === 'PAUSED') await this.db.automationRun.updateMany({ where: { automationId: id, status: 'RUNNING' }, data: { status: 'CANCELLED' } });
    await this.audit.record({ action: 'automation.update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Automation', targetId: id, after: { status: input.status } });
    return this.get(id);
  }

  async remove(id: string, actorUserId: string) {
    const a = await this.db.automation.findFirst({ where: { id } });
    if (!a) throw AppException.notFound('Automation not found');
    await this.db.automation.delete({ where: { id } });
    await this.audit.record({ action: 'automation.delete', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Automation', targetId: id });
    return { deleted: true };
  }

  // ── execution (worker) ────────────────────────────────────
  async onEvent<K extends AppEventName>(name: K, payload: AppEventMap[K]) {
    const p = payload as any;
    return this.ctx.run(p.tenantId, async () => {
      const autos = await this.db.automation.findMany({ where: { trigger: name, status: 'ACTIVE' } });
      let started = 0;
      for (const a of autos) {
        const filter = a.filter as { courseId?: string | null } | null;
        if (filter?.courseId && !(p.courseId === filter.courseId || p.courseIds?.includes(filter.courseId))) continue;
        const who = await this.recipient(p);
        if (!who) continue;
        const dedupeKey = `${name}:${p.userId ?? p.leadId}:${p.courseId ?? p.orderId ?? ''}`.slice(0, 160);
        try {
          const run = await this.db.automationRun.create({ data: { automationId: a.id, dedupeKey, userId: p.userId ?? null, email: who.email, name: who.name, context: p, log: [] } as never });
          await this.queue.add(AUTOMATION_STEP_JOB, { runId: run.id, tenantId: p.tenantId }, { jobId: `run-${run.id}-0` });
          started++;
        } catch (e: any) {
          if (e?.code !== 'P2002') throw e; // already ran for this occurrence
        }
      }
      return { started };
    });
  }

  private async recipient(p: any) {
    if (p.userId) {
      const u = await this.prisma.user.findUnique({ where: { id: p.userId }, select: { email: true, fullName: true, status: true } });
      return u && u.status === 'ACTIVE' ? { email: u.email, name: u.fullName } : null;
    }
    if (p.leadId) {
      const l = await this.db.lead.findFirst({ where: { id: p.leadId } });
      return l ? { email: l.email, name: l.name } : null;
    }
    return null;
  }

  async runStep(runId: string) {
    const raw = await this.prisma.automationRun.findUnique({ where: { id: runId } });
    if (!raw || raw.status !== 'RUNNING') return { skipped: true };
    return this.ctx.run(raw.tenantId, async () => {
      const run = (await this.db.automationRun.findFirst({ where: { id: runId }, include: { automation: true } }))!;
      if (run.automation.status !== 'ACTIVE') {
        await this.db.automationRun.update({ where: { id: run.id }, data: { status: 'CANCELLED' } });
        return { cancelled: true };
      }
      const steps = run.automation.steps as unknown as Step[];
      const step = steps[run.stepIndex];
      const log = run.log as unknown as { step: number; type: string; result: string; at: string }[];
      if (!step) {
        await this.db.automationRun.update({ where: { id: run.id }, data: { status: 'DONE', nextAt: null } });
        return { done: true };
      }
      let result = 'ok';
      let delayMs = 0;
      try {
        result = await this.execute(run, step);
        if (step.type === 'wait') delayMs = step.minutes * 60_000;
      } catch (e) {
        await this.db.automationRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 500), log: [...log, { step: run.stepIndex, type: step.type, result: 'failed', at: new Date().toISOString() }] as never } });
        return { failed: true };
      }
      const next = run.stepIndex + 1;
      const done = next >= steps.length;
      await this.db.automationRun.update({
        where: { id: run.id },
        data: { stepIndex: next, status: done ? 'DONE' : 'RUNNING', nextAt: done ? null : new Date(Date.now() + delayMs), log: [...log, { step: run.stepIndex, type: step.type, result, at: new Date().toISOString() }] as never },
      });
      if (!done) await this.queue.add(AUTOMATION_STEP_JOB, { runId: run.id, tenantId: run.tenantId }, { jobId: `run-${run.id}-${next}`, delay: delayMs });
      return { step: run.stepIndex, result };
    });
  }

  private async execute(run: { id: string; tenantId: string; userId: string | null; email: string; name: string | null; automation: { trigger: string } }, step: Step): Promise<string> {
    switch (step.type) {
      case 'wait':
        return `waited ${step.minutes} min`;
      case 'email': {
        const lead = await this.leads.capture({ email: run.email, name: run.name, source: 'automation', userId: run.userId });
        if (lead.unsubscribedAt) return 'skipped: unsubscribed';
        // Leads (no account) need marketing consent; students get service emails about their own activity.
        if (!run.userId && !lead.marketingConsent) return 'skipped: no consent';
        const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: run.tenantId }, include: { business: true } });
        const unsubscribeUrl = this.leads.unsubscribeUrl(run.tenantId, lead.id);
        const email = emailTemplates.campaign({ brand: t.name, subject: step.subject, bodyHtml: richTextToHtml(step.content), bodyText: richTextToPlain(step.content), unsubscribeUrl, address: [t.business?.legalName, t.business?.city, t.business?.country].filter(Boolean).join(', ') || null });
        await this.mail.send({ to: run.email, tenantId: run.tenantId, tag: `automation:${run.id}`, ...email, headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
        return 'email queued';
      }
      case 'tag': {
        const lead = await this.leads.capture({ email: run.email, name: run.name, source: 'automation', userId: run.userId, tags: [step.tag] });
        return `tagged ${step.tag} (${lead.id})`;
      }
      case 'enroll': {
        if (!run.userId) return 'skipped: no account';
        const course = await this.db.course.findFirst({ where: { id: step.courseId, deletedAt: null } });
        if (!course) return 'skipped: course removed';
        const existing = await this.db.enrollment.findFirst({ where: { userId: run.userId, courseId: course.id } });
        if (isEnrollmentUsable(existing)) return 'already enrolled';
        const expiresAt = enrollmentExpiry(course, new Date());
        if (existing) await this.db.enrollment.update({ where: { id: existing.id }, data: { status: 'ACTIVE', startedAt: new Date(), expiresAt, source: 'MANUAL' } });
        else await this.db.enrollment.create({ data: { userId: run.userId, courseId: course.id, source: 'MANUAL', expiresAt } as never });
        return `enrolled in ${course.title}`;
      }
      case 'batch': {
        if (!run.userId) return 'skipped: no account';
        const exists = await this.db.batchMember.findFirst({ where: { batchId: step.batchId, userId: run.userId } });
        if (!exists) await this.db.batchMember.create({ data: { batchId: step.batchId, userId: run.userId } as never });
        return 'added to batch';
      }
      case 'notify': {
        if (!run.userId) return 'skipped: no account';
        const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: run.tenantId }, select: { name: true } });
        await this.notifications.notify({ userId: run.userId, tenantId: run.tenantId, category: 'learning', title: step.title, body: step.body, brand: t.name });
        return 'notified';
      }
      default:
        return 'skipped';
    }
  }
}
