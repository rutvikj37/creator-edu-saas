import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { CryptoService } from '../../core/crypto/crypto.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { emailTemplates } from '../../core/mail/templates.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { QUEUES } from '../../core/queue/queue.constants.js';
import { REDIS_CLIENT } from '../../core/redis/redis.constants.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { addInterval, SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { renderInvoicePdf } from '../commerce/invoice-pdf.js';
import { financialYear, fmtMoney, nextSequence } from '../commerce/orders.service.js';
import { fromMinor, toMinor } from '../commerce/providers/money.js';
import { PaymentProviders } from '../commerce/providers/registry.js';
import { type GatewayCredentials, InvalidSignatureError, type NormalizedPayment, ProviderError } from '../commerce/providers/types.js';

type Tx = Prisma.TransactionClient;
const DAY = 86_400_000;
/** Renewal invoices are issued this long before the period ends. */
export const RENEWAL_LEAD_DAYS = 7;
const TRIAL_REMINDER_DAYS = 3;
export const PLATFORM_WEBHOOK_JOB = 'razorpay-platform-event';
const SETTING_KEYS = [
  'payments.razorpayKeyId', 'payments.razorpayKeySecret', 'payments.razorpayWebhookSecret', 'branding.name', 'tax.gstin', 'tax.defaultGstRate',
  'billing.legalName', 'billing.address', 'billing.graceDays', 'billing.minCommissionInvoice',
];

interface Line { description: string; amount: number }

/** Unused share of a paid period, in minor units. */
export function prorationCredit(paidNetMinor: number, periodStart: Date, periodEnd: Date, now: Date) {
  const total = periodEnd.getTime() - periodStart.getTime();
  const left = periodEnd.getTime() - now.getTime();
  if (total <= 0 || left <= 0) return 0;
  return Math.round((paidNetMinor * Math.min(left, total)) / total);
}

export function startOfMonthUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * SaaS plan billing: academies pay the platform for plans (prepaid per period) and for the
 * commission recorded on their sales, through the platform's own Razorpay account.
 * Lifecycle: TRIALING → (pay) ACTIVE → renewal invoice 7 days before period end → unpaid at
 * period end → PAST_DUE for the grace period (features keep working) → EXPIRED (features off).
 * Paying a renewal at any point restores ACTIVE. Every payment is confirmed with Razorpay.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly providers: PaymentProviders,
    private readonly subscriptions: SubscriptionsService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue(QUEUES.WEBHOOKS_IN) private readonly webhookQueue: Queue,
  ) {}

  // ── configuration ─────────────────────────────────────────
  private async settings() {
    const rows = await this.prisma.platformSetting.findMany({ where: { key: { in: SETTING_KEYS } } });
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = r.isSecret ? JSON.parse(this.crypto.decrypt(r.value as string)) : r.value;
    return out;
  }

  async platformCredentials(): Promise<GatewayCredentials | null> {
    const s = await this.settings();
    const keyId = s['payments.razorpayKeyId'] as string | undefined;
    const secret = s['payments.razorpayKeySecret'] as string | undefined;
    if (!keyId || !secret) return null;
    return { accountId: 'platform', provider: 'RAZORPAY', mode: keyId.startsWith('rzp_live_') ? 'LIVE' : 'TEST', publicKey: keyId, secret, webhookSecret: (s['payments.razorpayWebhookSecret'] as string) || null };
  }

  private async requireCredentials() {
    const c = await this.platformCredentials();
    if (!c) throw new AppException(ERROR_CODES.INTEGRATION_NOT_CONFIGURED, 'Online plan payments are not enabled yet. Contact support to upgrade.', HttpStatus.CONFLICT);
    return c;
  }

  webhookUrl() {
    return `${this.config.get('API_PUBLIC_URL').replace(/\/$/, '')}/api/v1/webhooks/razorpay/platform`;
  }

  async gatewayStatus(verify = false) {
    const c = await this.platformCredentials();
    if (!c) return { configured: false, webhookUrl: this.webhookUrl() };
    let status: 'UNVERIFIED' | 'VERIFIED' | 'ERROR' = 'UNVERIFIED';
    let error: string | null = null;
    if (verify) {
      try {
        await this.providers.get('RAZORPAY').verifyCredentials(c);
        status = 'VERIFIED';
      } catch (e) {
        status = 'ERROR';
        error = e instanceof ProviderError ? (e.authFailed ? 'Razorpay rejected these keys' : e.message) : 'Could not reach Razorpay';
      }
    }
    return { configured: true, mode: c.mode, keyId: c.publicKey, hasWebhookSecret: Boolean(c.webhookSecret), webhookUrl: this.webhookUrl(), status, error };
  }

  private async seller() {
    const s = await this.settings();
    return {
      name: (s['billing.legalName'] as string) || (s['branding.name'] as string) || this.config.get('APP_NAME'),
      address: (s['billing.address'] as string) || '',
      gstin: (s['tax.gstin'] as string) || null,
      gstRate: typeof s['tax.defaultGstRate'] === 'number' ? (s['tax.defaultGstRate'] as number) : 18,
      graceDays: typeof s['billing.graceDays'] === 'number' ? (s['billing.graceDays'] as number) : 7,
      minCommission: typeof s['billing.minCommissionInvoice'] === 'number' ? (s['billing.minCommissionInvoice'] as number) : 100,
    };
  }

  /** GST is charged on top of plan prices for INR invoices when the platform has a GSTIN; exports (non-INR) are zero-rated. */
  private taxFor(currency: string, seller: { gstin: string | null; gstRate: number }) {
    return currency === 'INR' && seller.gstin ? seller.gstRate : 0;
  }

  private totals(lines: Line[], credit: number, taxRate: number) {
    const subtotal = lines.reduce((s, l) => s + l.amount, 0);
    const net = Math.max(0, subtotal - credit);
    const tax = Math.round((net * taxRate) / 100);
    return { subtotal, credit: Math.min(credit, subtotal), tax, total: net + tax };
  }

  private async owner(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { owner: { select: { email: true, fullName: true } }, business: true } });
    return t;
  }

  private billingUrl() {
    return `${this.config.get('WEB_PUBLIC_URL')}/creator/billing`;
  }

  private async notify(tenantId: string, tag: string, subject: string, heading: string, lines: string[], cta = true) {
    const t = await this.owner(tenantId);
    const s = await this.seller();
    await this.mail.send({
      to: t.owner.email, tenantId, tag,
      ...emailTemplates.billingNotice({ brand: s.name, subject, heading, lines: [`Hi ${t.owner.fullName},`, ...lines], cta: cta ? { label: 'Open billing', url: this.billingUrl() } : undefined }),
    });
  }

  // ── views ─────────────────────────────────────────────────
  view(i: any) {
    const m = (v: any) => (v === null || v === undefined ? null : v.toString());
    return {
      id: i.id, tenantId: i.tenantId, number: i.number, kind: i.kind, status: i.status, planId: i.planId, planPriceId: i.planPriceId, interval: i.interval,
      periodStart: i.periodStart, periodEnd: i.periodEnd, currency: i.currency, subtotalAmount: m(i.subtotalAmount), creditAmount: m(i.creditAmount),
      taxAmount: m(i.taxAmount), taxRate: m(i.taxRate), totalAmount: m(i.totalAmount), lines: i.lines, dueAt: i.dueAt, paidAt: i.paidAt, paidVia: i.paidVia,
      reference: i.reference, voidedAt: i.voidedAt, voidReason: i.voidReason, createdAt: i.createdAt,
      payments: i.payments?.map((p: any) => ({ id: p.id, status: p.status, providerOrderId: p.providerOrderId, providerPaymentId: p.providerPaymentId, amount: m(p.amount), method: p.method, failureReason: p.failureReason, createdAt: p.createdAt })),
    };
  }

  /** Public plans with prices, marking the tenant's current price. */
  async plans(tenantId: string) {
    const [plans, sub, tenant] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({ where: { status: 'ACTIVE', isPublic: true }, include: { prices: { where: { active: true }, orderBy: [{ currency: 'asc' }, { interval: 'asc' }] }, features: true }, orderBy: { sortOrder: 'asc' } }),
      this.subscriptions.current(tenantId),
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultCurrency: true } }),
    ]);
    return {
      currency: tenant.defaultCurrency,
      paymentsEnabled: Boolean(await this.platformCredentials()),
      current: sub ? { planId: sub.planId, planPriceId: sub.planPriceId, status: sub.status } : null,
      plans: plans.map((p) => ({
        id: p.id, code: p.code, name: p.name, description: p.description, trialDays: p.trialDays,
        features: p.features.map((f) => ({ key: f.featureKey, enabled: f.enabled, limit: f.limitValue === null ? null : Number(f.limitValue) })),
        prices: p.prices.map((x) => ({ id: x.id, interval: x.interval, currency: x.currency, amount: x.amount.toString() })),
      })),
    };
  }

  async listForTenant(tenantId: string) {
    const rows = await this.prisma.billingInvoice.findMany({ where: { tenantId, status: { not: 'VOID' } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((r) => this.view(r));
  }

  async getForTenant(tenantId: string, id: string) {
    const i = await this.prisma.billingInvoice.findFirst({ where: { id, tenantId }, include: { payments: { orderBy: { createdAt: 'desc' } } } });
    if (!i) throw AppException.notFound('Invoice not found');
    return this.view(i);
  }

  // ── plan checkout ─────────────────────────────────────────
  private async build(tenantId: string, planPriceId: string, now = new Date()) {
    const price = await this.prisma.planPrice.findFirst({ where: { id: planPriceId, active: true }, include: { plan: true } });
    if (!price || price.plan.status !== 'ACTIVE' || !price.plan.isPublic) throw AppException.validation([{ field: 'planPriceId', message: 'This plan is not available' }]);
    const sub = await this.subscriptions.current(tenantId);
    if (sub && sub.planPriceId === price.id && ['ACTIVE', 'PAST_DUE'].includes(sub.status)) {
      throw AppException.conflict(sub.status === 'PAST_DUE' ? 'Pay your renewal invoice to keep this plan.' : 'You are already on this plan.');
    }
    const cur = price.currency;
    const lines: Line[] = [{ description: `${price.plan.name} plan — ${price.interval === 'YEAR' ? 'yearly' : 'monthly'}`, amount: toMinor(price.amount, cur) }];
    // Credit the unused part of a period the academy actually paid for (same currency only).
    let credit = 0;
    let creditNote: string | null = null;
    if (sub?.currentPeriodEnd && sub.status === 'ACTIVE' && sub.planPriceId) {
      const paid = await this.prisma.billingInvoice.findFirst({ where: { tenantId, status: 'PAID', kind: { in: ['PLAN', 'RENEWAL'] }, periodEnd: sub.currentPeriodEnd, currency: cur }, orderBy: { paidAt: 'desc' } });
      if (paid && paid.periodStart) {
        const paidNet = toMinor(paid.subtotalAmount, cur) - toMinor(paid.creditAmount, cur);
        credit = prorationCredit(paidNet, paid.periodStart, sub.currentPeriodEnd, now);
        if (credit) creditNote = `Credit for unused time on ${sub.plan.name}`;
      }
    }
    const seller = await this.seller();
    const taxRate = this.taxFor(cur, seller);
    const t = this.totals(lines, credit, taxRate);
    return { price, sub, lines, creditNote, taxRate, totals: t, cur };
  }

  async quote(tenantId: string, planPriceId: string) {
    const b = await this.build(tenantId, planPriceId);
    const f = (n: number) => fromMinor(n, b.cur);
    return {
      plan: { id: b.price.plan.id, name: b.price.plan.name }, interval: b.price.interval, currency: b.cur,
      lines: b.lines.map((l) => ({ description: l.description, amount: f(l.amount) })), credit: f(b.totals.credit), creditNote: b.creditNote,
      taxRate: b.taxRate, tax: f(b.totals.tax), total: f(b.totals.total), paymentsEnabled: Boolean(await this.platformCredentials()) || b.totals.total === 0,
    };
  }

  async checkout(tenantId: string, planPriceId: string, actorUserId: string) {
    const b = await this.build(tenantId, planPriceId);
    if (b.totals.total > 0) await this.requireCredentials();
    const f = (n: number) => fromMinor(n, b.cur);
    const invoice = await this.prisma.$transaction(async (tx) => {
      await tx.billingInvoice.updateMany({ where: { tenantId, status: 'OPEN', kind: 'PLAN' }, data: { status: 'VOID', voidedAt: new Date(), voidReason: 'Replaced by a newer plan checkout' } });
      return tx.billingInvoice.create({
        data: {
          tenantId, kind: 'PLAN', planId: b.price.plan.id, planPriceId: b.price.id, interval: b.price.interval, currency: b.cur,
          subtotalAmount: f(b.totals.subtotal), creditAmount: f(b.totals.credit), taxAmount: f(b.totals.tax), totalAmount: f(b.totals.total), taxRate: b.taxRate || null,
          lines: [...b.lines.map((l) => ({ description: l.description, amount: f(l.amount) })), ...(b.creditNote ? [{ description: b.creditNote, amount: `-${f(b.totals.credit)}` }] : [])],
          dueAt: new Date(), createdById: actorUserId,
        },
      });
    });
    await this.audit.record({ action: 'billing.checkout', tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'BillingInvoice', targetId: invoice.id, after: { plan: b.price.plan.code, interval: b.price.interval, total: invoice.totalAmount.toString() } });
    if (b.totals.total === 0) await this.markPaid(invoice.id, { via: 'CREDIT', reference: null });
    return this.getForTenant(tenantId, invoice.id);
  }

  async pay(tenantId: string, invoiceId: string) {
    const i = await this.prisma.billingInvoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!i) throw AppException.notFound('Invoice not found');
    if (i.status !== 'OPEN') throw AppException.conflict(i.status === 'PAID' ? 'This invoice is already paid.' : 'This invoice was cancelled.');
    const creds = await this.requireCredentials();
    const t = await this.owner(tenantId);
    const s = await this.seller();
    const amountMinor = toMinor(i.totalAmount, i.currency);
    let created;
    try {
      created = await this.providers.get('RAZORPAY').createPayment(creds, {
        orderId: i.id, orderNumber: `BILL-${i.id.slice(-10)}`, amountMinor, currency: i.currency, merchantName: s.name,
        description: (i.lines as { description: string }[]).map((l) => l.description).join(', ').slice(0, 250),
        customer: { id: tenantId, name: t.business?.legalName || t.name, email: t.owner.email, phone: null },
      });
    } catch (e) {
      throw this.providerFailure(e);
    }
    await this.prisma.billingPayment.create({ data: { tenantId, invoiceId: i.id, providerOrderId: created.providerOrderId, amount: i.totalAmount, currency: i.currency } });
    return { invoiceId: i.id, checkout: created.clientPayload };
  }

  async confirm(tenantId: string, invoiceId: string, data: Record<string, unknown>) {
    const providerOrderId = String(data.razorpay_order_id ?? '');
    const payment = await this.prisma.billingPayment.findFirst({ where: { tenantId, invoiceId, providerOrderId } });
    if (!payment) throw AppException.validation([{ field: 'razorpay_order_id', message: 'Unknown payment for this invoice' }]);
    const creds = await this.requireCredentials();
    let r: NormalizedPayment;
    try {
      r = await this.providers.get('RAZORPAY').confirm(creds, { providerOrderId, currency: payment.currency }, data);
    } catch (e) {
      throw this.providerFailure(e);
    }
    await this.applyPayment(payment.id, r);
    return this.getForTenant(tenantId, invoiceId);
  }

  private providerFailure(e: unknown) {
    if (e instanceof ProviderError) {
      if (!e.httpStatus) return AppException.validation([{ field: 'payment', message: e.message }], e.message);
      return new AppException(ERROR_CODES.PAYMENT_PROVIDER_ERROR, `Razorpay: ${e.message}`, HttpStatus.BAD_GATEWAY);
    }
    return e;
  }

  /** Applies a Razorpay-verified state to a billing payment. Idempotent. */
  async applyPayment(paymentId: string, r: NormalizedPayment) {
    const p = await this.prisma.billingPayment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
    if (!p || p.status === 'CAPTURED') return 'already-captured';
    if (r.status === 'CAPTURED') {
      const expected = toMinor(p.invoice.totalAmount, p.invoice.currency);
      if (r.amountMinor !== expected || r.currency !== p.invoice.currency) {
        await this.prisma.billingPayment.update({ where: { id: p.id }, data: { status: 'FAILED', failureReason: `Amount mismatch: expected ${fmtMoney(expected, p.invoice.currency)}, got ${fmtMoney(r.amountMinor, r.currency)}`, raw: r.raw as never } });
        await this.audit.record({ action: 'billing.amount_mismatch', tenantId: p.tenantId, actorRealm: 'SYSTEM', targetType: 'BillingPayment', targetId: p.id });
        return 'mismatch';
      }
      const ok = await this.markPaid(p.invoiceId, { via: 'RAZORPAY', reference: r.providerPaymentId ?? null, payment: { id: p.id, r } });
      return ok ? 'paid' : 'already-paid';
    }
    if (r.status === 'FAILED') {
      await this.prisma.billingPayment.update({ where: { id: p.id }, data: { status: 'FAILED', providerPaymentId: r.providerPaymentId ?? null, failureReason: r.failureReason ?? 'Payment failed', raw: r.raw as never } });
      return 'failed';
    }
    return 'pending';
  }

  /** Marks an invoice paid and applies its effect (plan change, renewal) in one transaction. */
  async markPaid(invoiceId: string, opts: { via: 'RAZORPAY' | 'OFFLINE' | 'CREDIT'; reference: string | null; payment?: { id: string; r: NormalizedPayment }; actorUserId?: string }) {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.billingInvoice.updateMany({ where: { id: invoiceId, status: 'OPEN' }, data: { status: 'PAID', paidAt: now, paidVia: opts.via, reference: opts.reference } });
      if (!claimed.count) return null;
      const inv = await tx.billingInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
      const fy = financialYear(now);
      const seq = await nextSequence(tx, 'platform', `billing:${fy}`);
      await tx.billingInvoice.update({ where: { id: inv.id }, data: { number: `PLT/${fy}/${String(seq).padStart(5, '0')}` } });
      if (opts.payment) {
        const r = opts.payment.r;
        await tx.billingPayment.update({ where: { id: opts.payment.id }, data: { status: 'CAPTURED', providerPaymentId: r.providerPaymentId ?? null, method: r.method ?? null, capturedAt: now, raw: r.raw as never } });
      }
      await this.applyEffect(tx, inv, now);
      return inv;
    }, { timeout: 20_000 });
    if (!result) return false;
    await this.entitlements.invalidate(result.tenantId);
    await this.audit.record({ action: 'billing.paid', tenantId: result.tenantId, actorUserId: opts.actorUserId ?? null, actorRealm: opts.actorUserId ? 'PLATFORM' : 'SYSTEM', targetType: 'BillingInvoice', targetId: result.id, after: { via: opts.via, reference: opts.reference, total: result.totalAmount.toString() } });
    const fresh = await this.prisma.billingInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    await this.notify(result.tenantId, 'billing-receipt', `Payment received — ${fresh.number}`, 'Thank you for your payment',
      [`We received ${fmtMoney(toMinor(fresh.totalAmount, fresh.currency), fresh.currency)} for invoice ${fresh.number}.`, ...(fresh.periodEnd ? [`Your plan is active until ${fresh.periodEnd.toISOString().slice(0, 10)}.`] : [])]);
    return true;
  }

  private async applyEffect(tx: Tx, inv: { id: string; tenantId: string; kind: string; planId: string | null; planPriceId: string | null; subscriptionId: string | null; periodStart: Date | null; interval: 'MONTH' | 'YEAR' | null }, now: Date) {
    if (inv.kind === 'COMMISSION') return;
    const sub = inv.subscriptionId ? await tx.subscription.findUnique({ where: { id: inv.subscriptionId } }) : null;
    if (inv.kind === 'RENEWAL' && sub && sub.currentKey === 'current' && sub.planPriceId === inv.planPriceId && inv.interval && inv.periodStart) {
      // Paid during grace: the new period continues from the old end. Paid after expiry: starts now.
      const start = sub.status === 'EXPIRED' || inv.periodStart < new Date(now.getTime() - 60 * DAY) ? now : inv.periodStart;
      const end = addInterval(start, inv.interval);
      await tx.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: end, graceEndsAt: null, cancelAtPeriodEnd: false } });
      await tx.billingInvoice.update({ where: { id: inv.id }, data: { periodStart: start, periodEnd: end } });
      return;
    }
    // New plan (or a renewal whose subscription was replaced): start a fresh paid period now.
    const created = await this.subscriptions.assignPlan(tx, { tenantId: inv.tenantId, planId: inv.planId!, planPriceId: inv.planPriceId, source: 'billing', allowTrial: false });
    await tx.billingInvoice.update({ where: { id: inv.id }, data: { subscriptionId: created.id, periodStart: created.currentPeriodStart, periodEnd: created.currentPeriodEnd } });
    await tx.billingInvoice.updateMany({ where: { tenantId: inv.tenantId, status: 'OPEN', kind: 'RENEWAL' }, data: { status: 'VOID', voidedAt: now, voidReason: 'Plan changed' } });
  }

  // ── cancellation ──────────────────────────────────────────
  async setCancelAtPeriodEnd(tenantId: string, cancel: boolean, actorUserId: string) {
    const sub = await this.subscriptions.current(tenantId);
    if (!sub || !sub.planPriceId || !['ACTIVE', 'PAST_DUE'].includes(sub.status)) throw AppException.conflict('There is no paid plan to change.');
    await this.prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: cancel } });
    if (cancel) await this.prisma.billingInvoice.updateMany({ where: { tenantId, status: 'OPEN', kind: 'RENEWAL' }, data: { status: 'VOID', voidedAt: new Date(), voidReason: 'Plan set to cancel' } });
    await this.audit.record({ action: cancel ? 'billing.cancel' : 'billing.resume', tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Subscription', targetId: sub.id });
    return this.subscriptions.current(tenantId);
  }

  // ── admin ─────────────────────────────────────────────────
  async adminInvoices(params: { status?: string; tenantId?: string; page?: number; pageSize?: number }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const where = { ...(params.status ? { status: params.status as never } : {}), ...(params.tenantId ? { tenantId: params.tenantId } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.billingInvoice.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.billingInvoice.count({ where }),
    ]);
    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true, slug: true } });
    const byId = new Map(tenants.map((t) => [t.id, t]));
    return { items: rows.map((r) => ({ ...this.view(r), tenant: byId.get(r.tenantId) ?? null })), meta: { page, pageSize, total } };
  }

  async adminSubscriptions(params: { status?: string; page?: number; pageSize?: number }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const where = { currentKey: 'current', ...(params.status ? { status: params.status as never } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.subscription.findMany({ where, include: { plan: { select: { name: true, code: true } }, planPrice: true, tenant: { select: { id: true, name: true, slug: true } } }, orderBy: [{ currentPeriodEnd: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.subscription.count({ where }),
    ]);
    return {
      items: rows.map((s) => ({
        id: s.id, tenant: s.tenant, plan: s.plan, status: s.status, interval: s.planPrice?.interval ?? null, amount: s.planPrice?.amount.toString() ?? null, currency: s.planPrice?.currency ?? null,
        currentPeriodEnd: s.currentPeriodEnd, trialEndsAt: s.trialEndsAt, graceEndsAt: s.graceEndsAt, cancelAtPeriodEnd: s.cancelAtPeriodEnd, source: s.source,
      })),
      meta: { page, pageSize, total },
    };
  }

  async recordOfflinePayment(id: string, reference: string, actorUserId: string) {
    const i = await this.prisma.billingInvoice.findUnique({ where: { id } });
    if (!i) throw AppException.notFound('Invoice not found');
    if (i.status !== 'OPEN') throw AppException.conflict('Only open invoices can be marked as paid.');
    await this.markPaid(id, { via: 'OFFLINE', reference, actorUserId });
    return this.view(await this.prisma.billingInvoice.findUniqueOrThrow({ where: { id } }));
  }

  async voidInvoice(id: string, reason: string, actorUserId: string) {
    const r = await this.prisma.billingInvoice.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason } });
    if (!r.count) throw AppException.conflict('Only open invoices can be voided.');
    const i = await this.prisma.billingInvoice.findUniqueOrThrow({ where: { id } });
    await this.audit.record({ action: 'billing.void', tenantId: i.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'BillingInvoice', targetId: id, after: { reason } });
    return this.view(i);
  }

  async pdf(id: string, tenantId?: string) {
    const i = await this.prisma.billingInvoice.findFirst({ where: { id, ...(tenantId ? { tenantId } : {}) } });
    if (!i) throw AppException.notFound('Invoice not found');
    const [t, s] = await Promise.all([this.owner(i.tenantId), this.seller()]);
    const b = t.business;
    const pdf = await renderInvoicePdf({
      number: i.number ?? `DRAFT-${i.id.slice(-8).toUpperCase()}`, issuedAt: i.paidAt ?? i.createdAt, orderNumber: i.kind === 'COMMISSION' ? 'Platform commission' : 'Plan subscription',
      seller: { name: s.name, address: s.address, gstin: s.gstin },
      buyer: { name: b?.legalName || t.name, email: t.owner.email, state: b?.state ?? null, gstin: b?.gstRegistered ? b.gstin : null },
      lines: (i.lines as { description: string; amount: string }[]).map((l) => ({ description: l.description, quantity: 1, unitAmount: l.amount, discountAmount: '0', totalAmount: l.amount })),
      totals: {
        currency: i.currency, subtotal: (Number(i.subtotalAmount) - Number(i.creditAmount)).toFixed(2), discount: '0', tax: i.taxAmount.toString(), taxRate: i.taxRate?.toString() ?? null, taxInclusive: false,
        total: i.totalAmount.toString(), paidVia: i.status === 'PAID' ? (i.paidVia === 'RAZORPAY' ? 'Razorpay' : i.paidVia === 'CREDIT' ? 'account credit' : 'bank transfer') : 'unpaid', paymentId: i.reference,
      },
    });
    return { pdf, filename: `${(i.number ?? `draft-${i.id.slice(-8)}`).replace(/[^A-Za-z0-9-]+/g, '-')}.pdf` };
  }

  // ── platform webhook ──────────────────────────────────────
  async receiveWebhook(rawBody: Buffer | undefined, headers: Record<string, string | undefined>) {
    const creds = await this.platformCredentials();
    if (!creds || !rawBody?.length) throw AppException.notFound('Unknown webhook endpoint');
    let event;
    try {
      event = await this.providers.get('RAZORPAY').verifyWebhook(creds, rawBody, headers);
    } catch (e) {
      if (e instanceof InvalidSignatureError) throw new AppException(ERROR_CODES.UNAUTHENTICATED, 'Invalid webhook signature', HttpStatus.UNAUTHORIZED);
      throw AppException.validation([{ field: 'body', message: 'Malformed webhook payload' }]);
    }
    const exists = await this.prisma.webhookEvent.findUnique({ where: { provider_eventId: { provider: 'RAZORPAY', eventId: event.eventId } } });
    if (exists) return { received: true, duplicate: true };
    try {
      const row = await this.prisma.webhookEvent.create({
        data: { provider: 'RAZORPAY', eventId: event.eventId, type: event.type.slice(0, 100), payload: event.payload as never, status: event.kind === 'payment' ? 'RECEIVED' : 'IGNORED', processedAt: event.kind === 'payment' ? null : new Date() },
      });
      if (event.kind === 'payment' && event.providerOrderId) await this.webhookQueue.add(PLATFORM_WEBHOOK_JOB, { id: row.id, providerOrderId: event.providerOrderId }, { jobId: row.id });
    } catch (e: any) {
      if (e?.code === 'P2002') return { received: true, duplicate: true };
      throw e;
    }
    return { received: true };
  }

  async processWebhook(id: string, providerOrderId: string) {
    const creds = await this.requireCredentials();
    const p = await this.prisma.billingPayment.findUnique({ where: { providerOrderId } });
    let note = 'No matching billing payment';
    if (p) {
      const r = await this.providers.get('RAZORPAY').fetchPayment(creds, { providerOrderId, currency: p.currency });
      note = await this.applyPayment(p.id, r);
    }
    await this.prisma.webhookEvent.update({ where: { id }, data: { status: p ? 'PROCESSED' : 'IGNORED', error: p ? null : note, processedAt: new Date(), attempts: { increment: 1 } } });
    return note;
  }

  // ── billing cycle (worker) ────────────────────────────────
  private async createRenewal(sub: { id: string; tenantId: string; planId: string; planPriceId: string | null; currentPeriodEnd: Date | null }) {
    if (!sub.planPriceId || !sub.currentPeriodEnd) return null;
    const exists = await this.prisma.billingInvoice.findFirst({ where: { subscriptionId: sub.id, kind: 'RENEWAL', periodStart: sub.currentPeriodEnd, status: { in: ['OPEN', 'PAID'] } } });
    if (exists) return null;
    const price = await this.prisma.planPrice.findUnique({ where: { id: sub.planPriceId }, include: { plan: true } });
    if (!price) return null;
    const cur = price.currency;
    const seller = await this.seller();
    const taxRate = this.taxFor(cur, seller);
    const lines: Line[] = [{ description: `${price.plan.name} plan — ${price.interval === 'YEAR' ? 'yearly' : 'monthly'} renewal`, amount: toMinor(price.amount, cur) }];
    const t = this.totals(lines, 0, taxRate);
    const f = (n: number) => fromMinor(n, cur);
    const inv = await this.prisma.billingInvoice.create({
      data: {
        tenantId: sub.tenantId, kind: 'RENEWAL', subscriptionId: sub.id, planId: price.planId, planPriceId: price.id, interval: price.interval,
        periodStart: sub.currentPeriodEnd, periodEnd: addInterval(sub.currentPeriodEnd, price.interval), currency: cur,
        subtotalAmount: f(t.subtotal), taxAmount: f(t.tax), totalAmount: f(t.total), taxRate: taxRate || null,
        lines: lines.map((l) => ({ description: l.description, amount: f(l.amount) })), dueAt: sub.currentPeriodEnd,
      },
    });
    await this.notify(sub.tenantId, 'billing-renewal', `Your ${price.plan.name} renewal invoice`, 'Your plan renews soon',
      [`Your ${price.plan.name} plan renews on ${sub.currentPeriodEnd.toISOString().slice(0, 10)}. Amount due: ${fmtMoney(t.total, cur)}.`, 'Pay before the renewal date to keep every feature running without interruption.']);
    return inv;
  }

  /** Monthly commission invoices for the previous calendar month(s), per currency. */
  private async commissionInvoices(now: Date) {
    const to = startOfMonthUtc(now);
    const seller = await this.seller();
    const groups = await this.prisma.ledgerEntry.groupBy({ by: ['tenantId', 'currency'], where: { type: { in: ['PLATFORM_COMMISSION', 'COMMISSION_REVERSAL'] }, createdAt: { lt: to } } });
    let created = 0;
    for (const g of groups) {
      const last = await this.prisma.billingInvoice.findFirst({ where: { tenantId: g.tenantId, kind: 'COMMISSION', currency: g.currency, status: { not: 'VOID' } }, orderBy: { commissionTo: 'desc' } });
      const from = last?.commissionTo ?? new Date(0);
      if (from >= to) continue;
      const sum = await this.prisma.ledgerEntry.aggregate({ where: { tenantId: g.tenantId, currency: g.currency, type: { in: ['PLATFORM_COMMISSION', 'COMMISSION_REVERSAL'] }, createdAt: { gte: from, lt: to } }, _sum: { amount: true } });
      const owed = -toMinor(sum._sum.amount ?? 0, g.currency);
      const min = g.currency === 'INR' ? toMinor(seller.minCommission, 'INR') : 100;
      if (owed < Math.max(1, min)) continue; // carried over to the next month
      const taxRate = this.taxFor(g.currency, seller);
      const label = `Platform commission on sales up to ${new Date(to.getTime() - 1).toISOString().slice(0, 10)}`;
      const t = this.totals([{ description: label, amount: owed }], 0, taxRate);
      const f = (n: number) => fromMinor(n, g.currency);
      await this.prisma.billingInvoice.create({
        data: {
          tenantId: g.tenantId, kind: 'COMMISSION', currency: g.currency, subtotalAmount: f(t.subtotal), taxAmount: f(t.tax), totalAmount: f(t.total), taxRate: taxRate || null,
          commissionFrom: from, commissionTo: to, lines: [{ description: label, amount: f(owed) }], dueAt: new Date(now.getTime() + 7 * DAY),
        },
      });
      await this.notify(g.tenantId, 'billing-commission', 'Your monthly commission invoice', 'Commission invoice', [`Commission on your course sales: ${fmtMoney(t.total, g.currency)}, due within 7 days.`]);
      created++;
    }
    return created;
  }

  async runCycle(now = new Date()) {
    const stats = { trialsEnded: 0, renewalsCreated: 0, pastDue: 0, expired: 0, canceled: 0, reminders: 0, commissionInvoices: 0, paymentsReconciled: 0, errors: 0 };
    const seller = await this.seller();
    const step = async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        stats.errors++;
        this.logger.error({ err: (e as Error).message }, 'billing cycle step failed');
      }
    };

    // Trials: reminder, then end.
    await step(async () => {
      const ending = await this.prisma.subscription.findMany({ where: { currentKey: 'current', status: 'TRIALING', trialEndsAt: { gt: now, lte: new Date(now.getTime() + TRIAL_REMINDER_DAYS * DAY) } } });
      for (const s of ending) {
        if (await this.redis.set(`billing:trial-reminder:${s.id}`, '1', 'EX', 30 * 86_400, 'NX')) {
          await this.notify(s.tenantId, 'billing-trial-ending', 'Your free trial ends soon', 'Your trial is ending', [`Your free trial ends on ${s.trialEndsAt!.toISOString().slice(0, 10)}. Choose a plan to keep selling and teaching without interruption.`]);
          stats.reminders++;
        }
      }
      const ended = await this.prisma.subscription.findMany({ where: { currentKey: 'current', status: 'TRIALING', trialEndsAt: { lte: now } } });
      for (const s of ended) {
        await this.prisma.subscription.update({ where: { id: s.id }, data: { status: 'EXPIRED' } });
        await this.entitlements.invalidate(s.tenantId);
        await this.notify(s.tenantId, 'billing-trial-ended', 'Your free trial has ended', 'Your trial has ended', ['Your academy stays online and students keep their access, but creating courses and taking new payments is paused until you choose a plan.']);
        stats.trialsEnded++;
      }
    });

    // Renewal invoices ahead of the period end.
    await step(async () => {
      const due = await this.prisma.subscription.findMany({ where: { currentKey: 'current', status: 'ACTIVE', cancelAtPeriodEnd: false, planPriceId: { not: null }, currentPeriodEnd: { lte: new Date(now.getTime() + RENEWAL_LEAD_DAYS * DAY) } } });
      for (const s of due) if (await this.createRenewal(s)) stats.renewalsCreated++;
    });

    // Period ends: cancel, or move to past due with a grace period.
    await step(async () => {
      const ended = await this.prisma.subscription.findMany({ where: { currentKey: 'current', status: 'ACTIVE', currentPeriodEnd: { lte: now } } });
      for (const s of ended) {
        if (s.cancelAtPeriodEnd || !s.planPriceId) {
          await this.prisma.subscription.update({ where: { id: s.id }, data: { status: s.cancelAtPeriodEnd ? 'CANCELED' : 'EXPIRED', canceledAt: s.cancelAtPeriodEnd ? now : null } });
          await this.entitlements.invalidate(s.tenantId);
          await this.notify(s.tenantId, 'billing-ended', 'Your plan has ended', 'Your plan has ended', ['Your academy stays online and students keep their access. Choose a plan to resume creating courses and taking payments.']);
          stats.canceled++;
          continue;
        }
        await this.createRenewal(s);
        const graceEndsAt = new Date(s.currentPeriodEnd!.getTime() + seller.graceDays * DAY);
        await this.prisma.subscription.update({ where: { id: s.id }, data: { status: 'PAST_DUE', graceEndsAt } });
        await this.entitlements.invalidate(s.tenantId);
        await this.notify(s.tenantId, 'billing-past-due', 'Payment overdue — action needed', 'Your renewal payment is overdue',
          [`We couldn't renew your plan because the renewal invoice is unpaid. Everything keeps working until ${graceEndsAt.toISOString().slice(0, 10)}; after that, creating courses and taking new payments pauses.`]);
        stats.pastDue++;
      }
    });

    // Grace over: expire.
    await step(async () => {
      const over = await this.prisma.subscription.findMany({ where: { currentKey: 'current', status: 'PAST_DUE', graceEndsAt: { lte: now } } });
      for (const s of over) {
        await this.prisma.subscription.update({ where: { id: s.id }, data: { status: 'EXPIRED' } });
        await this.entitlements.invalidate(s.tenantId);
        await this.notify(s.tenantId, 'billing-expired', 'Your plan has expired', 'Your plan has expired', ['The renewal invoice is still unpaid, so creating courses and taking new payments is paused. Students keep their access. Paying the invoice restores your plan immediately.']);
        stats.expired++;
      }
    });

    // Reminders for open renewal/commission invoices: 3 days before, on, and 3 days after the due date.
    await step(async () => {
      const open = await this.prisma.billingInvoice.findMany({ where: { status: 'OPEN', kind: { in: ['RENEWAL', 'COMMISSION'] }, reminderStage: { lt: 3 } } });
      for (const i of open) {
        const at = [i.dueAt.getTime() - 3 * DAY, i.dueAt.getTime(), i.dueAt.getTime() + 3 * DAY];
        let stage = i.reminderStage;
        while (stage < 3 && now.getTime() >= at[stage]) stage++;
        if (stage === i.reminderStage) continue;
        const r = await this.prisma.billingInvoice.updateMany({ where: { id: i.id, reminderStage: i.reminderStage }, data: { reminderStage: stage } });
        if (!r.count || stage === 1) continue; // stage 1 coincides with the renewal email
        await this.notify(i.tenantId, 'billing-reminder', stage === 2 ? 'Invoice due today' : 'Invoice overdue', stage === 2 ? 'Your invoice is due today' : 'Your invoice is overdue', [`Amount due: ${fmtMoney(toMinor(i.totalAmount, i.currency), i.currency)}.`]);
        stats.reminders++;
      }
    });

    await step(async () => { stats.commissionInvoices = await this.commissionInvoices(now); });

    // Payments where the browser never came back and no webhook arrived.
    await step(async () => {
      const creds = await this.platformCredentials();
      if (!creds) return;
      const stale = await this.prisma.billingPayment.findMany({ where: { status: 'CREATED', createdAt: { lt: new Date(now.getTime() - 5 * 60_000), gt: new Date(now.getTime() - 3 * DAY) } }, take: 200 });
      for (const p of stale) {
        const r = await this.providers.get('RAZORPAY').fetchPayment(creds, { providerOrderId: p.providerOrderId, currency: p.currency });
        if ((await this.applyPayment(p.id, r)) === 'paid') stats.paymentsReconciled++;
      }
    });
    return stats;
  }
}
