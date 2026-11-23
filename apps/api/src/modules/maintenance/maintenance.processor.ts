import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { MAINTENANCE_JOBS, QUEUES } from '../../core/queue/queue.constants.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { HostResolverService } from '../../core/tenancy/host-resolver.service.js';
import { purgeExpiredTenants } from '../platform/tenant-purge.js';

/** Housekeeping jobs. Runs only in the worker process. */
@Processor(QUEUES.MAINTENANCE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hosts: HostResolverService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case MAINTENANCE_JOBS.PURGE_EXPIRED_IDEMPOTENCY_KEYS: {
        const { count } = await this.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } });
        this.logger.log(`Purged ${count} expired idempotency keys`);
        return { purged: count };
      }
      case MAINTENANCE_JOBS.PUBLISH_SCHEDULED_COURSES: {
        const { count } = await this.prisma.course.updateMany({
          where: { status: 'SCHEDULED', publishAt: { lte: new Date() }, deletedAt: null },
          data: { status: 'PUBLISHED', publishedAt: new Date(), publishAt: null },
        });
        if (count) this.logger.log(`Published ${count} scheduled course(s)`);
        return { published: count };
      }
      case MAINTENANCE_JOBS.PURGE_EXPIRED_TENANTS: {
        const result = await purgeExpiredTenants({ prisma: this.prisma, hosts: this.hosts, audit: this.audit });
        if (result.purgedCount) this.logger.log(`Purged ${result.purgedCount} expired pending-deletion tenant(s)`);
        return result;
      }
      default:
        throw new Error(`Unknown maintenance job: ${job.name}`);
    }
  }
}
