import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { MAINTENANCE_JOBS, QUEUES } from '../../core/queue/queue.constants.js';

/** Registers repeatable maintenance jobs (idempotent: BullMQ de-duplicates by scheduler id). */
@Injectable()
export class MaintenanceScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.MAINTENANCE) private readonly queue: Queue) {}

  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(
      MAINTENANCE_JOBS.PURGE_EXPIRED_IDEMPOTENCY_KEYS,
      { pattern: '17 * * * *' },
      { name: MAINTENANCE_JOBS.PURGE_EXPIRED_IDEMPOTENCY_KEYS },
    );
  }
}
