import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { QUEUES } from '../../core/queue/queue.constants.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { VideoProcessingService } from './services/video-processing.service.js';
import { VideoUsageService } from './services/video-usage.service.js';
import { VIDEO_JOBS } from './services/video-webhook.service.js';

@Processor(QUEUES.VIDEO)
export class VideoProcessor extends WorkerHost {
  private readonly log = new Logger(VideoProcessor.name);
  constructor(
    private readonly processing: VideoProcessingService,
    private readonly usage: VideoUsageService,
    private readonly ctx: TenantContext,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job) {
    switch (job.name) {
      case VIDEO_JOBS.SYNC: {
        const { tenantId, videoId, eventId } = job.data as { tenantId: string; videoId: string; eventId?: string };
        const after = await this.ctx.run(tenantId, () => this.processing.sync(videoId, 'WEBHOOK'));
        if (eventId) await this.prisma.videoProcessingEvent.update({ where: { id: eventId }, data: { processedAt: new Date(), result: `status=${after.status} (retried)` } });
        return { status: after.status };
      }
      case VIDEO_JOBS.MAINTAIN: {
        const r = await this.processing.maintain();
        if (Object.values(r).some(Boolean)) this.log.log(`video maintenance: ${JSON.stringify(r)}`);
        return r;
      }
      case VIDEO_JOBS.USAGE:
        return this.usage.recordMonth();
      default:
        return null;
    }
  }
}

@Injectable()
export class VideoScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.VIDEO) private readonly queue: Queue) {}
  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(VIDEO_JOBS.MAINTAIN, { every: 5 * 60_000 }, { name: VIDEO_JOBS.MAINTAIN });
    await this.queue.upsertJobScheduler(VIDEO_JOBS.USAGE, { every: 6 * 3600_000 }, { name: VIDEO_JOBS.USAGE });
  }
}
