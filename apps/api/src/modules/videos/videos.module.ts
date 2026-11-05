import { Module } from '@nestjs/common';
import { LearningModule } from '../learning/learning.module.js';
import { BunnyModule } from './providers/bunny/bunny.module.js';
import { VideoPlaybackService } from './services/video-playback.service.js';
import { VideoProcessingService } from './services/video-processing.service.js';
import { VideoUploadService } from './services/video-upload.service.js';
import { VideoUsageService } from './services/video-usage.service.js';
import { VideoWebhookService } from './services/video-webhook.service.js';
import { VideoProcessor, VideoScheduler } from './video.processor.js';
import { CreatorVideosController, LearnVideoController, PlatformVideoUsageController, VideoPlaybackController, VideosController, VideoWebhookController } from './videos.controller.js';
import { VideosRepository } from './videos.repository.js';
import { VideosService } from './videos.service.js';

const CORE = [VideosRepository, VideoProcessingService, VideoUsageService];

@Module({
  imports: [LearningModule, BunnyModule],
  controllers: [VideoWebhookController, VideosController, VideoPlaybackController, CreatorVideosController, LearnVideoController, PlatformVideoUsageController],
  providers: [...CORE, VideosService, VideoUploadService, VideoPlaybackService, VideoWebhookService],
  exports: [VideosService, VideoProcessingService, VideosRepository, BunnyModule],
})
export class VideosModule {}

/** Worker side: provider syncs, maintenance sweep, usage snapshots. */
@Module({ imports: [BunnyModule], providers: [...CORE, VideoProcessor, VideoScheduler], exports: [VideoProcessingService, VideosRepository, BunnyModule] })
export class VideosWorkerModule {}
