import { Global, Module } from '@nestjs/common';
import { ChannelsService } from './channels.js';
import { MessagingProcessor } from './messaging.processor.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/** Global so any module can notify users. */
@Global()
@Module({ controllers: [NotificationsController], providers: [ChannelsService, NotificationsService], exports: [NotificationsService, ChannelsService] })
export class NotificationsModule {}

@Global()
@Module({ providers: [ChannelsService, NotificationsService, MessagingProcessor], exports: [NotificationsService, ChannelsService] })
export class NotificationsWorkerModule {}
