/** Razorpay only for now; the adapter interface stays so other gateways can be added later. */
export type ProviderKey = 'RAZORPAY';

/** Decrypted credentials of one gateway account. */
export interface GatewayCredentials {
  accountId: string;
  provider: ProviderKey;
  mode: 'TEST' | 'LIVE';
  /** Razorpay key id. */
  publicKey: string;
  /** Razorpay key secret. */
  secret: string;
  /** Razorpay webhook secret. */
  webhookSecret?: string | null;
}

export interface CreatePaymentInput {
  orderId: string;
  orderNumber: string;
  amountMinor: number;
  currency: string;
  description: string;
  customer: { id: string; name: string; email: string; phone?: string | null };
  merchantName: string;
}

export interface CreatedPayment {
  providerOrderId: string;
  /** Data the browser needs to open the provider's hosted checkout. Never contains secrets. */
  clientPayload: Record<string, unknown>;
}

export type NormalizedStatus = 'CAPTURED' | 'FAILED' | 'PENDING';

export interface NormalizedPayment {
  providerOrderId: string;
  providerPaymentId?: string | null;
  status: NormalizedStatus;
  amountMinor: number;
  currency: string;
  method?: string | null;
  feeMinor?: number | null;
  failureReason?: string | null;
  raw: unknown;
}

export interface NormalizedWebhook {
  eventId: string;
  type: string;
  kind: 'payment' | 'refund' | 'ignore';
  providerOrderId?: string | null;
  providerRefundId?: string | null;
  refundStatus?: 'PENDING' | 'PROCESSED' | 'FAILED';
  payload: unknown;
}

export interface NormalizedRefund {
  providerRefundId: string;
  status: 'PENDING' | 'PROCESSED' | 'FAILED';
}

export interface PaymentRef {
  providerOrderId: string;
  providerPaymentId?: string | null;
  currency: string;
}

export interface PaymentAdapter {
  readonly key: ProviderKey;
  /** Calls an authenticated, read-only provider endpoint. Throws ProviderError when rejected. */
  verifyCredentials(c: GatewayCredentials): Promise<void>;
  createPayment(c: GatewayCredentials, input: CreatePaymentInput): Promise<CreatedPayment>;
  /** Called after the buyer returns. Client data is only a hint: state is always re-read from the provider. */
  confirm(c: GatewayCredentials, payment: PaymentRef, clientData: Record<string, unknown>): Promise<NormalizedPayment>;
  /** Server-side status lookup (reconciliation, webhooks). */
  fetchPayment(c: GatewayCredentials, payment: PaymentRef): Promise<NormalizedPayment>;
  /** Throws InvalidSignatureError when the signature does not verify. */
  verifyWebhook(c: GatewayCredentials, rawBody: Buffer, headers: Record<string, string | undefined>): Promise<NormalizedWebhook>;
  refund(c: GatewayCredentials, payment: PaymentRef, amountMinor: number, refundId: string, reason?: string | null): Promise<NormalizedRefund>;
  fetchRefund(c: GatewayCredentials, providerRefundId: string): Promise<NormalizedRefund>;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderKey,
    message: string,
    public readonly httpStatus?: number,
    public readonly authFailed = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class InvalidSignatureError extends Error {
  constructor(provider: ProviderKey) {
    super(`${provider} webhook signature is invalid`);
    this.name = 'InvalidSignatureError';
  }
}
