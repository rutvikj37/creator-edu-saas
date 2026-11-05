import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { QUEUES } from '../../core/queue/queue.constants.js';
import { ChannelsService, ChannelUnavailable, PushGone } from './channels.js';
import { MESSAGING_JOBS } from './notifications.service.js';

/** Delivers SMS, WhatsApp and push in the worker (retried with backoff by BullMQ). */
@Processor(QUEUES.MESSAGING)
export class MessagingProcessor extends WorkerHost {
  private readonly logger = new Logger(MessagingProcessor.name);
  constructor(
    private readonly channels: ChannelsService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job) {
    try {
      switch (job.name) {
        case MESSAGING_JOBS.SMS:
          return await this.channels.sendSms(job.data.to, job.data.text);
        case MESSAGING_JOBS.WHATSAPP:
          return await this.channels.sendWhatsapp(job.data.to, job.data.title, job.data.body);
        case MESSAGING_JOBS.PUSH: {
          const subs = await this.prisma.pushSubscription.findMany({ where: { userId: job.data.userId } });
          let sent = 0;
          for (const s of subs) {
            try {
              await this.channels.sendPush(s, { title: job.data.title, body: job.data.body, link: job.data.link });
              await this.prisma.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } });
              sent++;
            } catch (e) {
              if (e instanceof PushGone) await this.prisma.pushSubscription.delete({ where: { id: s.id } });
              else this.logger.warn({ err: (e as Error).message }, 'push failed');
            }
          }
          return { sent };
        }
        default:
          throw new Error(`Unknown messaging job: ${job.name}`);
      }
    } catch (e) {
      // A channel switched off after queuing is not worth retrying.
      if (e instanceof ChannelUnavailable) return { skipped: e.message };
      throw e;
    }
  }
}
