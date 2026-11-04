import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUES } from '../queue/queue.constants.js';
import type { RenderedEmail } from './templates.js';

export const SEND_EMAIL_JOB = 'send-email';

export interface EmailJob extends RenderedEmail {
  to: string;
  tenantId?: string | null;
  tag: string;
}

/** Enqueues transactional email; the worker delivers it (retries with backoff on SMTP failure). */
@Injectable()
export class MailService {
  constructor(@InjectQueue(QUEUES.NOTIFICATIONS) private readonly queue: Queue) {}

  async send(job: EmailJob): Promise<void> {
    await this.queue.add(SEND_EMAIL_JOB, job, { attempts: 6 });
  }
}
