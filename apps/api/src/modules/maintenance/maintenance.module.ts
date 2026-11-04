import { Module } from '@nestjs/common';
import { MaintenanceProcessor } from './maintenance.processor.js';
import { MaintenanceScheduler } from './maintenance.scheduler.js';

@Module({ providers: [MaintenanceProcessor, MaintenanceScheduler] })
export class MaintenanceWorkerModule {}
