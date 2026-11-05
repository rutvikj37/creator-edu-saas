/** ISO 4217 currencies without minor units (as used by Stripe/Razorpay/PayPal). */
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

export function minorFactor(currency: string) {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100;
}

/** "499.50" INR → 49950. Amounts are stored with at most 2 decimals. */
export function toMinor(amount: string | number | { toString(): string }, currency: string): number {
  return Math.round(Number(amount.toString()) * minorFactor(currency));
}

export function fromMinor(minor: number, currency: string): string {
  const f = minorFactor(currency);
  return f === 1 ? String(minor) : (minor / f).toFixed(2);
}
