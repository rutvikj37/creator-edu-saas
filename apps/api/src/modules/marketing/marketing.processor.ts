import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { DOMAIN_EVENT_JOB } from '../../core/events/app-events.service.js';
import { QUEUES } from '../../core/queue/queue.constants.js';
import { CAMPAIGN_SEND_JOB, CampaignsService } from './campaigns.service.js';
import { AutomationsService, AUTOMATION_STEP_JOB } from './automations.service.js';

@Processor(QUEUES.MARKETING)
export class MarketingProcessor extends WorkerHost {
  private readonly logger = new Logger(MarketingProcessor.name);
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly automations: AutomationsService,
  ) {
    super();
  }

  async process(job: Job) {
    switch (job.name) {
      case CAMPAIGN_SEND_JOB:
        return this.campaigns.send(job.data.tenantId, job.data.campaignId);
      case DOMAIN_EVENT_JOB:
        return this.automations.onEvent(job.data.name, job.data.payload);
      case AUTOMATION_STEP_JOB:
        return this.automations.runStep(job.data.runId);
      default:
        throw new Error(`Unknown marketing job: ${job.name}`);
    }
  }
}
