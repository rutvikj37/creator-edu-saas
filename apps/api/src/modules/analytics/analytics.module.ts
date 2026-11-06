import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module.js';
import { AnalyticsController, TrackController } from './analytics.controller.js';
import { ConversionService } from './conversion.service.js';
import { AnalyticsService } from './analytics.service.js';

@Module({ imports: [CommerceModule], controllers: [AnalyticsController, TrackController], providers: [AnalyticsService, ConversionService] })
export class AnalyticsModule {}
