import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { QUEUES } from '../../core/queue/queue.constants.js';
import { OrdersService } from './orders.service.js';
import { RecoveryService } from './recovery.service.js';
import { AffiliatesService } from '../affiliates/affiliates.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { WEBHOOK_JOB, WebhooksService } from './webhooks.service.js';
import { BillingService, PLATFORM_WEBHOOK_JOB } from '../billing/billing.service.js';

export const BILLING_CYCLE_JOB = 'billing-cycle';

@Processor(QUEUES.BILLING)
export class BillingProcessor extends WorkerHost {
  private readonly logger = new Logger(BillingProcessor.name);
  constructor(private readonly billing: BillingService) {
    super();
  }
  async process(job: Job) {
    if (job.name !== BILLING_CYCLE_JOB) throw new Error(`Unknown billing job: ${job.name}`);
    const stats = await this.billing.runCycle();
    if (Object.values(stats).some(Boolean)) this.logger.log(stats, 'billing cycle');
    return stats;
  }
}

export const RECONCILE_JOB = 'reconcile-payments';

@Processor(QUEUES.WEBHOOKS_IN)
export class WebhooksProcessor extends WorkerHost {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly billing: BillingService,
  ) {
    super();
  }
  async process(job: Job<{ id: string; providerOrderId?: string }>) {
    if (job.name === WEBHOOK_JOB) return this.webhooks.process(job.data.id);
    if (job.name === PLATFORM_WEBHOOK_JOB) return this.billing.processWebhook(job.data.id, job.data.providerOrderId!);
    throw new Error(`Unknown webhook job: ${job.name}`);
  }
}

@Processor(QUEUES.COMMERCE)
export class CommerceProcessor extends WorkerHost {
  private readonly logger = new Logger(CommerceProcessor.name);
  constructor(private readonly orders: OrdersService, private readonly affiliates: AffiliatesService, private readonly memberships: MembershipsService, private readonly recovery: RecoveryService) {
    super();
  }
  async process(job: Job) {
    if (job.name !== RECONCILE_JOB) throw new Error(`Unknown commerce job: ${job.name}`);
    const stats = { ...(await this.orders.reconcile()), ...(await this.affiliates.approveDue()), memberships: await this.memberships.maintain(), ...(await this.recovery.run()) };
    if (stats.payments || stats.refunds || stats.expired || stats.errors || stats.approved || stats.memberships.reminded || stats.memberships.expired || stats.recoveryReminders) this.logger.log(stats, 'reconciliation');
    return stats;
  }
}

@Injectable()
export class CommerceScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUES.COMMERCE) private readonly queue: Queue,
    @InjectQueue(QUEUES.BILLING) private readonly billingQueue: Queue,
  ) {}
  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(RECONCILE_JOB, { every: 5 * 60_000 }, { name: RECONCILE_JOB });
    await this.billingQueue.upsertJobScheduler(BILLING_CYCLE_JOB, { every: 15 * 60_000 }, { name: BILLING_CYCLE_JOB });
  }
}
