import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { MaintenanceWorkerModule } from './modules/maintenance/maintenance.module.js';
import { MailWorkerModule } from './core/mail/mail-worker.module.js';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module.js';
import { CommerceWorkerModule } from './modules/commerce/commerce.module.js';
import { LiveWorkerModule } from './modules/live/live.module.js';
import { NotificationsWorkerModule } from './modules/notifications/notifications.module.js';
import { MarketingWorkerModule } from './modules/marketing/marketing.module.js';

/** Background worker process: BullMQ processors and schedulers, no HTTP server. */
@Module({ imports: [CoreModule, MaintenanceWorkerModule, MailWorkerModule, SubscriptionsModule, CommerceWorkerModule, LiveWorkerModule, NotificationsWorkerModule, MarketingWorkerModule] })
export class WorkerModule {}
