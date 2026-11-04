import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from '../queue/queue.constants.js';
import { MailTransport } from './mail-transport.js';
import { SEND_EMAIL_JOB, type EmailJob } from './mail.service.js';

/** Worker-side delivery of queued notifications. */
@Processor(QUEUES.NOTIFICATIONS)
export class NotificationsProcessor extends WorkerHost {
  constructor(private readonly transport: MailTransport) {
    super();
  }

  async process(job: Job<EmailJob>): Promise<unknown> {
    if (job.name === SEND_EMAIL_JOB) return { messageId: await this.transport.deliver(job.data) };
    throw new Error(`Unknown notifications job: ${job.name}`);
  }
}
