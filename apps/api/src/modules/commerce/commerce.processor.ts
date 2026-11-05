import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { QUEUES } from '../../core/queue/queue.constants.js';
import { OrdersService } from './orders.service.js';
import { WEBHOOK_JOB, WebhooksService } from './webhooks.service.js';

export const RECONCILE_JOB = 'reconcile-payments';

@Processor(QUEUES.WEBHOOKS_IN)
export class WebhooksProcessor extends WorkerHost {
  constructor(private readonly webhooks: WebhooksService) {
    super();
  }
  async process(job: Job<{ id: string }>) {
    if (job.name !== WEBHOOK_JOB) throw new Error(`Unknown webhook job: ${job.name}`);
    return this.webhooks.process(job.data.id);
  }
}

@Processor(QUEUES.COMMERCE)
export class CommerceProcessor extends WorkerHost {
  private readonly logger = new Logger(CommerceProcessor.name);
  constructor(private readonly orders: OrdersService) {
    super();
  }
  async process(job: Job) {
    if (job.name !== RECONCILE_JOB) throw new Error(`Unknown commerce job: ${job.name}`);
    const stats = await this.orders.reconcile();
    if (stats.payments || stats.refunds || stats.expired || stats.errors) this.logger.log(stats, 'reconciliation');
    return stats;
  }
}

@Injectable()
export class CommerceScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.COMMERCE) private readonly queue: Queue) {}
  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(RECONCILE_JOB, { every: 5 * 60_000 }, { name: RECONCILE_JOB });
  }
}
