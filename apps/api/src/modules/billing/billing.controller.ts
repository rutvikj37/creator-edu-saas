import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { PERMISSIONS } from '@ce/shared';
import { AllowWhenSuspended, CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { Paginated } from '../../common/interceptors/response-envelope.interceptor.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { BillingService } from './billing.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
class PlanPriceDto {
  @ApiProperty() @IsString() @Length(25, 25) planPriceId: string;
}
class ConfirmDto {
  @ApiProperty() @IsString() @Length(1, 64) razorpay_order_id: string;
  @IsOptional() @IsString() @Length(1, 64) razorpay_payment_id?: string;
  @IsOptional() @IsString() @Length(1, 128) razorpay_signature?: string;
}
class CancelDto {
  @ApiProperty({ description: 'true = cancel at period end, false = keep renewing' }) @IsBoolean() cancelAtPeriodEnd: boolean;
}
class OfflineDto {
  @ApiProperty({ description: 'Bank reference / UTR' }) @Transform(trim) @IsString() @Length(3, 191) reference: string;
}
class VoidDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 300) reason: string;
}
class InvoiceQuery {
  @IsOptional() @IsIn(['OPEN', 'PAID', 'VOID']) status?: string;
  @IsOptional() @IsString() @Length(25, 25) tenantId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
class SubscriptionQuery {
  @IsOptional() @IsIn(['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE', 'CANCELED', 'EXPIRED']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

function sendPdf(res: Response, out: { pdf: Buffer; filename: string }) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(out.pdf);
}

/** Academy side of plan billing. Allowed while suspended or expired so academies can always pay. */
@ApiTags('Creator · Billing')
@ApiBearerAuth()
@TenantScoped('workspace')
@AllowWhenSuspended()
@Controller({ path: 'creator/billing', version: '1' })
export class CreatorPlanBillingController {
  constructor(private readonly billing: BillingService, private readonly ctx: TenantContext) {}

  @Get('plans') @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  plans() { return this.billing.plans(this.ctx.requireTenantId()); }

  @Post('quote') @HttpCode(200) @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  @ApiOperation({ summary: 'Price of switching to a plan, with credit for unused paid time and GST' })
  quote(@Body() dto: PlanPriceDto) { return this.billing.quote(this.ctx.requireTenantId(), dto.planPriceId); }

  @Post('checkout') @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  @ApiOperation({ summary: 'Create a plan invoice (completes immediately when credit covers it)' })
  checkout(@Body() dto: PlanPriceDto, @CurrentAuth() auth: AuthContext) { return this.billing.checkout(this.ctx.requireTenantId(), dto.planPriceId, auth.userId); }

  @Get('invoices') @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  invoices() { return this.billing.listForTenant(this.ctx.requireTenantId()); }

  @Get('invoices/:id') @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  invoice(@Param('id') id: string) { return this.billing.getForTenant(this.ctx.requireTenantId(), id); }

  @Get('invoices/:id/pdf') @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  async pdf(@Param('id') id: string, @Res() res: Response) { sendPdf(res, await this.billing.pdf(id, this.ctx.requireTenantId())); }

  @Post('invoices/:id/pay') @HttpCode(200) @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  @ApiOperation({ summary: "Open a Razorpay order on the platform's account; returns Checkout.js options" })
  pay(@Param('id') id: string) { return this.billing.pay(this.ctx.requireTenantId(), id); }

  @Post('invoices/:id/confirm') @HttpCode(200) @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  confirm(@Param('id') id: string, @Body() dto: ConfirmDto) { return this.billing.confirm(this.ctx.requireTenantId(), id, { ...dto }); }

  @Post('cancellation') @HttpCode(200) @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  @ApiOperation({ summary: 'Cancel at period end, or undo that' })
  cancel(@Body() dto: CancelDto, @CurrentAuth() auth: AuthContext) { return this.billing.setCancelAtPeriodEnd(this.ctx.requireTenantId(), dto.cancelAtPeriodEnd, auth.userId); }
}

@ApiTags('Platform · Billing')
@ApiBearerAuth()
@RequireRealm('PLATFORM')
@Controller({ path: 'platform/billing', version: '1' })
export class PlatformBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('gateway') @RequirePermissions(PERMISSIONS.PLATFORM_FINANCE_READ)
  @ApiOperation({ summary: "Platform Razorpay account status (keys are set in Settings → payments); ?verify=true calls Razorpay" })
  gateway(@Query('verify') verify?: string) { return this.billing.gatewayStatus(verify === 'true'); }

  @Get('subscriptions') @RequirePermissions(PERMISSIONS.PLATFORM_FINANCE_READ)
  async subscriptions(@Query() q: SubscriptionQuery) {
    const { items, meta } = await this.billing.adminSubscriptions(q);
    return new Paginated(items, meta);
  }

  @Get('invoices') @RequirePermissions(PERMISSIONS.PLATFORM_FINANCE_READ)
  async invoices(@Query() q: InvoiceQuery) {
    const { items, meta } = await this.billing.adminInvoices(q);
    return new Paginated(items, meta);
  }

  @Get('invoices/:id/pdf') @RequirePermissions(PERMISSIONS.PLATFORM_FINANCE_READ)
  async pdf(@Param('id') id: string, @Res() res: Response) { sendPdf(res, await this.billing.pdf(id)); }

  @Post('invoices/:id/record-payment') @HttpCode(200) @RequirePermissions(PERMISSIONS.PLATFORM_FINANCE_MANAGE)
  @ApiOperation({ summary: 'Mark an open invoice paid by bank transfer (applies the plan/renewal)' })
  record(@Param('id') id: string, @Body() dto: OfflineDto, @CurrentAuth() auth: AuthContext) { return this.billing.recordOfflinePayment(id, dto.reference, auth.userId); }

  @Post('invoices/:id/void') @HttpCode(200) @RequirePermissions(PERMISSIONS.PLATFORM_FINANCE_MANAGE)
  void(@Param('id') id: string, @Body() dto: VoidDto, @CurrentAuth() auth: AuthContext) { return this.billing.voidInvoice(id, dto.reason, auth.userId); }
}

