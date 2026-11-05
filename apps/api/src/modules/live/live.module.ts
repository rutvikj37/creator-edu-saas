import { Module } from '@nestjs/common';
import { LearningModule } from '../learning/learning.module.js';
import { BatchesService } from './batches.service.js';
import { LiveInteractionService } from './interaction.service.js';
import { CreatorBatchesController, CreatorLiveController, LearnLiveController, LiveKitWebhookController, PublicWebinarController } from './live.controller.js';
import { LiveJobs, LiveProcessor, LiveScheduler } from './live.processor.js';
import { LiveService } from './live.service.js';
import { LiveKitService } from './livekit.service.js';
import { WebinarsService } from './webinars.service.js';

const SERVICES = [LiveKitService, LiveService, LiveInteractionService, BatchesService, WebinarsService, LiveJobs];

@Module({
  imports: [LearningModule],
  controllers: [CreatorLiveController, CreatorBatchesController, LearnLiveController, PublicWebinarController, LiveKitWebhookController],
  providers: SERVICES,
  exports: [LiveService, LiveKitService, LiveJobs],
})
export class LiveModule {}

/** Worker side: reminders, recurring sessions, closing stale sessions. */
@Module({ providers: [LiveKitService, LiveService, LiveJobs, LiveProcessor, LiveScheduler] })
export class LiveWorkerModule {}
