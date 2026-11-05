import { describe, expect, it } from 'vitest';
import type { HttpRequest, HttpResponse } from './http.js';
import { PaymentHttp } from './http.js';
import { fromMinor, toMinor } from './money.js';
import { RazorpayAdapter, razorpayCheckoutSignature, razorpayWebhookSignature } from './razorpay.adapter.js';
import { InvalidSignatureError, ProviderError, type GatewayCredentials } from './types.js';

const creds: GatewayCredentials = { accountId: 'acc1', provider: 'RAZORPAY', mode: 'TEST', publicKey: 'rzp_test_abc', secret: 'key_secret_123', webhookSecret: 'whsec_456' };

function stubHttp(routes: Record<string, HttpResponse>) {
  const http = new PaymentHttp();
  const calls: { url: string; req: HttpRequest }[] = [];
  http.request = async (url, req) => {
    calls.push({ url, req });
    const r = routes[`${req.method} ${url.replace('https://api.razorpay.com/v1', '')}`];
    if (!r) throw new Error(`unexpected ${req.method} ${url}`);
    return r;
  };
  return { http, calls };
}

describe('money', () => {
  it('converts to and from minor units', () => {
    expect(toMinor('499.50', 'INR')).toBe(49950);
    expect(toMinor('0.29', 'INR')).toBe(29);
    expect(toMinor('1000', 'JPY')).toBe(1000);
    expect(fromMinor(49950, 'INR')).toBe('499.50');
  });
});

describe('RazorpayAdapter', () => {
  it('creates an order with basic auth and returns a secret-free checkout payload', async () => {
    const { http, calls } = stubHttp({ 'POST /orders': { status: 200, json: { id: 'order_Abc', amount: 49900, currency: 'INR', status: 'created' } } });
    const out = await new RazorpayAdapter(http).createPayment(creds, {
      orderId: 'o1', orderNumber: 'ORD-1', amountMinor: 49900, currency: 'INR', description: 'Course', merchantName: 'Academy',
      customer: { id: 'u1', name: 'Priya', email: 'p@example.test', phone: '+919999999999' },
    });
    expect(out.providerOrderId).toBe('order_Abc');
    expect(calls[0].req.headers?.Authorization).toBe(`Basic ${Buffer.from('rzp_test_abc:key_secret_123').toString('base64')}`);
    expect(calls[0].req.body).toEqual({ amount: 49900, currency: 'INR', receipt: 'ORD-1', notes: { orderId: 'o1' } });
    expect(out.clientPayload).toMatchObject({ keyId: 'rzp_test_abc', orderId: 'order_Abc', amount: 49900 });
    expect(JSON.stringify(out.clientPayload)).not.toContain('key_secret_123');
  });

  it('confirms only with a valid checkout signature and re-reads the payment', async () => {
    const { http } = stubHttp({
      'GET /payments/pay_1': { status: 200, json: { id: 'pay_1', order_id: 'order_Abc', status: 'captured', amount: 49900, currency: 'INR', method: 'upi', fee: 1178 } },
    });
    const a = new RazorpayAdapter(http);
    const ref = { providerOrderId: 'order_Abc', currency: 'INR' };
    const signature = razorpayCheckoutSignature('order_Abc', 'pay_1', creds.secret);
    const p = await a.confirm(creds, ref, { razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_Abc', razorpay_signature: signature });
    expect(p).toMatchObject({ status: 'CAPTURED', providerPaymentId: 'pay_1', amountMinor: 49900, method: 'upi', feeMinor: 1178 });
    await expect(a.confirm(creds, ref, { razorpay_payment_id: 'pay_1', razorpay_signature: 'f'.repeat(64) })).rejects.toBeInstanceOf(ProviderError);
  });

  it('rejects a payment that belongs to another order', async () => {
    const { http } = stubHttp({ 'GET /payments/pay_2': { status: 200, json: { id: 'pay_2', order_id: 'order_Other', status: 'captured', amount: 100, currency: 'INR' } } });
    const sig = razorpayCheckoutSignature('order_Abc', 'pay_2', creds.secret);
    await expect(new RazorpayAdapter(http).confirm(creds, { providerOrderId: 'order_Abc', currency: 'INR' }, { razorpay_payment_id: 'pay_2', razorpay_signature: sig }))
      .rejects.toThrow('different order');
  });

  it('captures authorized payments during reconciliation', async () => {
    const { http, calls } = stubHttp({
      'GET /orders/order_Abc/payments': { status: 200, json: { items: [{ id: 'pay_3', status: 'failed' }, { id: 'pay_4', status: 'authorized', amount: 49900, currency: 'INR' }] } },
      'POST /payments/pay_4/capture': { status: 200, json: { id: 'pay_4', status: 'captured', amount: 49900, currency: 'INR', order_id: 'order_Abc' } },
    });
    const p = await new RazorpayAdapter(http).fetchPayment(creds, { providerOrderId: 'order_Abc', currency: 'INR' });
    expect(p.status).toBe('CAPTURED');
    expect(calls.at(-1)?.req.body).toEqual({ amount: 49900, currency: 'INR' });
  });

  it('reports pending when no payment attempt exists yet', async () => {
    const { http } = stubHttp({ 'GET /orders/order_Abc/payments': { status: 200, json: { items: [] } } });
    expect((await new RazorpayAdapter(http).fetchPayment(creds, { providerOrderId: 'order_Abc', currency: 'INR' })).status).toBe('PENDING');
  });

  it('flags rejected keys as an auth failure', async () => {
    const { http } = stubHttp({ 'GET /payments?count=1': { status: 401, json: { error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } } } });
    const err = await new RazorpayAdapter(http).verifyCredentials(creds).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ authFailed: true, message: 'Authentication failed' });
  });

  it('verifies webhook signatures over the raw body', async () => {
    const a = new RazorpayAdapter(new PaymentHttp());
    const body = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_Abc', status: 'captured' } } } }));
    const ok = await a.verifyWebhook(creds, body, { 'x-razorpay-signature': razorpayWebhookSignature(body, 'whsec_456'), 'x-razorpay-event-id': 'evt_1' });
    expect(ok).toMatchObject({ eventId: 'evt_1', kind: 'payment', providerOrderId: 'order_Abc' });
    await expect(a.verifyWebhook(creds, body, { 'x-razorpay-signature': razorpayWebhookSignature(body, 'wrong') })).rejects.toBeInstanceOf(InvalidSignatureError);
    const tampered = Buffer.from(body.toString().replace('captured', 'failed'));
    await expect(a.verifyWebhook(creds, tampered, { 'x-razorpay-signature': razorpayWebhookSignature(body, 'whsec_456') })).rejects.toBeInstanceOf(InvalidSignatureError);
    await expect(a.verifyWebhook({ ...creds, webhookSecret: null }, body, { 'x-razorpay-signature': 'x' })).rejects.toBeInstanceOf(InvalidSignatureError);
  });

  it('maps refund webhooks and refund responses', async () => {
    const a = new RazorpayAdapter(stubHttp({ 'POST /payments/pay_1/refund': { status: 200, json: { id: 'rfnd_1', status: 'processed', amount: 10000 } } }).http);
    const body = Buffer.from(JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', status: 'processed' } } } }));
    const w = await a.verifyWebhook(creds, body, { 'x-razorpay-signature': razorpayWebhookSignature(body, 'whsec_456') });
    expect(w).toMatchObject({ kind: 'refund', providerRefundId: 'rfnd_1', refundStatus: 'PROCESSED' });
    expect(w.eventId).toMatch(/^[a-f0-9]{64}$/);
    expect(await a.refund(creds, { providerOrderId: 'order_Abc', providerPaymentId: 'pay_1', currency: 'INR' }, 10000, 'r1')).toEqual({ providerRefundId: 'rfnd_1', status: 'PROCESSED' });
  });
});
