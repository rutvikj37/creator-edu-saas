import { Module } from '@nestjs/common';
import { CommerceProcessor, CommerceScheduler, WebhooksProcessor } from './commerce.processor.js';
import { CreatorCouponsController, CreatorOrdersController, CreatorPaymentsController, LearnCommerceController, RazorpayWebhookController } from './commerce.controller.js';
import { CouponsService } from './coupons.service.js';
import { GatewayService } from './gateway.service.js';
import { OrdersService } from './orders.service.js';
import { PaymentHttp } from './providers/http.js';
import { PROVIDER_CLASSES } from './providers/registry.js';
import { WebhooksService } from './webhooks.service.js';

const SERVICES = [PaymentHttp, ...PROVIDER_CLASSES, GatewayService, CouponsService, OrdersService, WebhooksService];

/** Razorpay commerce: HTTP API. */
@Module({
  controllers: [CreatorPaymentsController, CreatorCouponsController, CreatorOrdersController, LearnCommerceController, RazorpayWebhookController],
  providers: SERVICES,
  exports: [OrdersService, GatewayService],
})
export class CommerceModule {}

/** Razorpay commerce: worker side (webhook processing, reconciliation). */
@Module({ providers: [...SERVICES, WebhooksProcessor, CommerceProcessor, CommerceScheduler] })
export class CommerceWorkerModule {}
