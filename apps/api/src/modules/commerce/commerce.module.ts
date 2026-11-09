import { Module } from '@nestjs/common';
import { BillingProcessor, CommerceProcessor, CommerceScheduler, WebhooksProcessor } from './commerce.processor.js';
import { BillingService } from '../billing/billing.service.js';
import { CreatorPlanBillingController, PlatformBillingController } from '../billing/billing.controller.js';
import { CreatorCouponsController, CreatorOrdersController, CreatorPaymentsController, LearnCommerceController, RazorpayWebhookController } from './commerce.controller.js';
import { CouponsService } from './coupons.service.js';
import { DigitalProductsService } from './digital-products.service.js';
import { CreatorProductsController, LearnProductsController, PublicProductsController } from './digital-products.controller.js';
import { BundlesService } from './bundles.service.js';
import { CartService } from './cart.service.js';
import { CreatorBundlesController, LearnCartController, PublicBundlesController } from './bundles.controller.js';
import { GatewayService } from './gateway.service.js';
import { OrdersService } from './orders.service.js';
import { FunnelService } from './funnel.service.js';
import { RecoveryService } from './recovery.service.js';
import { PaymentHttp } from './providers/http.js';
import { PROVIDER_CLASSES } from './providers/registry.js';
import { WebhooksService } from './webhooks.service.js';
import { FilesService } from '../files/files.service.js';

const SERVICES = [PaymentHttp, ...PROVIDER_CLASSES, GatewayService, CouponsService, DigitalProductsService, FunnelService, OrdersService, WebhooksService, BillingService, RecoveryService];

/** Razorpay commerce (academy sales) and SaaS plan billing: HTTP API. */
@Module({
  controllers: [CreatorProductsController, PublicProductsController, LearnProductsController, CreatorBundlesController, PublicBundlesController, LearnCartController, CreatorPaymentsController, CreatorCouponsController, CreatorOrdersController, LearnCommerceController, RazorpayWebhookController, CreatorPlanBillingController, PlatformBillingController],
  providers: [...SERVICES, BundlesService, CartService],
  exports: [OrdersService, GatewayService, FunnelService, RecoveryService],
})
export class CommerceModule {}

/** Razorpay commerce: worker side (webhook processing, reconciliation).
 *  The worker doesn't load the HTTP-only FilesModule, so DigitalProductsService's FilesService is provided here. */
@Module({ providers: [...SERVICES, FilesService, WebhooksProcessor, CommerceProcessor, BillingProcessor, CommerceScheduler] })
export class CommerceWorkerModule {}
