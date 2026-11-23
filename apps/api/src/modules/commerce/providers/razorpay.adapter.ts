import { Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { safeEqual } from '../../../core/crypto/crypto.service.js';
import { basicAuth, PaymentHttp } from './http.js';
import {
  type CreatePaymentInput, type GatewayCredentials, InvalidSignatureError, type NormalizedPayment, type NormalizedRefund,
  type NormalizedWebhook, type PaymentAdapter, type PaymentRef, ProviderError,
} from './types.js';

const API = 'https://api.razorpay.com/v1';

export function razorpayCheckoutSignature(orderId: string, paymentId: string, keySecret: string) {
  return createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
}

export function razorpayWebhookSignature(rawBody: Buffer | string, secret: string) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function refundStatus(s: string): NormalizedRefund['status'] {
  return s === 'processed' ? 'PROCESSED' : s === 'failed' ? 'FAILED' : 'PENDING';
}

function normalize(p: any, providerOrderId: string): NormalizedPayment {
  const status = p.status === 'captured' ? 'CAPTURED' : p.status === 'failed' ? 'FAILED' : 'PENDING';
  return {
    providerOrderId, providerPaymentId: p.id, status, amountMinor: p.amount, currency: String(p.currency).toUpperCase(),
    method: p.method ?? null, feeMinor: typeof p.fee === 'number' ? p.fee : null, failureReason: p.error_description ?? null, raw: p,
  };
}

/** Razorpay Orders API + Checkout.js. Docs: razorpay.com/docs/api/orders, /payments, /refunds, /webhooks. */
@Injectable()
export class RazorpayAdapter implements PaymentAdapter {
  readonly key = 'RAZORPAY' as const;
  constructor(private readonly http: PaymentHttp) {}

  private async call(c: GatewayCredentials, method: 'GET' | 'POST', path: string, body?: unknown) {
    const res = await this.http.request(API + path, { method, body, headers: { Authorization: basicAuth(c.publicKey, c.secret) } });
    if (res.status >= 400) {
      const msg = res.json?.error?.description ?? `Razorpay returned ${res.status}`;
      throw new ProviderError('RAZORPAY', msg, res.status, res.status === 401);
    }
    return res.json;
  }

  /** Settlements (payouts to the academy's bank). Docs: razorpay.com/docs/api/settlements. */
  async settlements(c: GatewayCredentials, q: { from: number; to: number; count: number; skip: number }) {
    const r = await this.call(c, 'GET', `/settlements?from=${q.from}&to=${q.to}&count=${q.count}&skip=${q.skip}`);
    return ((r?.items ?? []) as Record<string, unknown>[]).map((s) => ({
      id: String(s.id), amountMinor: Number(s.amount ?? 0), feesMinor: Number(s.fees ?? 0), taxMinor: Number(s.tax ?? 0), utr: (s.utr as string | null) ?? null, status: String(s.status ?? ''), createdAt: new Date(Number(s.created_at ?? 0) * 1000),
    }));
  }

  /** Settlement reconciliation for one day: which transactions each settlement paid out. */
  async settlementRecon(c: GatewayCredentials, day: Date) {
    const r = await this.call(c, 'GET', `/settlements/recon/combined?year=${day.getUTCFullYear()}&month=${day.getUTCMonth() + 1}&day=${day.getUTCDate()}&count=1000`);
    return ((r?.items ?? []) as Record<string, unknown>[]).map((i) => ({ settlementId: (i.settlement_id as string | null) ?? null, type: String(i.type ?? '') }));
  }

  async verifyCredentials(c: GatewayCredentials) {
    await this.call(c, 'GET', '/payments?count=1');
  }

  async createPayment(c: GatewayCredentials, input: CreatePaymentInput) {
    const order = await this.call(c, 'POST', '/orders', {
      amount: input.amountMinor, currency: input.currency, receipt: input.orderNumber, notes: { orderId: input.orderId },
    });
    return {
      providerOrderId: order.id,
      clientPayload: {
        provider: 'RAZORPAY', keyId: c.publicKey, orderId: order.id, amount: input.amountMinor, currency: input.currency,
        name: input.merchantName, description: input.description,
        prefill: { name: input.customer.name, email: input.customer.email, contact: input.customer.phone ?? undefined },
      },
    };
  }

  async confirm(c: GatewayCredentials, payment: PaymentRef, data: Record<string, unknown>) {
    const paymentId = String(data.razorpay_payment_id ?? '');
    const signature = String(data.razorpay_signature ?? '');
    if (paymentId && signature) {
      const expected = razorpayCheckoutSignature(payment.providerOrderId, paymentId, c.secret);
      if (!safeEqual(expected, signature)) throw new ProviderError('RAZORPAY', 'Payment signature mismatch');
      let p = await this.call(c, 'GET', `/payments/${encodeURIComponent(paymentId)}`);
      if (p.order_id !== payment.providerOrderId) throw new ProviderError('RAZORPAY', 'Payment belongs to a different order');
      if (p.status === 'authorized') p = await this.call(c, 'POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: p.amount, currency: p.currency });
      return normalize(p, payment.providerOrderId);
    }
    return this.fetchPayment(c, payment);
  }

  async fetchPayment(c: GatewayCredentials, payment: PaymentRef): Promise<NormalizedPayment> {
    const list = await this.call(c, 'GET', `/orders/${encodeURIComponent(payment.providerOrderId)}/payments`);
    const items: any[] = list.items ?? [];
    const p = items.find((i) => i.status === 'captured') ?? items.find((i) => i.status === 'authorized') ?? items.find((i) => i.status === 'failed');
    if (!p) return { providerOrderId: payment.providerOrderId, status: 'PENDING', amountMinor: 0, currency: payment.currency, raw: list };
    if (p.status === 'authorized') {
      const captured = await this.call(c, 'POST', `/payments/${encodeURIComponent(p.id)}/capture`, { amount: p.amount, currency: p.currency });
      return normalize(captured, payment.providerOrderId);
    }
    return normalize(p, payment.providerOrderId);
  }

  async verifyWebhook(c: GatewayCredentials, rawBody: Buffer, headers: Record<string, string | undefined>): Promise<NormalizedWebhook> {
    const sig = headers['x-razorpay-signature'] ?? '';
    if (!c.webhookSecret || !sig || !safeEqual(razorpayWebhookSignature(rawBody, c.webhookSecret), sig)) throw new InvalidSignatureError('RAZORPAY');
    const body = JSON.parse(rawBody.toString('utf8'));
    const eventId = headers['x-razorpay-event-id'] || createHash('sha256').update(rawBody).digest('hex');
    const type: string = body.event ?? 'unknown';
    if (type.startsWith('payment.') || type === 'order.paid') {
      const providerOrderId = body.payload?.payment?.entity?.order_id ?? body.payload?.order?.entity?.id ?? null;
      return { eventId, type, kind: providerOrderId ? 'payment' : 'ignore', providerOrderId, payload: body };
    }
    if (type.startsWith('refund.')) {
      const r = body.payload?.refund?.entity;
      const refundStatus = type === 'refund.processed' ? 'PROCESSED' : type === 'refund.failed' ? 'FAILED' : 'PENDING';
      return { eventId, type, kind: r?.id ? 'refund' : 'ignore', providerRefundId: r?.id ?? null, refundStatus, payload: body };
    }
    return { eventId, type, kind: 'ignore', payload: body };
  }

  async refund(c: GatewayCredentials, payment: PaymentRef, amountMinor: number, refundId: string, reason?: string | null): Promise<NormalizedRefund> {
    if (!payment.providerPaymentId) throw new ProviderError('RAZORPAY', 'Payment has no Razorpay payment id');
    const r = await this.call(c, 'POST', `/payments/${encodeURIComponent(payment.providerPaymentId)}/refund`, {
      amount: amountMinor, receipt: refundId, notes: { refundId, reason: reason ?? '' },
    });
    return { providerRefundId: r.id, status: refundStatus(r.status) };
  }

  async fetchRefund(c: GatewayCredentials, providerRefundId: string): Promise<NormalizedRefund> {
    const r = await this.call(c, 'GET', `/refunds/${encodeURIComponent(providerRefundId)}`);
    return { providerRefundId: r.id, status: refundStatus(r.status) };
  }
}
