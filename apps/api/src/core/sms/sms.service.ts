import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service.js';
import { AppException } from '../../common/errors/app-exception.js';

export interface SmsAdapter {
  readonly name: string;
  isConfigured(): boolean;
  send(to: string, body: string, meta?: { otp?: string }): Promise<void>;
}

/** Twilio Programmable Messaging (REST). */
class TwilioAdapter implements SmsAdapter {
  readonly name = 'Twilio';
  constructor(private readonly config: AppConfig) {}
  isConfigured() {
    return Boolean(this.config.get('TWILIO_ACCOUNT_SID') && this.config.get('TWILIO_AUTH_TOKEN') && this.config.get('TWILIO_FROM'));
  }
  async send(to: string, body: string) {
    const sid = this.config.get('TWILIO_ACCOUNT_SID')!;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${this.config.get('TWILIO_AUTH_TOKEN')}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: this.config.get('TWILIO_FROM')!, Body: body }),
    });
    if (!res.ok) throw new Error(`Twilio error ${res.status}`);
  }
}

/** MSG91 OTP API (India; requires a DLT-approved template). */
class Msg91Adapter implements SmsAdapter {
  readonly name = 'MSG91';
  constructor(private readonly config: AppConfig) {}
  isConfigured() {
    return Boolean(this.config.get('MSG91_AUTH_KEY') && this.config.get('MSG91_TEMPLATE_ID'));
  }
  async send(to: string, _body: string, meta?: { otp?: string }) {
    const url = new URL('https://control.msg91.com/api/v5/otp');
    url.searchParams.set('template_id', this.config.get('MSG91_TEMPLATE_ID')!);
    url.searchParams.set('mobile', to.replace(/^\+/, ''));
    if (meta?.otp) url.searchParams.set('otp', meta.otp);
    const res = await fetch(url, { method: 'POST', headers: { authkey: this.config.get('MSG91_AUTH_KEY')! } });
    if (!res.ok) throw new Error(`MSG91 error ${res.status}`);
  }
}

/** SMS delivery through the configured provider. Never simulates success when unconfigured. */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly adapter?: SmsAdapter;

  constructor(config: AppConfig) {
    const provider = config.get('SMS_PROVIDER');
    this.adapter = provider === 'twilio' ? new TwilioAdapter(config) : provider === 'msg91' ? new Msg91Adapter(config) : undefined;
  }

  isConfigured(): boolean {
    return Boolean(this.adapter?.isConfigured());
  }

  async send(to: string, body: string, meta?: { otp?: string }): Promise<void> {
    if (!this.adapter || !this.adapter.isConfigured()) throw AppException.integrationNotConfigured('SMS delivery');
    await this.adapter.send(to, body, meta);
    this.logger.log({ provider: this.adapter.name }, 'sms sent');
  }
}
