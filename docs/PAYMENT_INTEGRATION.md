# Payment Integration

Status: **Phase 0 design** — implemented in Phase 7. Nothing is live until real credentials are configured and webhook tests pass.

## Adapter interface
```ts
interface PaymentProvider {
  key: 'RAZORPAY' | 'CASHFREE' | 'STRIPE' | 'PAYPAL';
  status(): 'not_configured' | 'configured' | 'verified';
  createPayment(order, ctx): Promise<{ providerOrderId; clientPayload }>; // data the SPA needs to open hosted checkout
  fetchPayment(providerPaymentId): Promise<NormalizedPayment>;          // server-side verification
  verifyWebhook(rawBody, headers): NormalizedWebhookEvent;              // throws on bad signature
  refund(payment, amount, reason): Promise<NormalizedRefund>;
  createSubscription?(plan, customer): Promise<…>;                       // SaaS plans + memberships
  cancelSubscription?(id): Promise<void>;
}
```

| Provider | Methods | Checkout | Webhooks used | Recurring |
|---|---|---|---|---|
| Razorpay | UPI, cards, netbanking, wallets | Checkout.js (Orders API) | `payment.captured`, `payment.failed`, `refund.processed`, `subscription.*` | Razorpay Subscriptions |
| Cashfree | UPI, cards, netbanking | Cashfree JS SDK (PG Orders) | `PAYMENT_SUCCESS_WEBHOOK`, `PAYMENT_FAILED_WEBHOOK`, `REFUND_STATUS_WEBHOOK` | Cashfree Subscriptions |
| Stripe | cards, wallets, intl | Checkout Session / Payment Element | `checkout.session.completed`, `payment_intent.*`, `charge.refunded`, `invoice.*`, `customer.subscription.*` | Stripe Billing |
| PayPal | PayPal, cards | JS SDK Orders v2 | `PAYMENT.CAPTURE.COMPLETED/DENIED/REFUNDED`, `BILLING.SUBSCRIPTION.*` | PayPal Subscriptions |

## Merchant models
- **Creator-owned**: tenant stores its own gateway keys (`PaymentGatewayAccount.tenantId = X`). Funds settle directly to creator; platform commission billed to creator (invoice / deducted from subscription wallet).
- **Platform-managed**: platform merchant account collects; ledger tracks `CREATOR_PAYABLE`; payouts run manually/approved by Finance Admin. Split settlement (Razorpay Route, Cashfree Easy Split, Stripe Connect) adapters are built **behind a flag** and require provider approval — not assumed available.

## Order flow
1. `POST /learn/checkout` → validate cart, price snapshot, coupon, tax → create `Order(PENDING)` + idempotency key (transaction).
2. `POST /learn/orders/:id/pay` → adapter `createPayment` → `PAYMENT_INITIATED` → client opens hosted checkout.
3. Browser callback only triggers `GET /learn/orders/:id` polling; the UI shows "Confirming payment…".
4. Webhook → signature verified → `WebhookEvent` stored (unique) → `webhooks-in` job → `fetchPayment` cross-check amount/currency/order → **single DB transaction**: payment `CAPTURED`, order `PAID`, enrollments/memberships/tickets granted, coupon redeemed, ledger entries (gross, gateway fee, tax, platform commission, creator payable, affiliate payable), affiliate conversion → enqueue invoice PDF + notifications.
5. Reconciliation job: orders stuck in `PAYMENT_INITIATED` > 30 min are re-fetched from provider; settlements imported daily.

## Refunds
Creator/finance approves → adapter `refund` → provider webhook confirms → ledger reversal, commission reversal, enrollment policy applied.

## Testing
- Unit tests with recorded provider payload fixtures and real signature computation using test secrets.
- Integration tests against provider **test modes** when `*_TEST_*` keys are present (skipped with an explicit "not configured" notice otherwise).
- Required scenarios: success, failure, duplicate webhook, out-of-order webhook, amount mismatch, partial/full refund, subscription renewal failure → grace → expiry.

## Credentials (see `.env.example`)
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PUBLISHABLE_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV`. Tenant-owned keys are entered in the creator Integrations screen and stored encrypted.
