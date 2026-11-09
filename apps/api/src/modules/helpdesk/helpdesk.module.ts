import { Module } from '@nestjs/common';
import { CreatorHelpdeskController, LearnSupportController } from './helpdesk.controller.js';
import { HelpdeskService } from './helpdesk.service.js';

@Module({ controllers: [LearnSupportController, CreatorHelpdeskController], providers: [HelpdeskService] })
export class HelpdeskModule {}
