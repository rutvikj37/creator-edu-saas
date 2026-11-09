import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac } from 'node:crypto';
import { PaymentHttp, type HttpRequest, type HttpResponse } from '../src/modules/commerce/providers/http.js';

/**
 * In-memory Razorpay used by the e2e suite. It implements only the REST endpoints our adapter
 * calls, with Razorpay's response shapes, basic-auth checking and real HMAC signatures, so the
 * production adapter code runs unchanged. It never talks to the network.
 */
export class RazorpaySim {
  keys = new Map<string, string>();
  orders = new Map<string, any>();
  payments = new Map<string, any>();
  refunds = new Map<string, any>();
  refundMode: 'processed' | 'pending' = 'processed';
  calls: string[] = [];
  private n = 0;

  install(app: NestExpressApplication) {
    app.get(PaymentHttp).request = (url, req) => this.handle(url, req);
    return this;
  }

  /** Settlements and reconciliation rows the sim returns (tests fill these). */
  settlements: any[] = [];
  recon: any[] = [];

  private id(prefix: string) {
    return `${prefix}_${(++this.n).toString().padStart(14, '0')}`;
  }

  async handle(url: string, req: HttpRequest): Promise<HttpResponse> {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v1/, '');
    this.calls.push(`${req.method} ${path}`);
    const [user, pass] = Buffer.from((req.headers?.Authorization ?? '').replace('Basic ', ''), 'base64').toString().split(':');
    if (!user || this.keys.get(user) !== pass) return { status: 401, json: { error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } } };
    const body = req.body as any;
    let m: RegExpMatchArray | null;
    if (req.method === 'GET' && path === '/settlements') {
      const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'));
      return { status: 200, json: { entity: 'collection', count: this.settlements.length, items: this.settlements.filter((x) => x.created_at >= from && x.created_at <= to) } };
    }
    if (req.method === 'GET' && path === '/settlements/recon/combined') return { status: 200, json: { entity: 'collection', count: this.recon.length, items: this.recon } };
    if (req.method === 'GET' && path === '/payments') return { status: 200, json: { entity: 'collection', count: 0, items: [] } };
    if (req.method === 'POST' && path === '/orders') {
      const o = { id: this.id('order'), entity: 'order', amount: body.amount, currency: body.currency, receipt: body.receipt, notes: body.notes, status: 'created', key: user };
      this.orders.set(o.id, o);
      return { status: 200, json: o };
    }
    if (req.method === 'GET' && (m = path.match(/^\/orders\/([^/]+)\/payments$/))) {
      return { status: 200, json: { entity: 'collection', items: [...this.payments.values()].filter((p) => p.order_id === m![1]) } };
    }
    if (req.method === 'GET' && (m = path.match(/^\/payments\/([^/]+)$/))) {
      const p = this.payments.get(m[1]);
      return p ? { status: 200, json: p } : { status: 400, json: { error: { description: 'The id provided does not exist' } } };
    }
    if (req.method === 'POST' && (m = path.match(/^\/payments\/([^/]+)\/capture$/))) {
      const p = this.payments.get(m[1]);
      if (!p || p.status !== 'authorized') return { status: 400, json: { error: { description: 'This payment has already been captured' } } };
      p.status = 'captured';
      return { status: 200, json: p };
    }
    if (req.method === 'POST' && (m = path.match(/^\/payments\/([^/]+)\/refund$/))) {
      const p = this.payments.get(m[1]);
      const done = [...this.refunds.values()].filter((r) => r.payment_id === p?.id).reduce((s, r) => s + r.amount, 0);
      if (!p || p.status !== 'captured' || body.amount > p.amount - done) return { status: 400, json: { error: { description: 'The refund amount provided is greater than amount captured' } } };
      const r = { id: this.id('rfnd'), entity: 'refund', amount: body.amount, payment_id: p.id, receipt: body.receipt, status: this.refundMode };
      this.refunds.set(r.id, r);
      return { status: 200, json: r };
    }
    if (req.method === 'GET' && (m = path.match(/^\/refunds\/([^/]+)$/))) {
      const r = this.refunds.get(m[1]);
      return r ? { status: 200, json: r } : { status: 400, json: { error: { description: 'The id provided does not exist' } } };
    }
    return { status: 404, json: { error: { description: `sim: no route ${req.method} ${path}` } } };
  }

  /** A buyer completes Checkout.js. Returns what Checkout.js hands the browser on success. */
  pay(orderId: string, opts: { status?: 'captured' | 'authorized' | 'failed'; amount?: number; method?: string } = {}) {
    const o = this.orders.get(orderId);
    if (!o) throw new Error(`sim: unknown order ${orderId}`);
    const p = {
      id: this.id('pay'), entity: 'payment', order_id: orderId, amount: opts.amount ?? o.amount, currency: o.currency, status: opts.status ?? 'captured',
      method: opts.method ?? 'upi', fee: Math.round((opts.amount ?? o.amount) * 0.0236), error_description: opts.status === 'failed' ? 'Payment declined by bank' : null,
    };
    this.payments.set(p.id, p);
    if (p.status !== 'failed') o.status = 'paid';
    const secret = this.keys.get(o.key)!;
    return { razorpay_order_id: orderId, razorpay_payment_id: p.id, razorpay_signature: createHmac('sha256', secret).update(`${orderId}|${p.id}`).digest('hex') };
  }

  /** A signed webhook delivery as Razorpay would send it. */
  webhook(secret: string, event: string, entity: Record<string, unknown>, eventId = this.id('evt')) {
    const key = event.startsWith('refund.') ? 'refund' : 'payment';
    const body = JSON.stringify({ entity: 'event', event, payload: { [key]: { entity } }, created_at: Math.floor(Date.now() / 1000) });
    return { body, headers: { 'x-razorpay-signature': createHmac('sha256', secret).update(body).digest('hex'), 'x-razorpay-event-id': eventId, 'content-type': 'application/json' } };
  }

  lastOrderId() {
    return [...this.orders.keys()].at(-1)!;
  }
}
