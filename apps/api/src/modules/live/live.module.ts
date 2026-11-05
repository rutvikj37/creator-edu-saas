import { Module } from '@nestjs/common';
import { LearningModule } from '../learning/learning.module.js';
import { BatchesService } from './batches.service.js';
import { LiveInteractionService } from './interaction.service.js';
import { CreatorBatchesController, CreatorLiveController, LearnLiveController, LiveKitWebhookController, PlugNmeetWebhookController, PublicWebinarController } from './live.controller.js';
import { LiveJobs, LiveProcessor, LiveScheduler, PlugNmeetJobs } from './live.processor.js';
import { LiveRecordingsService } from './live-recordings.service.js';
import { PlugNmeetService } from './plugnmeet.service.js';
import { BunnyModule } from '../videos/providers/bunny/bunny.module.js';
import { VideosWorkerModule } from '../videos/videos.module.js';
import { LiveService } from './live.service.js';
import { LiveKitService } from './livekit.service.js';
import { WebinarsService } from './webinars.service.js';

const SERVICES = [LiveKitService, PlugNmeetService, LiveService, LiveInteractionService, BatchesService, WebinarsService, LiveJobs];

@Module({
  imports: [LearningModule, BunnyModule],
  controllers: [CreatorLiveController, CreatorBatchesController, LearnLiveController, PublicWebinarController, LiveKitWebhookController, PlugNmeetWebhookController],
  providers: SERVICES,
  exports: [LiveService, LiveKitService, PlugNmeetService, LiveJobs],
})
export class LiveModule {}

/** Worker side: reminders, recurring sessions, closing stale sessions, plugNmeet sync and recording imports. */
@Module({ imports: [VideosWorkerModule], providers: [LiveKitService, PlugNmeetService, LiveService, LiveJobs, PlugNmeetJobs, LiveRecordingsService, LiveProcessor, LiveScheduler] })
export class LiveWorkerModule {}
