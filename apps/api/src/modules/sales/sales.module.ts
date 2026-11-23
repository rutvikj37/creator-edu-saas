import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module.js';
import { CreatorSalesController, PublicPaymentLinksController } from './sales.controller.js';
import { SalesService } from './sales.service.js';

/** Sales funnels: order bumps, upsells, payment links, cart recovery settings and ad-tracking IDs. */
@Module({
  imports: [CommerceModule],
  controllers: [CreatorSalesController, PublicPaymentLinksController],
  providers: [SalesService],
})
export class SalesModule {}
