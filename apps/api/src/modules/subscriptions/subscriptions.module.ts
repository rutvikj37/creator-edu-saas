import { Global, Module } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

@Global()
@Module({ providers: [EntitlementsService, SubscriptionsService], exports: [EntitlementsService, SubscriptionsService] })
export class SubscriptionsModule {}
