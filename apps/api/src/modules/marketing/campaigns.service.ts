import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AppException } from '../../common/errors/app-exception.js';
import { RichTextError, richTextToHtml, richTextToPlain, validateRichText } from '../../common/richtext/richtext.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { emailTemplates } from '../../core/mail/templates.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { QUEUES } from '../../core/queue/queue.constants.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { LeadsService } from './leads.service.js';

export const CAMPAIGN_SEND_JOB = 'campaign-send';

export interface Segment {
  type: 'all' | 'tag' | 'course';
  tag?: string;
  courseId?: string;
}

export interface CampaignInput {
  name?: string;
  subject?: string;
  previewText?: string | null;
  content?: unknown;
  segment?: Segment;
}

/** Email broadcasts to consented contacts only (unsubscribed and non-consented contacts are always excluded). */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly leads: LeadsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.MARKETING) private readonly queue: Queue,
  ) {}

  private async validate(input: CampaignInput) {
    const errors: { field: string; message: string }[] = [];
    if (input.name !== undefined && (!input.name.trim() || input.name.length > 120)) errors.push({ field: 'name', message: '1–120 characters' });
    if (input.subject !== undefined && (!input.subject.trim() || input.subject.length > 200)) errors.push({ field: 'subject', message: '1–200 characters' });
    if (input.content !== undefined) {
      try {
        validateRichText(input.content);
      } catch (e) {
        errors.push({ field: 'content', message: e instanceof RichTextError ? e.message : 'Invalid content' });
      }
    }
    if (input.segment !== undefined) {
      const sg = input.segment;
      if (!['all', 'tag', 'course'].includes(sg?.type)) errors.push({ field: 'segment', message: 'Choose who receives it' });
      if (sg?.type === 'tag' && !sg.tag?.trim()) errors.push({ field: 'segment.tag', message: 'Choose a tag' });
      if (sg?.type === 'course' && !(sg.courseId && (await this.db.course.findFirst({ where: { id: sg.courseId } })))) errors.push({ field: 'segment.courseId', message: 'Choose a course' });
    }
    if (errors.length) throw AppException.validation(errors);
  }

  private view(c: any) {
    return { id: c.id, name: c.name, subject: c.subject, previewText: c.previewText, content: c.content, segment: c.segment, status: c.status, scheduledAt: c.scheduledAt, sentAt: c.sentAt, stats: c.stats, createdAt: c.createdAt, updatedAt: c.updatedAt };
  }

  async list() {
    return (await this.db.campaign.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })).map((c) => this.view(c));
  }

  async get(id: string) {
    const c = await this.db.campaign.findFirst({ where: { id } });
    if (!c) throw AppException.notFound('Campaign not found');
    return { ...this.view(c), audience: await this.audienceCount(c.segment as unknown as Segment) };
  }

  async create(input: CampaignInput & { name: string; subject: string }, actorUserId: string) {
    await this.validate(input);
    const c = await this.db.campaign.create({
      data: { name: input.name.trim(), subject: input.subject.trim(), previewText: input.previewText?.trim() || null, content: (input.content ?? { type: 'doc', content: [] }) as never, segment: (input.segment ?? { type: 'all' }) as never, createdById: actorUserId } as never,
    });
    await this.audit.record({ action: 'campaign.create', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Campaign', targetId: c.id });
    return this.get(c.id);
  }

  async update(id: string, input: CampaignInput) {
    const c = await this.db.campaign.findFirst({ where: { id } });
    if (!c) throw AppException.notFound('Campaign not found');
    if (c.status !== 'DRAFT') throw AppException.conflict('Only drafts can be edited. Cancel the schedule first.');
    await this.validate(input);
    await this.db.campaign.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.subject !== undefined ? { subject: input.subject.trim() } : {}),
        ...(input.previewText !== undefined ? { previewText: input.previewText?.trim() || null } : {}),
        ...(input.content !== undefined ? { content: input.content as never } : {}),
        ...(input.segment !== undefined ? { segment: input.segment as never } : {}),
      },
    });
    return this.get(id);
  }

  private recipientsWhere(sg: Segment, userIds?: string[]) {
    return {
      marketingConsent: true, unsubscribedAt: null,
      ...(sg.type === 'tag' ? { tags: { array_contains: sg.tag!.toLowerCase() } } : {}),
      ...(sg.type === 'course' ? { userId: { in: userIds ?? [] } } : {}),
    };
  }

  private async courseUsers(sg: Segment) {
    if (sg.type !== 'course') return undefined;
    return (await this.db.enrollment.findMany({ where: { courseId: sg.courseId! }, select: { userId: true } })).map((e) => e.userId);
  }

  async audienceCount(sg: Segment) {
    const [consented, total] = await Promise.all([
      this.db.lead.count({ where: this.recipientsWhere(sg, await this.courseUsers(sg)) as never }),
      this.db.lead.count({ where: sg.type === 'tag' ? ({ tags: { array_contains: sg.tag!.toLowerCase() } } as never) : sg.type === 'course' ? ({ userId: { in: (await this.courseUsers(sg)) ?? [] } } as never) : {} }),
    ]);
    return { recipients: consented, excludedWithoutConsent: total - consented };
  }

  private async render(c: { subject: string; previewText: string | null; content: unknown }, unsubscribeUrl: string) {
    const tenantId = this.ctx.requireTenantId();
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { business: true } });
    const b = t.business;
    const address = [b?.legalName, b?.addressLine1, b?.city, b?.state, b?.country].filter(Boolean).join(', ') || null;
    return emailTemplates.campaign({ brand: t.name, subject: c.subject, previewText: c.previewText, bodyHtml: richTextToHtml(c.content), bodyText: richTextToPlain(c.content), unsubscribeUrl, address });
  }

  /** Sends a preview to the creator (no consent needed: it is their own address). */
  async test(id: string, to: string) {
    const c = await this.db.campaign.findFirst({ where: { id } });
    if (!c) throw AppException.notFound('Campaign not found');
    const email = await this.render(c, '#unsubscribe-preview');
    await this.mail.send({ to, tenantId: this.ctx.tenantId, tag: `campaign-test:${c.id}`, ...email, subject: `[Test] ${email.subject}` });
    return { sent: true, to };
  }

  async schedule(id: string, at: Date | null, actorUserId: string) {
    const c = await this.db.campaign.findFirst({ where: { id } });
    if (!c) throw AppException.notFound('Campaign not found');
    if (c.status !== 'DRAFT') throw AppException.conflict('This campaign was already scheduled or sent.');
    if (!richTextToPlain(c.content).trim()) throw AppException.validation([{ field: 'content', message: 'Write the email before sending' }]);
    if ((await this.audienceCount(c.segment as unknown as Segment)).recipients === 0) throw AppException.validation([{ field: 'segment', message: 'Nobody in this audience has agreed to receive marketing email' }]);
    const when = at && at.getTime() > Date.now() ? at : new Date();
    await this.db.campaign.update({ where: { id }, data: { status: 'SCHEDULED', scheduledAt: when } });
    await this.queue.add(CAMPAIGN_SEND_JOB, { tenantId: this.ctx.requireTenantId(), campaignId: id }, { jobId: `campaign-${id}`, delay: Math.max(0, when.getTime() - Date.now()), attempts: 3 });
    await this.audit.record({ action: 'campaign.schedule', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Campaign', targetId: id, after: { at: when } });
    return this.get(id);
  }

  async cancel(id: string, actorUserId: string) {
    const r = await this.db.campaign.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'DRAFT', scheduledAt: null } });
    if (!r.count) throw AppException.conflict('Only scheduled campaigns can be cancelled.');
    await this.queue.remove(`campaign-${id}`).catch(() => undefined);
    await this.audit.record({ action: 'campaign.cancel', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Campaign', targetId: id });
    return this.get(id);
  }

  /** Worker: resolves consented recipients at send time and queues one email each. */
  async send(tenantId: string, id: string) {
    return this.ctx.run(tenantId, async () => {
      const claimed = await this.db.campaign.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'SENDING' } });
      if (!claimed.count) return { skipped: true };
      const c = (await this.db.campaign.findFirst({ where: { id } }))!;
      const sg = c.segment as unknown as Segment;
      const leads = await this.db.lead.findMany({ where: this.recipientsWhere(sg, await this.courseUsers(sg)) as never, select: { id: true, email: true }, take: 50_000 });
      let sent = 0;
      for (const l of leads) {
        const already = await this.db.campaignRecipient.findFirst({ where: { campaignId: id, leadId: l.id } });
        if (already) continue;
        const unsubscribeUrl = this.leads.unsubscribeUrl(tenantId, l.id);
        const email = await this.render(c, unsubscribeUrl);
        await this.mail.send({ to: l.email, tenantId, tag: `campaign:${id}`, ...email, headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
        await this.db.campaignRecipient.create({ data: { campaignId: id, leadId: l.id, email: l.email, status: 'QUEUED' } as never });
        sent++;
      }
      await this.db.campaign.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), stats: { recipients: leads.length, queued: sent } } });
      return { sent };
    });
  }
}
