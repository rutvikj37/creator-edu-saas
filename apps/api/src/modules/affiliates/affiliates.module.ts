import { Global, Module } from '@nestjs/common';
import { CreatorAffiliatesController, LearnAffiliateController, PublicAffiliatesController } from './affiliates.controller.js';
import { AffiliatesService } from './affiliates.service.js';

@Global()
@Module({ controllers: [CreatorAffiliatesController, LearnAffiliateController, PublicAffiliatesController], providers: [AffiliatesService], exports: [AffiliatesService] })
export class AffiliatesModule {}

@Global()
@Module({ providers: [AffiliatesService], exports: [AffiliatesService] })
export class AffiliatesWorkerModule {}
