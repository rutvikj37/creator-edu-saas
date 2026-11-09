import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@ce/shared';
import { RequirePermissions, RequireRealm } from '../../common/decorators/auth.decorators.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AppConfig } from '../../config/app-config.service.js';
import type { Env } from '../../config/env.schema.js';

type EnvKey = keyof Env;

interface Integration {
  key: string;
  name: string;
  category: 'Email & messaging' | 'Payments' | 'Video & storage' | 'Live classes' | 'Sign-in' | 'AI' | 'Backups';
  description: string;
  configured: boolean;
  /** Required settings that are empty (names only, never values). */
  missing: string[];
  /** Non-secret facts that help confirm the setup, e.g. the SMTP host. */
  details: { label: string; value: string }[];
  /** Where it is configured: server environment, Super Admin settings, or by each academy. */
  configuredIn: 'environment' | 'settings' | 'academy';
  usage?: string;
}

/** Read-only status of every third-party service the platform talks to. Secrets are never returned. */
@ApiTags('Platform · Integrations')
@ApiBearerAuth()
@RequireRealm('PLATFORM')
@Controller({ path: 'platform/integrations', version: '1' })
export class IntegrationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  private env(keys: EnvKey[]) {
    const missing = keys.filter((k) => !this.config.get(k as never));
    return { configured: missing.length === 0, missing };
  }

  private val(key: EnvKey): string {
    const v = this.config.get(key as never) as unknown;
    return v === undefined || v === null || v === '' ? '—' : String(v);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PLATFORM_SYSTEM_READ)
  @ApiOperation({ summary: 'Configuration status of email, payments, video, live, sign-in, AI and backup services' })
  async list(): Promise<{ items: Integration[]; summary: { configured: number; total: number } }> {
    const settings = await this.prisma.platformSetting.findMany({ where: { key: { in: ['payments.razorpayKeyId', 'payments.razorpayKeySecret', 'payments.razorpayWebhookSecret', 'whatsapp.businessNumber', 'email.fromAddress'] } } });
    const setting = (k: string) => {
      const v = settings.find((s) => s.key === k)?.value;
      return typeof v === 'string' ? v : v && typeof v === 'object' ? 'set' : '';
    };
    const [gateways, live] = await Promise.all([
      this.prisma.paymentGatewayAccount.groupBy({ by: ['mode'], where: { isActive: true }, _count: { _all: true } }),
      this.prisma.liveIntegration.groupBy({ by: ['provider'], where: { status: 'CONNECTED' }, _count: { _all: true } }),
    ]);
    const liveCount = (p: string) => live.find((l) => l.provider === p)?._count._all ?? 0;
    const smsProvider = this.config.get('SMS_PROVIDER');
    const sms = smsProvider === 'msg91' ? this.env(['MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID']) : smsProvider === 'twilio' ? this.env(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM']) : { configured: false, missing: ['SMS_PROVIDER'] };
    const rzpKey = setting('payments.razorpayKeyId');
    const rzpMissing = [!rzpKey && 'payments.razorpayKeyId', !setting('payments.razorpayKeySecret') && 'payments.razorpayKeySecret', !setting('payments.razorpayWebhookSecret') && 'payments.razorpayWebhookSecret'].filter(Boolean) as string[];
    const s3 = this.config.get('STORAGE_DRIVER') === 's3';

    const items: Integration[] = [
      {
        key: 'smtp', name: 'Email (SMTP)', category: 'Email & messaging', configuredIn: 'environment', description: 'Sends verification, receipts, reminders and campaigns.',
        ...this.env(['SMTP_HOST', 'SMTP_PORT', 'MAIL_FROM']),
        details: [{ label: 'Host', value: `${this.val('SMTP_HOST')}:${this.val('SMTP_PORT')}` }, { label: 'From', value: this.val('MAIL_FROM') }, { label: 'TLS', value: this.config.get('SMTP_SECURE') ? 'Yes' : 'No' }, { label: 'Authenticated', value: this.config.get('SMTP_USER') ? 'Yes' : 'No' }],
      },
      {
        key: 'whatsapp', name: 'WhatsApp Cloud API', category: 'Email & messaging', configuredIn: 'environment', description: 'Notifications and abandoned-checkout reminders over WhatsApp.',
        ...this.env(['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_TEMPLATE_NAME']),
        details: [{ label: 'Template', value: `${this.val('WHATSAPP_TEMPLATE_NAME')} (${this.val('WHATSAPP_TEMPLATE_LANG')})` }, { label: 'Business number', value: setting('whatsapp.businessNumber') || '—' }],
      },
      {
        key: 'sms', name: 'SMS', category: 'Email & messaging', configuredIn: 'environment', description: 'Phone verification codes and SMS notifications.',
        ...sms, details: [{ label: 'Provider', value: smsProvider ?? '—' }],
      },
      {
        key: 'push', name: 'Web push', category: 'Email & messaging', configuredIn: 'environment', description: 'Browser notifications for students and staff.',
        ...this.env(['WEB_PUSH_VAPID_PUBLIC_KEY', 'WEB_PUSH_VAPID_PRIVATE_KEY']), details: [{ label: 'Subject', value: this.val('WEB_PUSH_SUBJECT') }],
      },
      {
        key: 'razorpay-platform', name: 'Razorpay (plan billing)', category: 'Payments', configuredIn: 'settings', description: 'Collects subscription fees from academies.',
        configured: rzpMissing.length === 0, missing: rzpMissing,
        details: [{ label: 'Mode', value: rzpKey.startsWith('rzp_live_') ? 'Live' : rzpKey ? 'Test' : '—' }, { label: 'Key id', value: rzpKey || '—' }],
      },
      {
        key: 'razorpay-academies', name: 'Razorpay (academy sales)', category: 'Payments', configuredIn: 'academy', description: 'Each academy connects its own Razorpay account to sell courses.',
        configured: gateways.length > 0, missing: [],
        details: [{ label: 'Live accounts', value: String(gateways.find((g) => g.mode === 'LIVE')?._count._all ?? 0) }, { label: 'Test accounts', value: String(gateways.find((g) => g.mode === 'TEST')?._count._all ?? 0) }],
        usage: `${gateways.reduce((n, g) => n + g._count._all, 0)} academies connected`,
      },
      {
        key: 'bunny', name: 'Bunny Stream', category: 'Video & storage', configuredIn: 'environment', description: 'Video upload, encoding and secure playback.',
        ...this.env(['BUNNY_STREAM_API_KEY', 'BUNNY_STREAM_LIBRARY_ID', 'BUNNY_STREAM_CDN_HOSTNAME']),
        details: [{ label: 'Library', value: this.val('BUNNY_STREAM_LIBRARY_ID') }, { label: 'CDN host', value: this.val('BUNNY_STREAM_CDN_HOSTNAME') }, { label: 'Signed URLs', value: this.config.get('BUNNY_STREAM_TOKEN_AUTH_KEY') ? 'On' : 'Off' }, { label: 'Webhook secret', value: this.config.get('BUNNY_STREAM_WEBHOOK_SECRET') ? 'Set' : 'Not set' }],
      },
      {
        key: 'storage', name: 'File storage', category: 'Video & storage', configuredIn: 'environment', description: 'Uploaded files, images, certificates and invoices.',
        configured: s3 ? Boolean(this.config.get('AWS_REGION')) : true, missing: s3 && !this.config.get('AWS_REGION') ? ['AWS_REGION'] : [],
        details: s3
          ? [{ label: 'Driver', value: 'S3' }, { label: 'Region', value: this.val('AWS_REGION') }, { label: 'Endpoint', value: this.val('S3_ENDPOINT') }, { label: 'Buckets', value: `${this.val('S3_PRIVATE_BUCKET')}, ${this.val('S3_PUBLIC_BUCKET')}` }]
          : [{ label: 'Driver', value: 'Local disk (development only)' }],
      },
      {
        key: 'livekit', name: 'LiveKit', category: 'Live classes', configuredIn: 'environment', description: 'Built-in live classroom.',
        ...this.env(['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']), details: [{ label: 'Server', value: this.val('LIVEKIT_URL') }],
      },
      {
        key: 'zoom', name: 'Zoom', category: 'Live classes', configuredIn: 'environment', description: 'Academies connect their Zoom account to schedule meetings.',
        ...this.env(['ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET']), details: [{ label: 'Webhook token', value: this.config.get('ZOOM_WEBHOOK_SECRET_TOKEN') ? 'Set' : 'Not set' }],
        usage: `${liveCount('ZOOM')} academies connected`,
      },
      {
        key: 'google-meet', name: 'Google Meet', category: 'Live classes', configuredIn: 'environment', description: 'Academies connect Google Calendar to create Meet links.',
        ...this.env(['GOOGLE_MEET_CLIENT_ID', 'GOOGLE_MEET_CLIENT_SECRET']), details: [], usage: `${liveCount('GOOGLE_MEET')} academies connected`,
      },
      {
        key: 'plugnmeet', name: 'plugNmeet', category: 'Live classes', configuredIn: 'environment', description: 'Self-hosted live classroom alternative.',
        ...this.env(['PLUGNMEET_URL', 'PLUGNMEET_API_KEY', 'PLUGNMEET_API_SECRET']), details: [{ label: 'Server', value: this.val('PLUGNMEET_URL') }],
      },
      {
        key: 'google-oauth', name: 'Sign in with Google', category: 'Sign-in', configuredIn: 'environment', description: 'One-click sign-in for students and creators.',
        ...this.env(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']), details: [],
      },
      {
        key: 'anthropic', name: 'Anthropic (AI assistant)', category: 'AI', configuredIn: 'environment', description: 'AI course outlines, quiz generation and writing help.',
        ...this.env(['ANTHROPIC_API_KEY']), details: [{ label: 'Model', value: this.val('ANTHROPIC_MODEL') }],
      },
      {
        key: 'google-drive', name: 'Google Drive backups', category: 'Backups', configuredIn: 'environment', description: 'Academies back up videos and documents to their own Drive.',
        ...this.env(['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REDIRECT_URI', 'BACKUP_ENCRYPTION_KEY']), details: [{ label: 'Root folder', value: this.val('GOOGLE_DRIVE_ROOT_FOLDER') }],
      },
    ];
    return { items, summary: { configured: items.filter((i) => i.configured).length, total: items.length } };
  }
}
