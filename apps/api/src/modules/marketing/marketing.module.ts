import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { AppEvents } from '../../core/events/app-events.service.js';
import { AutomationsService } from './automations.service.js';
import { CreatorAutomationsController } from './automations.controller.js';
import { CampaignsService } from './campaigns.service.js';
import { LeadsService } from './leads.service.js';
import { CreatorCampaignsController, CreatorLeadsController, PublicMarketingController } from './marketing.controller.js';
import { MarketingProcessor } from './marketing.processor.js';

/** Students become contacts (no marketing consent until they opt in). */
@Injectable()
export class MarketingListeners implements OnModuleInit {
  constructor(private readonly events: AppEvents, private readonly leads: LeadsService) {}
  onModuleInit() {
    this.events.on('student.registered', async (p) => {
      await this.leads.captureFor(p.tenantId, { email: p.email, name: p.name, source: 'signup', userId: p.userId });
    });
  }
}

const SERVICES = [LeadsService, CampaignsService, AutomationsService];

@Global()
@Module({
  controllers: [CreatorLeadsController, CreatorCampaignsController, CreatorAutomationsController, PublicMarketingController],
  providers: [...SERVICES, MarketingListeners],
  exports: SERVICES,
})
export class MarketingModule {}

@Global()
@Module({ providers: [...SERVICES, MarketingProcessor], exports: SERVICES })
export class MarketingWorkerModule {}
