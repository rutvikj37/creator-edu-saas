const SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loading = null;

/** Loads Razorpay Checkout.js once. Rejects if it cannot be fetched (offline, blocked by an extension). */
export function loadRazorpay() {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve(window.Razorpay);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay checkout did not load')));
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error('Could not load Razorpay checkout. Check your connection or disable blockers and try again.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Opens Razorpay Checkout for server-created options. Resolves with the success payload
 * ({ razorpay_order_id, razorpay_payment_id, razorpay_signature }), { dismissed: true } or
 * { failed: reason }. The payload is only a hint — the server re-verifies it with Razorpay.
 */
export async function openRazorpay(options, { color } = {}) {
  const Razorpay = await loadRazorpay();
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const rzp = new Razorpay({
      key: options.keyId,
      order_id: options.orderId,
      amount: options.amount,
      currency: options.currency,
      name: options.name,
      description: options.description,
      prefill: options.prefill,
      theme: color ? { color } : undefined,
      handler: (resp) => done(resp),
      modal: { ondismiss: () => done({ dismissed: true }) },
    });
    rzp.on('payment.failed', (resp) => done({ failed: resp?.error?.description || 'Payment failed' }));
    rzp.open();
  });
}
