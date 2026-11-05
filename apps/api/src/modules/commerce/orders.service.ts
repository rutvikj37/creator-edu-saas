import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ERROR_CODES, FEATURES } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { emailTemplates } from '../../core/mail/templates.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../core/redis/redis.constants.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AppEvents } from '../../core/events/app-events.service.js';
import { AffiliatesService } from '../affiliates/affiliates.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { enrollmentExpiry, isEnrollmentUsable } from '../learning/access.js';
import { CouponsService } from './coupons.service.js';
import { GatewayService } from './gateway.service.js';
import { renderInvoicePdf } from './invoice-pdf.js';
import { commissionMinor, computeQuote, proportional, type Quote } from './pricing.js';
import { fromMinor, toMinor } from './providers/money.js';
import { PaymentProviders } from './providers/registry.js';
import { type NormalizedPayment, ProviderError } from './providers/types.js';

/** Unpaid orders stop accepting new payment attempts after this. Late captures are still honoured. */
const ORDER_TTL_MS = 2 * 3600_000;
/** Orders in these states become PAID when a matching capture is confirmed (money was taken). */
const PAYABLE = ['PENDING', 'PAYMENT_INITIATED', 'FAILED', 'EXPIRED', 'CANCELLED'] as const;

export interface BillingInput {
  name: string;
  email?: string;
  phone?: string | null;
  country?: string | null;
  state?: string | null;
  gstin?: string | null;
}

export interface CheckoutInput {
  /** Exactly one of courseId / membershipPlanId. */
  courseId?: string;
  membershipPlanId?: string;
  couponCode?: string | null;
  /** Referral code from an affiliate link (?ref=). Invalid or self-referral codes are ignored. */
  affiliateCode?: string | null;
  billing: BillingInput;
}

type Tx = Parameters<Parameters<TenantPrismaClient['$transaction']>[0]>[0];

export function fmtMoney(minor: number, currency: string) {
  return `${currency} ${Number(fromMinor(minor, currency)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Indian financial year label used in invoice series, e.g. 2026-27 for dates from 1 April 2026. */
export function financialYear(d: Date) {
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export async function nextSequence(tx: { $executeRaw: any; $queryRaw: any }, tenantId: string, name: string): Promise<number> {
  await tx.$executeRaw`INSERT INTO TenantSequence (tenantId, name, value) VALUES (${tenantId}, ${name}, 1) ON DUPLICATE KEY UPDATE value = value + 1`;
  const rows: { value: number }[] = await tx.$queryRaw`SELECT value FROM TenantSequence WHERE tenantId = ${tenantId} AND name = ${name}`;
  return Number(rows[0].value);
}

/**
 * Orders, Razorpay payments, fulfilment, refunds and reconciliation.
 * Payment state is only ever taken from Razorpay's API (never from the browser), and an order
 * becomes PAID, grants access, redeems its coupon, books the ledger and issues its invoice in
 * a single transaction guarded by a conditional status update, so duplicate or out-of-order
 * confirmations (browser callback, webhook, reconciliation) fulfil exactly once.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly gateways: GatewayService,
    private readonly coupons: CouponsService,
    private readonly providers: PaymentProviders,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly notifications: NotificationsService,
    private readonly events: AppEvents,
    private readonly affiliates: AffiliatesService,
    private readonly memberships: MembershipsService,
  ) {}

  // ── views ─────────────────────────────────────────────────
  view(o: any) {
    const m = (v: any) => (v === null || v === undefined ? null : v.toString());
    return {
      id: o.id, number: o.number, status: o.status, currency: o.currency,
      subtotalAmount: m(o.subtotalAmount), discountAmount: m(o.discountAmount), taxAmount: m(o.taxAmount), totalAmount: m(o.totalAmount), refundedAmount: m(o.refundedAmount),
      taxRate: m(o.taxRate), taxInclusive: o.taxInclusive, couponCode: o.couponCode, provider: o.provider, billing: o.billing,
      paidAt: o.paidAt, failureReason: o.failureReason, expiresAt: o.expiresAt, createdAt: o.createdAt, userId: o.userId,
      items: o.items?.map((i: any) => ({ id: i.id, courseId: i.courseId, title: i.title, unitAmount: m(i.unitAmount), discountAmount: m(i.discountAmount), totalAmount: m(i.totalAmount) })),
      payments: o.payments?.map((p: any) => ({
        id: p.id, provider: p.provider, providerOrderId: p.providerOrderId, providerPaymentId: p.providerPaymentId, status: p.status,
        amount: m(p.amount), currency: p.currency, method: p.method, feeAmount: m(p.feeAmount), failureReason: p.failureReason, capturedAt: p.capturedAt, createdAt: p.createdAt,
      })),
      refunds: o.refunds?.map((r: any) => ({ id: r.id, amount: m(r.amount), reason: r.reason, status: r.status, revokeAccess: r.revokeAccess, providerRefundId: r.providerRefundId, failureReason: r.failureReason, processedAt: r.processedAt, createdAt: r.createdAt })),
    };
  }

  private async academy(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { business: true, domains: { where: { status: 'VERIFIED', isPrimary: true }, take: 1 } } });
    const web = new URL(this.config.get('WEB_PUBLIC_URL'));
    const root = this.config.get('PLATFORM_ROOT_DOMAIN');
    const primary = t.domains[0]?.hostname ?? `${t.slug}.${root}`;
    const origin = primary.endsWith(`.${root}`) ? `${web.protocol}//${primary}${web.port ? `:${web.port}` : ''}` : `https://${primary}`;
    return { tenant: t, origin, business: t.business };
  }

  private async taxRule(tenantId: string) {
    const b = await this.prisma.tenantBusinessProfile.findUnique({ where: { tenantId } });
    return b?.gstRegistered ? { rate: Number(b.taxRate), inclusive: b.pricesIncludeTax } : null;
  }

  // ── checkout ──────────────────────────────────────────────
  private async sellableCourse(courseId: string) {
    const c = await this.db.course.findFirst({ where: { id: courseId, deletedAt: null, status: 'PUBLISHED' } });
    if (!c || c.visibility === 'PRIVATE') throw AppException.notFound('Course not found');
    if (c.isFree) throw AppException.conflict('This course is free — enrol directly.');
    if (c.priceAmount === null || Number(c.priceAmount) <= 0) throw AppException.conflict('This course is not for sale yet.');
    return c;
  }

  /** What is being bought: a course or a membership plan. */
  private async product(ref: { courseId?: string; membershipPlanId?: string }) {
    if (ref.membershipPlanId) {
      const p = await this.memberships.sellable(ref.membershipPlanId);
      return { kind: 'membership' as const, id: p.id, title: `${p.name} membership (${p.interval === 'YEAR' ? 'yearly' : 'monthly'})`, slug: null as string | null, unitMinor: toMinor(p.priceAmount, p.currency), currency: p.currency };
    }
    if (!ref.courseId) throw AppException.validation([{ field: 'courseId', message: 'Choose what to buy' }]);
    const c = await this.sellableCourse(ref.courseId);
    return { kind: 'course' as const, id: c.id, title: c.title, slug: c.slug as string | null, unitMinor: toMinor(c.priceAmount!, c.currency), currency: c.currency };
  }

  async quote(userId: string, courseId: string | undefined, couponCode?: string | null, membershipPlanId?: string) {
    const prod = await this.product({ courseId, membershipPlanId });
    const course = { id: prod.id, title: prod.title, slug: prod.slug, currency: prod.currency };
    const tenantId = this.ctx.requireTenantId();
    const unit = prod.unitMinor;
    const coupon = couponCode ? await this.coupons.evaluate(couponCode, prod.id, userId, unit, prod.currency) : null;
    const tax = await this.taxRule(tenantId);
    const q = computeQuote(unit, coupon?.rule ?? null, tax);
    const selling = (await this.entitlements.get(tenantId)).active ? await this.gateways.sellingAccount() : null;
    return {
      kind: prod.kind, course: { id: course.id, title: course.title, slug: course.slug }, currency: course.currency, couponCode: coupon?.code ?? null,
      subtotal: fromMinor(q.subtotal, course.currency), discount: fromMinor(q.discount, course.currency), tax: fromMinor(q.tax, course.currency), total: fromMinor(q.total, course.currency),
      taxRate: tax?.rate ?? null, taxInclusive: tax?.inclusive ?? true, paymentsEnabled: Boolean(selling) || (q.total === 0 && (await this.entitlements.get(tenantId)).active),
    };
  }

  async checkout(userId: string, input: CheckoutInput, idempotencyKey?: string) {
    const tenantId = this.ctx.requireTenantId();
    if (idempotencyKey) {
      const prior = await this.db.order.findFirst({ where: { userId, idempotencyKey }, include: { items: true } });
      if (prior) {
        if ((prior.items[0]?.courseId ?? prior.items[0]?.membershipPlanId) !== (input.courseId ?? input.membershipPlanId)) throw new AppException(ERROR_CODES.CONFLICT, 'Idempotency-Key was already used for a different order', HttpStatus.CONFLICT);
        return this.view(prior);
      }
    }
    const prod = await this.product(input);
    const course = { id: prod.id, title: prod.title, currency: prod.currency };
    if (prod.kind === 'course') {
      const enrollment = await this.db.enrollment.findFirst({ where: { userId, courseId: prod.id } });
      if (isEnrollmentUsable(enrollment)) throw AppException.conflict('You already have access to this course.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const unit = prod.unitMinor;
    const coupon = input.couponCode ? await this.coupons.evaluate(input.couponCode, prod.id, userId, unit, prod.currency) : null;
    const tax = await this.taxRule(tenantId);
    const q = computeQuote(unit, coupon?.rule ?? null, tax);
    if (!(await this.entitlements.get(tenantId)).active) throw AppException.conflict('This academy is not accepting new purchases right now.');
    if (q.total > 0 && !(await this.gateways.sellingAccount())) throw AppException.integrationNotConfigured('Online payments for this academy');
    if (q.total > 0 && q.total < 100 && course.currency === 'INR') throw AppException.validation([{ field: 'couponCode', message: 'The amount to pay must be at least ₹1' }]);

    const billing = {
      name: input.billing.name.trim(), email: (input.billing.email ?? user.email).trim().toLowerCase(), phone: input.billing.phone?.trim() || user.phone || null,
      country: input.billing.country ?? user.country ?? null, state: input.billing.state?.trim() || null, gstin: input.billing.gstin?.trim().toUpperCase() || null,
    };
    const cur = course.currency;
    const affiliateId = await this.affiliates.attribute(input.affiliateCode, userId);
    const order = await this.db.$transaction(async (tx) => {
      // A new checkout supersedes this buyer's earlier unpaid orders for the same course.
      const open = await tx.order.findMany({ where: { userId, status: { in: ['PENDING', 'PAYMENT_INITIATED'] }, items: { some: prod.kind === 'course' ? { courseId: prod.id } : { membershipPlanId: prod.id } } }, select: { id: true } });
      if (open.length) await tx.order.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { status: 'CANCELLED', failureReason: 'Superseded by a newer checkout' } });
      const n = await nextSequence(tx, tenantId, 'order');
      const o = await tx.order.create({
        data: {
          number: `ORD-${String(n).padStart(6, '0')}`, userId, currency: cur,
          subtotalAmount: fromMinor(q.subtotal, cur), discountAmount: fromMinor(q.discount, cur), taxAmount: fromMinor(q.tax, cur), totalAmount: fromMinor(q.total, cur),
          taxRate: tax?.rate ?? null, taxInclusive: tax?.inclusive ?? true, couponId: coupon?.id ?? null, couponCode: coupon?.code ?? null,
          billing, idempotencyKey: idempotencyKey ?? null, expiresAt: new Date(Date.now() + ORDER_TTL_MS), affiliateId,
        } as never,
      });
      await tx.orderItem.create({ data: { orderId: o.id, ...(prod.kind === 'course' ? { courseId: prod.id } : { membershipPlanId: prod.id }), title: course.title, unitAmount: fromMinor(q.subtotal, cur), discountAmount: fromMinor(q.discount, cur), totalAmount: fromMinor(q.total, cur) } as never });
      return o;
    });
    await this.audit.record({ action: 'order.create', tenantId, actorUserId: userId, actorRealm: 'TENANT', targetType: 'Order', targetId: order.id, after: { number: order.number, total: order.totalAmount.toString(), coupon: coupon?.code ?? null } });

    if (q.total === 0) await this.fulfil(order.id, null, q);
    return this.getForUser(userId, order.id);
  }

  async getForUser(userId: string, id: string) {
    const o = await this.db.order.findFirst({ where: { id, userId }, include: { items: true, payments: { orderBy: { createdAt: 'desc' } }, refunds: { orderBy: { createdAt: 'desc' } } } });
    if (!o) throw AppException.notFound('Order not found');
    const [invoice, slugs] = await Promise.all([
      this.db.invoice.findFirst({ where: { orderId: o.id }, select: { number: true } }),
      this.courseSlugs(o.items.map((i) => i.courseId).filter((x): x is string => Boolean(x))),
    ]);
    const v = this.view(o);
    return { ...v, items: v.items!.map((i: { courseId: string | null }) => ({ ...i, courseSlug: i.courseId ? slugs.get(i.courseId) ?? null : null })), invoiceNumber: invoice?.number ?? null };
  }

  private async courseSlugs(ids: string[]) {
    const rows = await this.db.course.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true } });
    return new Map(rows.map((r) => [r.id, r.slug]));
  }

  async listForUser(userId: string) {
    const rows = await this.db.order.findMany({ where: { userId, status: { notIn: ['CANCELLED'] } }, include: { items: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((o) => this.view(o));
  }

  /** Opens a Razorpay order for an unpaid order and returns what Checkout.js needs. */
  async pay(userId: string, id: string) {
    const o = await this.db.order.findFirst({ where: { id, userId }, include: { items: true } });
    if (!o) throw AppException.notFound('Order not found');
    if (o.status === 'PAID' || o.status === 'REFUNDED' || o.status === 'PARTIALLY_REFUNDED') throw AppException.conflict('This order is already paid.');
    if (!['PENDING', 'PAYMENT_INITIATED', 'FAILED'].includes(o.status) || o.expiresAt <= new Date()) throw AppException.conflict('This order has expired. Start checkout again.');
    if (!(await this.entitlements.get(o.tenantId)).active) throw AppException.conflict('This academy is not accepting new purchases right now.');
    const selling = await this.gateways.sellingAccount();
    if (!selling) throw AppException.integrationNotConfigured('Online payments for this academy');
    const { tenant } = await this.academy(o.tenantId);
    const billing = o.billing as Record<string, string | null>;
    const amountMinor = toMinor(o.totalAmount, o.currency);
    let created;
    try {
      created = await this.providers.get('RAZORPAY').createPayment(selling.creds, {
        orderId: o.id, orderNumber: o.number, amountMinor, currency: o.currency, merchantName: tenant.name,
        description: o.items.map((i) => i.title).join(', ').slice(0, 250),
        customer: { id: userId, name: billing.name ?? '', email: billing.email ?? '', phone: billing.phone },
      });
    } catch (e) {
      throw this.providerFailure(e);
    }
    await this.db.$transaction([
      this.db.payment.create({ data: { orderId: o.id, provider: 'RAZORPAY', gatewayAccountId: selling.account.id, providerOrderId: created.providerOrderId, amount: o.totalAmount, currency: o.currency } as never }),
      this.db.order.update({ where: { id: o.id }, data: { status: 'PAYMENT_INITIATED', provider: 'RAZORPAY', gatewayAccountId: selling.account.id, failureReason: null } }),
    ]);
    return { orderId: o.id, checkout: created.clientPayload };
  }

  /** Browser callback after Checkout.js. Verifies the signature and re-reads the payment from Razorpay. */
  async confirm(userId: string, id: string, data: Record<string, unknown>) {
    const o = await this.db.order.findFirst({ where: { id, userId } });
    if (!o) throw AppException.notFound('Order not found');
    const providerOrderId = String(data.razorpay_order_id ?? '');
    const payment = await this.db.payment.findFirst({ where: { orderId: o.id, providerOrderId } });
    if (!payment) throw AppException.validation([{ field: 'razorpay_order_id', message: 'Unknown payment for this order' }]);
    const account = await this.gateways.credentialsById(payment.gatewayAccountId);
    if (!account) throw AppException.integrationNotConfigured('Razorpay');
    let result: NormalizedPayment;
    try {
      result = await this.providers.get('RAZORPAY').confirm(account.creds, { providerOrderId, currency: payment.currency }, data);
    } catch (e) {
      throw this.providerFailure(e);
    }
    await this.applyPaymentResult(payment.id, result);
    return this.getForUser(userId, id);
  }

  /** Buyer closed or failed Checkout.js. Informational only: Razorpay remains the source of truth. */
  async markAbandoned(userId: string, id: string, reason?: string) {
    const o = await this.db.order.findFirst({ where: { id, userId } });
    if (!o) throw AppException.notFound('Order not found');
    if (o.status === 'PAYMENT_INITIATED') await this.db.order.update({ where: { id: o.id }, data: { failureReason: (reason || 'Payment was not completed').slice(0, 500) } });
    return this.getForUser(userId, id);
  }

  private providerFailure(e: unknown) {
    if (e instanceof ProviderError) {
      this.logger.warn({ provider: e.provider, status: e.httpStatus }, e.message);
      // No HTTP status = rejected locally (bad signature, wrong order): the request is at fault, not Razorpay.
      if (!e.httpStatus) return AppException.validation([{ field: 'payment', message: e.message }], e.message);
      return new AppException(ERROR_CODES.PAYMENT_PROVIDER_ERROR, `Razorpay: ${e.message}`, HttpStatus.BAD_GATEWAY);
    }
    return e;
  }

  // ── fulfilment ────────────────────────────────────────────
  /** Applies a provider-verified payment state. Safe to call repeatedly and in any order. */
  async applyPaymentResult(paymentId: string, r: NormalizedPayment) {
    const payment = await this.db.payment.findFirst({ where: { id: paymentId }, include: { order: true } });
    if (!payment) return 'missing';
    if (payment.status === 'CAPTURED' || payment.status === 'REFUNDED' || payment.status === 'PARTIALLY_REFUNDED') return 'already-captured';
    const order = payment.order;
    if (r.status === 'CAPTURED') {
      const expected = toMinor(order.totalAmount, order.currency);
      if (r.amountMinor !== expected || r.currency !== order.currency) {
        const reason = `Amount mismatch: expected ${fmtMoney(expected, order.currency)}, provider reported ${fmtMoney(r.amountMinor, r.currency)}`;
        await this.db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: reason, providerPaymentId: r.providerPaymentId ?? null, raw: r.raw as never } });
        await this.audit.record({ action: 'payment.amount_mismatch', tenantId: order.tenantId, actorRealm: 'SYSTEM', targetType: 'Payment', targetId: payment.id, after: { expected, reported: r.amountMinor, currency: r.currency } });
        this.logger.error({ paymentId: payment.id }, reason);
        return 'mismatch';
      }
      const tax = toMinor(order.taxAmount, order.currency);
      const q: Quote = { subtotal: toMinor(order.subtotalAmount, order.currency), discount: toMinor(order.discountAmount, order.currency), tax, total: expected, net: expected - tax };
      return (await this.fulfil(order.id, { paymentId: payment.id, result: r }, q)) ? 'fulfilled' : 'already-paid';
    }
    if (r.status === 'FAILED') {
      await this.db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', providerPaymentId: r.providerPaymentId ?? null, failureReason: r.failureReason ?? 'Payment failed', method: r.method ?? null, raw: r.raw as never } });
      await this.db.order.updateMany({ where: { id: order.id, status: { in: ['PENDING', 'PAYMENT_INITIATED'] } }, data: { status: 'FAILED', failureReason: r.failureReason ?? 'Payment failed' } });
      return 'failed';
    }
    return 'pending';
  }

  private async grantInTx(tx: Tx, userId: string, courseId: string) {
    const course = await tx.course.findFirst({ where: { id: courseId } });
    if (!course) return;
    const start = new Date();
    const expiresAt = enrollmentExpiry(course, start);
    const existing = await tx.enrollment.findFirst({ where: { userId, courseId } });
    if (existing) {
      if (isEnrollmentUsable(existing)) return;
      await tx.enrollment.update({ where: { id: existing.id }, data: { status: 'ACTIVE', startedAt: start, expiresAt, source: 'PURCHASE', grantedById: null } });
      return;
    }
    await tx.enrollment.create({ data: { userId, courseId, source: 'PURCHASE', expiresAt } as never });
  }

  /** Returns false when another path already fulfilled the order. */
  private async fulfil(orderId: string, paid: { paymentId: string; result: NormalizedPayment } | null, q: Quote): Promise<boolean> {
    const tenantId = this.ctx.requireTenantId();
    const ent = await this.entitlements.get(tenantId);
    const commissionPct = ent.features[FEATURES.COMMISSION_PERCENT.key]?.limit ?? 0;
    const { tenant, origin, business } = await this.academy(tenantId);
    const now = new Date();

    const done = await this.db.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({ where: { id: orderId, status: { in: [...PAYABLE] } }, data: { status: 'PAID', paidAt: now, failureReason: null } });
      if (!claimed.count) return null;
      const order = await tx.order.findFirstOrThrow({ where: { id: orderId }, include: { items: true } });
      const cur = order.currency;
      const fee = paid?.result.feeMinor ?? null;
      if (paid) {
        await tx.payment.update({
          where: { id: paid.paymentId },
          data: { status: 'CAPTURED', providerPaymentId: paid.result.providerPaymentId ?? null, method: paid.result.method ?? null, feeAmount: fee === null ? null : fromMinor(fee, cur), capturedAt: now, failureReason: null, raw: paid.result.raw as never },
        });
      }
      for (const item of order.items) {
        if (item.courseId) await this.grantInTx(tx, order.userId, item.courseId);
        if (item.membershipPlanId) await this.memberships.applyPurchase(tx, order.userId, item.membershipPlanId, order.id, now);
      }
      if (order.couponId) {
        await tx.couponRedemption.create({ data: { couponId: order.couponId, orderId: order.id, userId: order.userId, amount: order.discountAmount } as never });
        await tx.coupon.update({ where: { id: order.couponId }, data: { redemptionCount: { increment: 1 } } });
      }
      if (q.total > 0) {
        const commission = commissionMinor(q.net, commissionPct);
        const entries: { type: string; amount: number; description: string }[] = [{ type: 'SALE', amount: q.total, description: `Order ${order.number}` }];
        if (q.tax) entries.push({ type: 'TAX', amount: -q.tax, description: `GST ${order.taxRate?.toString() ?? ''}%` });
        if (fee) entries.push({ type: 'GATEWAY_FEE', amount: -fee, description: 'Razorpay fee (incl. GST)' });
        if (commission) entries.push({ type: 'PLATFORM_COMMISSION', amount: -commission, description: `Platform commission ${commissionPct}%` });
        const conversion = await this.affiliates.recordConversion(tx, { ...order, paidAt: now });
        if (conversion) entries.push({ type: 'AFFILIATE_COMMISSION', amount: -toMinor(conversion.commission, cur), description: `Affiliate commission ${Number(conversion.percent)}%` });
        for (const e of entries) await tx.ledgerEntry.create({ data: { orderId: order.id, type: e.type, amount: e.amount < 0 ? `-${fromMinor(-e.amount, cur)}` : fromMinor(e.amount, cur), currency: cur, description: e.description } as never });
      }
      const fy = financialYear(now);
      const seq = await nextSequence(tx, tenantId, `invoice:${fy}`);
      const prefix = business?.invoicePrefix || 'INV';
      const billing = order.billing as Record<string, string | null>;
      const invoice = await tx.invoice.create({
        data: {
          orderId: order.id, number: `${prefix}/${fy}/${String(seq).padStart(5, '0')}`, issuedAt: now,
          seller: {
            name: business?.legalName || tenant.name, address: [business?.addressLine1, business?.addressLine2, business?.city, business?.state, business?.postalCode, business?.country].filter(Boolean).join(', '),
            gstin: business?.gstRegistered ? business?.gstin ?? null : null, pan: business?.pan ?? null, state: business?.state ?? null,
          },
          buyer: billing,
          lines: order.items.map((i) => ({ description: i.title, quantity: 1, unitAmount: i.unitAmount.toString(), discountAmount: i.discountAmount.toString(), totalAmount: i.totalAmount.toString() })),
          totals: { currency: cur, subtotal: order.subtotalAmount.toString(), discount: order.discountAmount.toString(), tax: order.taxAmount.toString(), taxRate: order.taxRate?.toString() ?? null, taxInclusive: order.taxInclusive, total: order.totalAmount.toString(), paidVia: paid ? `Razorpay ${paid.result.method ?? ''}`.trim() : 'Free (100% discount)', paymentId: paid?.result.providerPaymentId ?? null },
        } as never,
      });
      return { order, invoice };
    }, { timeout: 20_000 });

    if (!done) return false;
    const { order } = done;
    const billing = order.billing as Record<string, string | null>;
    await this.audit.record({ action: 'order.paid', tenantId, actorRealm: 'SYSTEM', targetType: 'Order', targetId: order.id, after: { number: order.number, total: order.totalAmount.toString(), paymentId: paid?.result.providerPaymentId ?? null } });
    await this.events.emit('order.paid', { tenantId, userId: order.userId, orderId: order.id, courseIds: order.items.map((i) => i.courseId).filter((x): x is string => Boolean(x)), total: order.totalAmount.toString(), currency: order.currency });
    await this.notifications.notify({ userId: order.userId, tenantId, category: 'orders', title: 'Purchase confirmed', body: `You now have access to ${order.items.map((i) => i.title).join(', ')}.`, link: '/learn', brand: tenant.name, skipEmail: true }).catch(() => undefined);
    if (billing.email) {
      await this.mail.send({
        to: billing.email, tenantId, tag: 'purchase-receipt',
        ...emailTemplates.purchaseReceipt({ brand: tenant.name, name: billing.name ?? '', orderNumber: order.number, items: order.items.map((i) => i.title), total: fmtMoney(q.total, order.currency), url: `${origin}/learn` }),
      });
    }
    return true;
  }

  /** Invoice PDF. Buyers see only their own orders (userId given); staff see any order of the academy. */
  async invoicePdf(orderId: string, userId?: string) {
    const o = await this.db.order.findFirst({ where: { id: orderId, ...(userId ? { userId } : {}) } });
    if (!o) throw AppException.notFound('Order not found');
    const inv = await this.db.invoice.findFirst({ where: { orderId: o.id } });
    if (!inv) throw AppException.notFound('An invoice is issued once the order is paid');
    const pdf = await renderInvoicePdf({
      number: inv.number, issuedAt: inv.issuedAt, orderNumber: o.number, seller: inv.seller as never, buyer: inv.buyer as never,
      lines: inv.lines as never, totals: inv.totals as never, refunded: o.refundedAmount.toString(),
    });
    return { pdf, filename: `${inv.number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf` };
  }

  // ── creator views ─────────────────────────────────────────
  async list(params: { status?: string; q?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const where: Record<string, unknown> = { status: params.status ? params.status : { notIn: ['CANCELLED'] } };
    if (params.q) {
      const q = params.q.trim();
      const users = await this.prisma.user.findMany({ where: { tenantId: this.ctx.requireTenantId(), OR: [{ email: { contains: q } }, { fullName: { contains: q } }] }, select: { id: true }, take: 200 });
      where.OR = [{ number: { contains: q.toUpperCase() } }, { userId: { in: users.map((u) => u.id) } }];
    }
    const [rows, total] = await Promise.all([
      this.db.order.findMany({ where, include: { items: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.db.order.count({ where }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, fullName: true, email: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return { items: rows.map((o) => ({ ...this.view(o), buyer: byId.get(o.userId) ?? null })), meta: { page, pageSize, total } };
  }

  async get(id: string) {
    const o = await this.db.order.findFirst({ where: { id }, include: { items: true, payments: { orderBy: { createdAt: 'desc' } }, refunds: { orderBy: { createdAt: 'desc' } } } });
    if (!o) throw AppException.notFound('Order not found');
    const [buyer, invoice, ledger] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: o.userId }, select: { id: true, fullName: true, email: true, phone: true } }),
      this.db.invoice.findFirst({ where: { orderId: o.id }, select: { number: true } }),
      this.db.ledgerEntry.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { ...this.view(o), buyer, invoiceNumber: invoice?.number ?? null, ledger: ledger.map((l) => ({ type: l.type, amount: l.amount.toString(), description: l.description, createdAt: l.createdAt })) };
  }

  async payments(params: { status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const where = params.status ? { status: params.status as never } : {};
    const [rows, total] = await Promise.all([
      this.db.payment.findMany({ where, include: { order: { select: { number: true, userId: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.db.payment.count({ where }),
    ]);
    return {
      items: rows.map((p) => ({
        id: p.id, orderId: p.orderId, orderNumber: p.order.number, provider: p.provider, providerOrderId: p.providerOrderId, providerPaymentId: p.providerPaymentId,
        status: p.status, amount: p.amount.toString(), currency: p.currency, method: p.method, feeAmount: p.feeAmount?.toString() ?? null, failureReason: p.failureReason, capturedAt: p.capturedAt, createdAt: p.createdAt,
      })),
      meta: { page, pageSize, total },
    };
  }

  /** Revenue summary from the ledger (per currency) for the creator dashboard and orders page. */
  async summary(from?: Date, to?: Date) {
    const createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
    const [byType, paidOrders, refundsPending] = await Promise.all([
      this.db.ledgerEntry.groupBy({ by: ['type', 'currency'], where: { createdAt }, _sum: { amount: true } }),
      this.db.order.count({ where: { status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, paidAt: createdAt } }),
      this.db.refund.count({ where: { status: 'PENDING' } }),
    ]);
    const currencies: Record<string, Record<string, string>> = {};
    for (const r of byType) {
      currencies[r.currency] ??= {};
      currencies[r.currency][r.type] = r._sum.amount?.toString() ?? '0';
    }
    const totals = Object.entries(currencies).map(([currency, t]) => {
      const n = (k: string) => Number(t[k] ?? 0);
      const gross = n('SALE');
      const refunds = -n('REFUND');
      const tax = -(n('TAX') + n('TAX_REVERSAL'));
      const fees = -n('GATEWAY_FEE');
      const commission = -(n('PLATFORM_COMMISSION') + n('COMMISSION_REVERSAL'));
      const affiliate = -(n('AFFILIATE_COMMISSION') + n('AFFILIATE_REVERSAL'));
      return { currency, gross: gross.toFixed(2), refunds: refunds.toFixed(2), tax: tax.toFixed(2), gatewayFees: fees.toFixed(2), platformCommission: commission.toFixed(2), affiliateCommission: affiliate.toFixed(2), net: (gross - refunds - tax - fees - commission - affiliate).toFixed(2) };
    });
    return { paidOrders, refundsPending, totals };
  }

  // ── refunds ───────────────────────────────────────────────
  async refund(orderId: string, input: { amount?: number; reason?: string | null; revokeAccess?: boolean }, actorUserId: string) {
    const lockKey = `lock:refund:${orderId}`;
    if (!(await this.redis.set(lockKey, '1', 'EX', 60, 'NX'))) throw AppException.conflict('Another refund for this order is in progress.');
    try {
      const o = await this.db.order.findFirst({ where: { id: orderId }, include: { payments: { where: { status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } } }, refunds: { where: { status: { in: ['PENDING', 'PROCESSED'] } } } } });
      if (!o) throw AppException.notFound('Order not found');
      const payment = o.payments[0];
      if (!payment || !['PAID', 'PARTIALLY_REFUNDED'].includes(o.status)) throw AppException.conflict('Only paid online orders can be refunded.');
      const total = toMinor(o.totalAmount, o.currency);
      const reserved = o.refunds.reduce((s, r) => s + toMinor(r.amount, o.currency), 0);
      const available = total - reserved;
      const amount = input.amount !== undefined ? toMinor(input.amount, o.currency) : available;
      if (amount <= 0 || amount > available) throw AppException.validation([{ field: 'amount', message: `You can refund up to ${fmtMoney(available, o.currency)}` }]);
      const account = await this.gateways.credentialsById(payment.gatewayAccountId);
      if (!account) throw AppException.integrationNotConfigured('Razorpay');
      const refund = await this.db.refund.create({
        data: { orderId: o.id, paymentId: payment.id, amount: fromMinor(amount, o.currency), reason: input.reason?.trim() || null, revokeAccess: Boolean(input.revokeAccess) && amount === available && reserved === 0, requestedById: actorUserId } as never,
      });
      await this.audit.record({ action: 'refund.request', tenantId: o.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Order', targetId: o.id, after: { refundId: refund.id, amount: fromMinor(amount, o.currency), revokeAccess: refund.revokeAccess } });
      try {
        const r = await this.providers.get('RAZORPAY').refund(account.creds, { providerOrderId: payment.providerOrderId, providerPaymentId: payment.providerPaymentId, currency: payment.currency }, amount, refund.id, input.reason);
        await this.db.refund.update({ where: { id: refund.id }, data: { providerRefundId: r.providerRefundId } });
        await this.applyRefundStatus(refund.id, r.status);
      } catch (e) {
        const msg = e instanceof ProviderError ? e.message : 'Could not reach Razorpay';
        await this.db.refund.update({ where: { id: refund.id }, data: { status: 'FAILED', failureReason: msg.slice(0, 500) } });
        throw this.providerFailure(e);
      }
      return this.get(o.id);
    } finally {
      await this.redis.del(lockKey);
    }
  }

  async applyRefundStatus(refundId: string, status: 'PENDING' | 'PROCESSED' | 'FAILED') {
    if (status === 'PENDING') return 'pending';
    if (status === 'FAILED') {
      await this.db.refund.updateMany({ where: { id: refundId, status: 'PENDING' }, data: { status: 'FAILED', failureReason: 'Razorpay could not process the refund' } });
      return 'failed';
    }
    const done = await this.db.$transaction(async (tx) => {
      const claimed = await tx.refund.updateMany({ where: { id: refundId, status: 'PENDING' }, data: { status: 'PROCESSED', processedAt: new Date() } });
      if (!claimed.count) return null;
      const r = await tx.refund.findFirstOrThrow({ where: { id: refundId }, include: { order: { include: { items: true } } } });
      const o = r.order;
      const cur = o.currency;
      const amount = toMinor(r.amount, cur);
      const total = toMinor(o.totalAmount, cur);
      const refunded = toMinor(o.refundedAmount, cur) + amount;
      const full = refunded >= total;
      await tx.order.update({ where: { id: o.id }, data: { refundedAmount: fromMinor(refunded, cur), status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      await tx.payment.update({ where: { id: r.paymentId }, data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      const commissionRows = await tx.ledgerEntry.findMany({ where: { orderId: o.id, type: 'PLATFORM_COMMISSION' } });
      const commission = commissionRows.reduce((s, l) => s + toMinor(l.amount, cur), 0) * -1;
      const taxBack = proportional(toMinor(o.taxAmount, cur), amount, total);
      const commissionBack = proportional(commission, amount, total);
      const neg = (m: number) => `-${fromMinor(m, cur)}`;
      await tx.ledgerEntry.create({ data: { orderId: o.id, refundId: r.id, type: 'REFUND', amount: neg(amount), currency: cur, description: `Refund for ${o.number}` } as never });
      if (taxBack) await tx.ledgerEntry.create({ data: { orderId: o.id, refundId: r.id, type: 'TAX_REVERSAL', amount: fromMinor(taxBack, cur), currency: cur, description: 'GST on refunded amount' } as never });
      if (commissionBack) await tx.ledgerEntry.create({ data: { orderId: o.id, refundId: r.id, type: 'COMMISSION_REVERSAL', amount: fromMinor(commissionBack, cur), currency: cur, description: 'Commission on refunded amount' } as never });
      const conv = await tx.affiliateConversion.findFirst({ where: { orderId: o.id } });
      if (conv && conv.status !== 'REVERSED' && conv.status !== 'PAID') {
        const before = toMinor(conv.commission, cur);
        const after = await this.affiliates.adjustForRefund(tx, o.id, refunded, total);
        const now2 = after && 'commission' in after ? toMinor(after.commission, cur) : before;
        if (before - now2 > 0) await tx.ledgerEntry.create({ data: { orderId: o.id, refundId: r.id, type: 'AFFILIATE_REVERSAL', amount: fromMinor(before - now2, cur), currency: cur, description: 'Affiliate commission on refunded amount' } as never });
      }
      if (r.revokeAccess && full) {
        await tx.enrollment.updateMany({ where: { userId: o.userId, courseId: { in: o.items.map((i) => i.courseId).filter((x): x is string => Boolean(x)) }, source: 'PURCHASE' }, data: { status: 'REVOKED' } });
        for (const i of o.items) if (i.membershipPlanId) await this.memberships.revokeForRefund(tx, o.userId, i.membershipPlanId);
      }
      return { r, o, amount };
    });
    if (!done) return 'already-processed';
    const billing = done.o.billing as Record<string, string | null>;
    const { tenant } = await this.academy(done.o.tenantId);
    await this.audit.record({ action: 'refund.processed', tenantId: done.o.tenantId, actorRealm: 'SYSTEM', targetType: 'Order', targetId: done.o.id, after: { refundId: done.r.id, amount: done.r.amount.toString() } });
    await this.notifications.notify({ userId: done.o.userId, tenantId: done.o.tenantId, category: 'orders', title: 'Refund processed', body: `${fmtMoney(done.amount, done.o.currency)} for order ${done.o.number} is on its way.`, link: `/learn/orders/${done.o.id}`, brand: tenant.name, skipEmail: true }).catch(() => undefined);
    if (billing.email) {
      await this.mail.send({ to: billing.email, tenantId: done.o.tenantId, tag: 'refund-issued', ...emailTemplates.refundIssued({ brand: tenant.name, name: billing.name ?? '', orderNumber: done.o.number, amount: fmtMoney(done.amount, done.o.currency), accessRevoked: done.r.revokeAccess }) });
    }
    return 'processed';
  }

  // ── reconciliation (worker) ───────────────────────────────
  /**
   * Re-reads unsettled payments and refunds from Razorpay so missed webhooks or closed browser
   * tabs never leave a buyer charged without access. Runs across tenants, each in its own context.
   */
  async reconcile(now = new Date()) {
    const stats = { payments: 0, fulfilled: 0, refunds: 0, expired: 0, errors: 0 };
    const stalePayments = await this.prisma.payment.findMany({
      where: { status: 'CREATED', createdAt: { lt: new Date(now.getTime() - 5 * 60_000), gt: new Date(now.getTime() - 3 * 86_400_000) } },
      select: { id: true, tenantId: true, gatewayAccountId: true, providerOrderId: true, currency: true }, take: 200,
    });
    for (const p of stalePayments) {
      try {
        const account = await this.gateways.credentialsById(p.gatewayAccountId);
        if (!account) continue;
        const r = await this.providers.get('RAZORPAY').fetchPayment(account.creds, { providerOrderId: p.providerOrderId, currency: p.currency });
        const outcome = await this.ctx.run(p.tenantId, () => this.applyPaymentResult(p.id, r));
        stats.payments++;
        if (outcome === 'fulfilled') stats.fulfilled++;
      } catch (e) {
        stats.errors++;
        this.logger.warn({ paymentId: p.id, err: (e as Error).message }, 'reconcile payment failed');
      }
    }
    const pendingRefunds = await this.prisma.refund.findMany({
      where: { status: 'PENDING', providerRefundId: { not: null }, createdAt: { lt: new Date(now.getTime() - 2 * 60_000) } },
      include: { payment: { select: { gatewayAccountId: true } } }, take: 200,
    });
    for (const r of pendingRefunds) {
      try {
        const account = await this.gateways.credentialsById(r.payment.gatewayAccountId);
        if (!account) continue;
        const s = await this.providers.get('RAZORPAY').fetchRefund(account.creds, r.providerRefundId!);
        await this.ctx.run(r.tenantId, () => this.applyRefundStatus(r.id, s.status));
        stats.refunds++;
      } catch (e) {
        stats.errors++;
        this.logger.warn({ refundId: r.id, err: (e as Error).message }, 'reconcile refund failed');
      }
    }
    // Unpaid orders past their window stop accepting payment attempts (a late capture still fulfils).
    const expired = await this.prisma.order.updateMany({ where: { status: { in: ['PENDING', 'PAYMENT_INITIATED', 'FAILED'] }, expiresAt: { lt: now } }, data: { status: 'EXPIRED' } });
    stats.expired = expired.count;
    return stats;
  }
}
