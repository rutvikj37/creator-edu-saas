import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { Paginated } from '../../common/interceptors/response-envelope.interceptor.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { CouponsService } from './coupons.service.js';
import { GatewayService } from './gateway.service.js';
import { OrdersService } from './orders.service.js';
import { WebhooksService } from './webhooks.service.js';
import { BillingService } from '../billing/billing.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const ORDER_STATUSES = ['PENDING', 'PAYMENT_INITIATED', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED'];

// ── DTOs ─────────────────────────────────────────────────────
class SaveGatewayDto {
  @ApiProperty({ example: 'rzp_test_1234567890abcd' }) @Transform(trim) @IsString() @Length(12, 48) keyId: string;
  @ApiPropertyOptional({ description: 'Required the first time; omit to keep the stored secret' }) @IsOptional() @Transform(trim) @IsString() @Length(8, 128) keySecret?: string;
  @ApiPropertyOptional({ description: 'Webhook secret set in the Razorpay dashboard; empty string clears it' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(128) webhookSecret?: string;
}
class GatewayStateDto {
  @ApiProperty() @IsBoolean() isActive: boolean;
}
class CouponDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @Matches(/^[A-Za-z0-9_-]{3,40}$/, { message: '3–40 letters, digits, - or _' }) code?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(200) description?: string | null;
  @ApiPropertyOptional({ enum: ['PERCENT', 'FIXED'] }) @IsOptional() @IsIn(['PERCENT', 'FIXED']) type?: 'PERCENT' | 'FIXED';
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10_000_000) value?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1_000_000) maxRedemptions?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) perUserLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) minOrderAmount?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startsAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @Length(25, 25, { each: true }) courseIds?: string[] | null;
  @ApiPropertyOptional({ description: 'Percentage coupons: most it can take off' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10_000_000) maxDiscountAmount?: number | null;
  @ApiPropertyOptional({ description: 'Offer this coupon to students on the checkout page' }) @IsOptional() @IsBoolean() showAtCheckout?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
class CreateCouponDto extends CouponDto {
  @ApiPropertyOptional({ description: 'Leave empty for a random code' }) @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value)) @Matches(/^[A-Za-z0-9_-]{3,40}$/, { message: '3–40 letters, digits, - or _' }) declare code?: string;
  @ApiProperty({ enum: ['PERCENT', 'FIXED'] }) @IsIn(['PERCENT', 'FIXED']) declare type: 'PERCENT' | 'FIXED';
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10_000_000) declare value: number;
}
class BillingDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) name: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @Matches(/^\+?[0-9]{8,15}$/, { message: 'Enter a valid phone number' }) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{2}$/) country?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) state?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @Matches(/^([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])?$/, { message: 'Invalid GSTIN format' }) gstin?: string | null;
}
class QuoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) courseId?: string;
  @ApiPropertyOptional({ description: 'Buy a membership plan instead of a course' }) @IsOptional() @IsString() @Length(25, 25) membershipPlanId?: string;
  @ApiPropertyOptional({ description: 'Buy a course bundle' }) @IsOptional() @IsString() @Length(25, 25) bundleId?: string;
  @ApiPropertyOptional({ description: 'Buy everything in the cart' }) @IsOptional() @IsBoolean() fromCart?: boolean;
  @ApiPropertyOptional({ description: 'Buy a paid webinar ticket' }) @IsOptional() @IsString() @Length(25, 25) webinarId?: string;
  @ApiPropertyOptional({ description: 'Buy a digital product' }) @IsOptional() @IsString() @Length(25, 25) digitalProductId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(40) couponCode?: string | null;
  @ApiPropertyOptional({ description: 'Buy through a shareable payment link' }) @IsOptional() @Transform(trim) @IsString() @Length(4, 16) paymentLinkCode?: string;
  @ApiPropertyOptional({ description: 'Take a post-purchase upsell (with sourceOrderId)' }) @IsOptional() @IsString() @Length(25, 25) upsellOfferId?: string;
  @ApiPropertyOptional({ description: 'The paid order the upsell follows' }) @IsOptional() @IsString() @Length(25, 25) sourceOrderId?: string;
  @ApiPropertyOptional({ description: 'Order bumps ticked at checkout', type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) @Length(25, 25, { each: true }) bumpOfferIds?: string[];
}
class CheckoutDto extends QuoteDto {
  @ApiPropertyOptional({ description: 'Affiliate referral code (?ref=)' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(32) affiliateCode?: string | null;
  @ApiPropertyOptional({ description: 'First-touch marketing attribution from the academy site tracker' }) @IsOptional() @IsObject() attribution?: Record<string, unknown> | null;
  @ApiProperty({ type: BillingDto }) @ValidateNested() @Type(() => BillingDto) billing: BillingDto;
}
class ConfirmDto {
  @ApiProperty() @IsString() @Length(1, 64) razorpay_order_id: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 64) razorpay_payment_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 128) razorpay_signature?: string;
}
class AbandonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
class RefundDto {
  @ApiPropertyOptional({ description: 'Defaults to the full refundable amount' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) reason?: string;
  @ApiPropertyOptional({ description: 'Revoke course access (full refunds only)' }) @IsOptional() @IsBoolean() revokeAccess?: boolean;
}
class ListQuery {
  @IsOptional() @IsIn(ORDER_STATUSES) status?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @Length(25, 25) courseId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use YYYY-MM-DD' }) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use YYYY-MM-DD' }) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
class PaymentsQuery {
  @IsOptional() @IsIn(['CREATED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
class RangeQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

function sendPdf(res: Response, out: { pdf: Buffer; filename: string }) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(out.pdf);
}

// ── Creator ─────────────────────────────────────────────────
@ApiTags('Creator · Payments')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/payments', version: '1' })
export class CreatorPaymentsController {
  constructor(private readonly gateways: GatewayService) {}

  @Get('razorpay') @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Razorpay account status (secrets are never returned)' })
  get() { return this.gateways.get(); }

  @Put('razorpay') @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Save Razorpay keys (encrypted) and verify them against Razorpay' })
  save(@Body() dto: SaveGatewayDto, @CurrentAuth() auth: AuthContext) { return this.gateways.save(dto, auth.userId); }

  @Post('razorpay/verify') @HttpCode(200) @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  verify(@CurrentAuth() auth: AuthContext) { return this.gateways.verify(auth.userId); }

  @Patch('razorpay') @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Enable or pause taking payments' })
  setState(@Body() dto: GatewayStateDto, @CurrentAuth() auth: AuthContext) { return this.gateways.setActive(dto.isActive, auth.userId); }

  @Delete('razorpay') @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  remove(@CurrentAuth() auth: AuthContext) { return this.gateways.remove(auth.userId); }
}

@ApiTags('Creator · Coupons')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/coupons', version: '1' })
export class CreatorCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get() @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  list(@Query('q') q?: string) { return this.coupons.list(q?.slice(0, 40)); }

  @Post() @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  create(@Body() dto: CreateCouponDto, @CurrentAuth() auth: AuthContext) { return this.coupons.create(dto, auth.userId); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  update(@Param('id') id: string, @Body() dto: CouponDto, @CurrentAuth() auth: AuthContext) { return this.coupons.update(id, dto, auth.userId); }

  @Delete(':id') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.coupons.remove(id, auth.userId); }
}

@ApiTags('Creator · Orders')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator', version: '1' })
export class CreatorOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders') @RequirePermissions(PERMISSIONS.ORDERS_READ)
  async list(@Query() q: ListQuery) {
    const { items, meta } = await this.orders.list(q);
    return new Paginated(items, meta);
  }

  @Get('orders/summary') @RequirePermissions(PERMISSIONS.ORDERS_READ)
  @ApiOperation({ summary: 'Revenue from the ledger: gross, refunds, GST, Razorpay fees, platform commission, net' })
  summary(@Query() q: RangeQuery) { return this.orders.summary(q.from ? new Date(q.from) : undefined, q.to ? new Date(q.to) : undefined); }

  @Get('orders/:id') @RequirePermissions(PERMISSIONS.ORDERS_READ)
  get(@Param('id') id: string) { return this.orders.get(id); }

  @Get('orders/:id/invoice') @RequirePermissions(PERMISSIONS.ORDERS_READ)
  async invoice(@Param('id') id: string, @Res() res: Response) { sendPdf(res, await this.orders.invoicePdf(id)); }

  @Post('orders/:id/refunds') @RequirePermissions(PERMISSIONS.REFUNDS_MANAGE)
  @ApiOperation({ summary: 'Refund through Razorpay (full or partial)' })
  refund(@Param('id') id: string, @Body() dto: RefundDto, @CurrentAuth() auth: AuthContext) { return this.orders.refund(id, dto, auth.userId); }

  @Get('transactions') @RequirePermissions(PERMISSIONS.ORDERS_READ)
  async transactions(@Query() q: PaymentsQuery) {
    const { items, meta } = await this.orders.payments(q);
    return new Paginated(items, meta);
  }
}

// ── Student ─────────────────────────────────────────────────
@ApiTags('Student · Checkout')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'learn', version: '1' })
export class LearnCommerceController {
  constructor(private readonly orders: OrdersService, private readonly coupons: CouponsService) {}

  @Get('checkout/offers')
  @ApiOperation({ summary: 'Coupons the academy offers on the checkout page for a course' })
  offers(@Query('courseId') courseId?: string) { return this.coupons.offers(courseId && courseId.length === 25 ? courseId : null); }

  @Post('checkout/quote') @HttpCode(200)
  @ApiOperation({ summary: 'Price breakdown with coupon and GST, without creating an order' })
  quote(@Body() dto: QuoteDto, @CurrentAuth() auth: AuthContext) { return this.orders.quote(auth.userId, dto, dto.couponCode); }

  @Post('checkout')
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Create an order (free orders complete immediately)' })
  checkout(@Body() dto: CheckoutDto, @CurrentAuth() auth: AuthContext, @Headers('idempotency-key') key?: string) {
    return this.orders.checkout(auth.userId, dto, key?.slice(0, 64) || undefined);
  }

  @Get('orders')
  list(@CurrentAuth() auth: AuthContext) { return this.orders.listForUser(auth.userId); }

  @Get('orders/:id')
  get(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.orders.getForUser(auth.userId, id); }

  @Post('orders/:id/pay') @HttpCode(200)
  @ApiOperation({ summary: 'Open a Razorpay order; returns the Checkout.js options' })
  pay(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.orders.pay(auth.userId, id); }

  @Post('orders/:id/confirm') @HttpCode(200)
  @ApiOperation({ summary: 'Checkout.js success callback: signature check + server-side re-read from Razorpay' })
  confirm(@Param('id') id: string, @Body() dto: ConfirmDto, @CurrentAuth() auth: AuthContext) { return this.orders.confirm(auth.userId, id, { ...dto }); }

  @Post('orders/:id/abandon') @HttpCode(200)
  abandon(@Param('id') id: string, @Body() dto: AbandonDto, @CurrentAuth() auth: AuthContext) { return this.orders.markAbandoned(auth.userId, id, dto.reason); }

  @Get('orders/:id/upsell')
  @ApiOperation({ summary: 'The one-time offer shown after this paid order (null when there is none)' })
  async upsell(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return { offer: await this.orders.upsellFor(auth.userId, id) }; }

  @Post('orders/:id/upsell/:offerId/decline') @HttpCode(200)
  @ApiOperation({ summary: 'No thanks — stop showing this offer for the order' })
  declineUpsell(@Param('id') id: string, @Param('offerId') offerId: string, @CurrentAuth() auth: AuthContext) { return this.orders.declineUpsell(auth.userId, id, offerId); }

  @Get('orders/:id/invoice')
  async invoice(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @Res() res: Response) { sendPdf(res, await this.orders.invoicePdf(id, auth.userId)); }
}

// ── Razorpay webhooks ───────────────────────────────────────
@ApiTags('Webhooks')
@Public()
@Controller({ path: 'webhooks/razorpay', version: '1' })
export class RazorpayWebhookController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly billing: BillingService,
  ) {}

  // Declared before ':accountId' so it is matched first.
  @Post('platform') @HttpCode(200)
  @ApiOperation({ summary: "Razorpay webhook for the platform's own account (plan billing)" })
  receivePlatform(@Req() req: Request & { rawBody?: Buffer }) {
    return this.billing.receiveWebhook(req.rawBody, req.headers as Record<string, string | undefined>);
  }

  @Post(':accountId') @HttpCode(200)
  @ApiOperation({ summary: 'Razorpay webhook (X-Razorpay-Signature over the raw body)' })
  receive(@Param('accountId') accountId: string, @Req() req: Request & { rawBody?: Buffer }) {
    return this.webhooks.receive(accountId, req.rawBody, req.headers as Record<string, string | undefined>);
  }
}
