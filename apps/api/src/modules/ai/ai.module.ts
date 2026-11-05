import { Module } from '@nestjs/common';
import { CoursesModule } from '../courses/courses.module.js';
import { LearningModule } from '../learning/learning.module.js';
import { AiClient } from './ai.client.js';
import { CreatorAiController, LearnAiController } from './ai.controller.js';
import { AiService } from './ai.service.js';

@Module({ imports: [CoursesModule, LearningModule], controllers: [CreatorAiController, LearnAiController], providers: [AiClient, AiService], exports: [AiService] })
export class AiModule {}
