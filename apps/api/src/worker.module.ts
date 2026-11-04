import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { MaintenanceWorkerModule } from './modules/maintenance/maintenance.module.js';

/** Background worker process: BullMQ processors and schedulers, no HTTP server. */
@Module({ imports: [CoreModule, MaintenanceWorkerModule] })
export class WorkerModule {}
