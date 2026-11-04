import { Module } from '@nestjs/common';
import { MailTransport } from './mail-transport.js';
import { NotificationsProcessor } from './mail.processor.js';

@Module({ providers: [MailTransport, NotificationsProcessor] })
export class MailWorkerModule {}
