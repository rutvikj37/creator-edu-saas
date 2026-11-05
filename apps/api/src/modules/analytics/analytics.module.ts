import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

@Module({ imports: [CommerceModule], controllers: [AnalyticsController], providers: [AnalyticsService] })
export class AnalyticsModule {}
