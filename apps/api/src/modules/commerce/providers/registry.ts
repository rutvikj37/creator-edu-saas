import { Injectable } from '@nestjs/common';
import { RazorpayAdapter } from './razorpay.adapter.js';
import type { PaymentAdapter, ProviderKey } from './types.js';

@Injectable()
export class PaymentProviders {
  private readonly map: Record<ProviderKey, PaymentAdapter>;
  constructor(razorpay: RazorpayAdapter) {
    this.map = { RAZORPAY: razorpay };
  }
  get(key: ProviderKey): PaymentAdapter {
    return this.map[key];
  }
}

export const PROVIDER_CLASSES = [RazorpayAdapter, PaymentProviders];
