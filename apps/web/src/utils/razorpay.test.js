import { vi } from 'vitest';

afterEach(() => {
  delete window.Razorpay;
  document.head.querySelectorAll('script[src*="razorpay"]').forEach((s) => s.remove());
  vi.resetModules();
});

function fakeRazorpay(behaviour) {
  const instances = [];
  window.Razorpay = function Razorpay(opts) {
    const handlers = {};
    const self = { opts, on: (ev, fn) => { handlers[ev] = fn; }, open: () => behaviour(opts, handlers) };
    instances.push(self);
    return self;
  };
  return instances;
}

describe('openRazorpay', () => {
  it('passes server options to Checkout.js and resolves with the success payload', async () => {
    const instances = fakeRazorpay((opts) => opts.handler({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 's' }));
    const { openRazorpay } = await import('./razorpay.js');
    const out = await openRazorpay({ keyId: 'rzp_test_x', orderId: 'order_1', amount: 49900, currency: 'INR', name: 'Acme', prefill: { email: 'a@b.c' } }, { color: '#0f766e' });
    expect(out).toEqual({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 's' });
    expect(instances[0].opts).toMatchObject({ key: 'rzp_test_x', order_id: 'order_1', amount: 49900, currency: 'INR', theme: { color: '#0f766e' }, prefill: { email: 'a@b.c' } });
  });

  it('reports dismissal and failure', async () => {
    fakeRazorpay((opts) => opts.modal.ondismiss());
    const { openRazorpay } = await import('./razorpay.js');
    expect(await openRazorpay({ keyId: 'k', orderId: 'o' })).toEqual({ dismissed: true });
    fakeRazorpay((_opts, handlers) => handlers['payment.failed']({ error: { description: 'Card declined' } }));
    expect(await openRazorpay({ keyId: 'k', orderId: 'o' })).toEqual({ failed: 'Card declined' });
  });

  it('loads Checkout.js once and surfaces load failures', async () => {
    const { loadRazorpay } = await import('./razorpay.js');
    const p = loadRazorpay();
    const script = document.head.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    expect(script).not.toBeNull();
    script.onerror();
    await expect(p).rejects.toThrow(/Could not load Razorpay checkout/);
    expect(document.head.querySelector('script[src*="razorpay"]')).toBeNull();
  });
});
