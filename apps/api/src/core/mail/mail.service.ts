import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUES } from '../queue/queue.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { editableTemplate, renderContent, type TemplateContent } from './editable-templates.js';
import type { RenderedEmail } from './templates.js';

export const SEND_EMAIL_JOB = 'send-email';

export interface EmailJob extends RenderedEmail {
  to: string;
  tenantId?: string | null;
  tag: string;
  /** Extra headers, e.g. List-Unsubscribe for marketing email. */
  headers?: Record<string, string>;
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
  ) {}

  async send(job: EmailJob): Promise<void> {
    const { template, ...email } = job;
    if (template) Object.assign(email, await this.applyOverride(template.key, template.vars));
    await this.queue.add(SEND_EMAIL_JOB, email, { attempts: 6 });
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
