import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUES } from '../queue/queue.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { editableTemplate, renderContent, type TemplateContent } from './editable-templates.js';
import type { RenderedEmail } from './templates.js';
import { AcademyPreferencesService } from '../settings/academy-preferences.service.js';

export const SEND_EMAIL_JOB = 'send-email';

export interface EmailJob extends RenderedEmail {
  to: string;
  tenantId?: string | null;
  tag: string;
  /** Extra headers, e.g. List-Unsubscribe for marketing email. */
  headers?: Record<string, string>;
  /** Carries a secret (e.g. a generated password): the queued job is deleted as soon as it is delivered. */
  sensitive?: boolean;
  /** Display name for the From header (the academy's sender name). */
  fromName?: string;
  replyTo?: string;
}

const OVERRIDE_TTL_MS = 30_000;

/** Enqueues transactional email; the worker delivers it (retries with backoff on SMTP failure). */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private overrides: { at: number; byKey: Map<string, TemplateContent> } | null = null;

  constructor(
    @InjectQueue(QUEUES.NOTIFICATIONS) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly prefs: AcademyPreferencesService,
  ) {}

  async send(job: EmailJob): Promise<void> {
    const { template, sensitive, ...email } = job;
    if (job.tenantId) {
      // Academy communications settings: emails it switched off are skipped; sender name and reply-to apply.
      try {
        if (!(await this.prefs.emailEnabled(job.tenantId, job.tag))) return;
        const c = await this.prefs.get(job.tenantId, 'communications');
        if (c.senderName && !email.fromName) email.fromName = c.senderName;
        if (c.replyTo && !email.replyTo) email.replyTo = c.replyTo;
      } catch (e) {
        this.logger.warn({ err: (e as Error).message, tenantId: job.tenantId }, 'academy email preferences unavailable; sending with defaults');
      }
    }
    if (template) Object.assign(email, await this.applyOverride(template.key, template.vars));
    await this.queue.add(SEND_EMAIL_JOB, email, sensitive ? { attempts: 6, removeOnComplete: true, removeOnFail: { age: 24 * 3600 } } : { attempts: 6 });
  }

  /** Drops cached overrides after Super Admin edits a template. */
  invalidateOverrides() {
    this.overrides = null;
  }

  private async applyOverride(key: string, vars: Record<string, string>): Promise<Partial<RenderedEmail>> {
    const tpl = editableTemplate(key);
    if (!tpl) return {};
    try {
      if (!this.overrides || Date.now() - this.overrides.at > OVERRIDE_TTL_MS) {
        const rows = await this.prisma.emailTemplateOverride.findMany();
        this.overrides = { at: Date.now(), byKey: new Map(rows.map((r) => [r.key, r])) };
      }
      const content = this.overrides.byKey.get(key);
      return content ? renderContent(tpl, content, vars) : {};
    } catch (e) {
      this.logger.warn({ err: (e as Error).message, key }, 'email template override lookup failed; using the built-in wording');
      return {};
    }
  }
}
