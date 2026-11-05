import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { AppConfig } from '../../config/app-config.service.js';
import { SmsService } from '../../core/sms/sms.service.js';

export class ChannelUnavailable extends Error {}
/** The push endpoint is gone (unsubscribed/expired); the subscription should be deleted. */
export class PushGone extends Error {}

/**
 * Delivery channels beyond email. Each reports whether it is configured and never pretends to
 * deliver when it is not.
 */
@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);
  constructor(
    private readonly config: AppConfig,
    private readonly sms: SmsService,
  ) {
    const pub = config.get('WEB_PUSH_VAPID_PUBLIC_KEY');
    const priv = config.get('WEB_PUSH_VAPID_PRIVATE_KEY');
    if (pub && priv) webpush.setVapidDetails(config.get('WEB_PUSH_SUBJECT') || `mailto:support@${config.get('PLATFORM_ROOT_DOMAIN')}`, pub, priv);
  }

  status() {
    return { sms: this.sms.isConfigured(), whatsapp: this.whatsappConfigured(), push: this.pushConfigured() };
  }

  async sendSms(to: string, text: string) {
    if (!this.sms.isConfigured()) throw new ChannelUnavailable('SMS is not configured');
    await this.sms.send(to, text.slice(0, 320));
  }

  whatsappConfigured() {
    return Boolean(this.config.get('WHATSAPP_PHONE_NUMBER_ID') && this.config.get('WHATSAPP_ACCESS_TOKEN') && this.config.get('WHATSAPP_TEMPLATE_NAME'));
  }

  /** Meta WhatsApp Cloud API: an approved template with two body parameters (title, body). */
  async sendWhatsapp(to: string, title: string, body: string) {
    if (!this.whatsappConfigured()) throw new ChannelUnavailable('WhatsApp is not configured');
    const res = await fetch(`https://graph.facebook.com/v21.0/${this.config.get('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.get('WHATSAPP_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'template',
        template: { name: this.config.get('WHATSAPP_TEMPLATE_NAME'), language: { code: this.config.get('WHATSAPP_TEMPLATE_LANG') }, components: [{ type: 'body', parameters: [{ type: 'text', text: title.slice(0, 60) }, { type: 'text', text: body.slice(0, 900) }] }] },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`WhatsApp error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  pushConfigured() {
    return Boolean(this.config.get('WEB_PUSH_VAPID_PUBLIC_KEY') && this.config.get('WEB_PUSH_VAPID_PRIVATE_KEY'));
  }

  pushPublicKey() {
    return this.config.get('WEB_PUSH_VAPID_PUBLIC_KEY') ?? null;
  }

  async sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: { title: string; body: string; link?: string | null }) {
    if (!this.pushConfigured()) throw new ChannelUnavailable('Web push is not configured');
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 3600 });
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) throw new PushGone('subscription expired');
      throw e;
    }
  }
}
