import { CreatorSecurityController, LearnWatermarkController } from './security.controller.js';
import { Module } from '@nestjs/common';
import { AcademyController } from './academy.controller.js';
import { AcademyService } from './academy.service.js';
import { CreatorDashboardController } from './dashboard.controller.js';

@Module({ controllers: [AcademyController, CreatorDashboardController, CreatorSecurityController, LearnWatermarkController], providers: [AcademyService], exports: [AcademyService] })
export class AcademyModule {}
