import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { AppException } from '../../common/errors/app-exception.js';
import { MailService } from '../../core/mail/mail.service.js';
import { emailTemplates } from '../../core/mail/templates.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { QUEUES } from '../../core/queue/queue.constants.js';
import { ChannelsService } from './channels.js';

export const CATEGORIES = ['learning', 'live', 'orders', 'community', 'marketing'] as const;
export type Category = (typeof CATEGORIES)[number];
export const MESSAGING_JOBS = { SMS: 'sms', WHATSAPP: 'whatsapp', PUSH: 'push' } as const;

/** Defaults when a user has not chosen: email + push on; paid channels (SMS/WhatsApp) off; marketing email only with consent. */
const DEFAULTS: Record<Category, { email: boolean; sms: boolean; whatsapp: boolean; push: boolean }> = {
  learning: { email: true, sms: false, whatsapp: false, push: true },
  live: { email: true, sms: false, whatsapp: false, push: true },
  orders: { email: true, sms: false, whatsapp: false, push: true },
  community: { email: false, sms: false, whatsapp: false, push: true },
  marketing: { email: false, sms: false, whatsapp: false, push: false },
};

export interface NotifyInput {
  userId: string;
  tenantId?: string | null;
  category: Category;
  title: string;
  body: string;
  link?: string | null;
  /** Brand shown in the email header (academy or platform name). */
  brand: string;
  /** Absolute URL for email/push buttons (in-app uses `link`). */
  url?: string | null;
  /** The caller already sent a transactional email (receipts, refunds). */
  skipEmail?: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly channels: ChannelsService,
    @InjectQueue(QUEUES.MESSAGING) private readonly queue: Queue,
  ) {}

  async preferences(userId: string) {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true, phoneVerifiedAt: true } });
    return {
      categories: CATEGORIES.map((c) => {
        const r = rows.find((x) => x.category === c);
        return { category: c, ...(r ? { email: r.email, sms: r.sms, whatsapp: r.whatsapp, push: r.push } : DEFAULTS[c]) };
      }),
      channels: { email: true, ...this.channels.status() },
      phone: user?.phone ?? null,
      phoneVerified: Boolean(user?.phoneVerifiedAt),
      pushKey: this.channels.pushPublicKey(),
    };
  }

  async setPreferences(userId: string, items: { category: string; email?: boolean; sms?: boolean; whatsapp?: boolean; push?: boolean }[]) {
    for (const it of items) {
      if (!(CATEGORIES as readonly string[]).includes(it.category)) throw AppException.validation([{ field: 'category', message: `Unknown category ${it.category}` }]);
      const base = DEFAULTS[it.category as Category];
      const data = { email: it.email ?? base.email, sms: it.sms ?? base.sms, whatsapp: it.whatsapp ?? base.whatsapp, push: it.push ?? base.push };
      await this.prisma.notificationPreference.upsert({ where: { userId_category: { userId, category: it.category } }, update: data, create: { userId, category: it.category, ...data } });
    }
    return this.preferences(userId);
  }

  private async prefFor(userId: string, category: Category) {
    const r = await this.prisma.notificationPreference.findUnique({ where: { userId_category: { userId, category } } });
    return r ?? DEFAULTS[category];
  }

  /** Stores the in-app notification and fans out to the channels the user enabled. Never throws for channel problems. */
  async notify(n: NotifyInput) {
    const row = await this.prisma.notification.create({ data: { userId: n.userId, tenantId: n.tenantId ?? null, category: n.category, title: n.title.slice(0, 160), body: n.body.slice(0, 500), link: n.link ?? null } });
    try {
      const pref = await this.prefFor(n.userId, n.category);
      const user = await this.prisma.user.findUnique({ where: { id: n.userId }, select: { email: true, fullName: true, phone: true, phoneVerifiedAt: true, status: true } });
      if (!user || user.status !== 'ACTIVE') return row;
      if (pref.email && n.category !== 'marketing' && !n.skipEmail) {
        await this.mail.send({ to: user.email, tenantId: n.tenantId ?? null, tag: `notify-${n.category}`, ...emailTemplates.billingNotice({ brand: n.brand, subject: n.title, heading: n.title, lines: [`Hi ${user.fullName},`, n.body], cta: n.url ? { label: 'Open', url: n.url } : undefined }) });
      }
      const verifiedPhone = user.phone && user.phoneVerifiedAt ? user.phone : null;
      if (pref.sms && verifiedPhone && this.channels.status().sms) await this.queue.add(MESSAGING_JOBS.SMS, { to: verifiedPhone, text: `${n.brand}: ${n.title} — ${n.body}` });
      if (pref.whatsapp && verifiedPhone && this.channels.status().whatsapp) await this.queue.add(MESSAGING_JOBS.WHATSAPP, { to: verifiedPhone, title: n.title, body: n.body });
      if (pref.push && this.channels.status().push) await this.queue.add(MESSAGING_JOBS.PUSH, { userId: n.userId, title: n.title, body: n.body, link: n.url ?? n.link ?? null });
    } catch (e) {
      this.logger.error({ err: (e as Error).message, notificationId: row.id }, 'notification fan-out failed');
    }
    return row;
  }

  async list(userId: string, cursor?: string, take = 20) {
    const rows = await this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const unread = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { items: rows.slice(0, take), nextCursor: rows.length > take ? rows[take - 1].id : null, unread };
  }

  async markRead(userId: string, id: string) {
    const r = await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    if (!r.count && !(await this.prisma.notification.findFirst({ where: { id, userId } }))) throw AppException.notFound('Notification not found');
    return { read: true };
  }

  async markAllRead(userId: string) {
    const r = await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { read: r.count };
  }

  async subscribePush(userId: string, sub: { endpoint: string; p256dh: string; auth: string }, userAgent?: string) {
    if (!this.channels.pushConfigured()) throw AppException.integrationNotConfigured('Web push');
    if (!/^https:\/\//.test(sub.endpoint)) throw AppException.validation([{ field: 'endpoint', message: 'Invalid push endpoint' }]);
    const endpointHash = createHash('sha256').update(sub.endpoint).digest('hex');
    await this.prisma.pushSubscription.upsert({
      where: { endpointHash },
      update: { userId, p256dh: sub.p256dh, auth: sub.auth, userAgent: userAgent?.slice(0, 300) ?? null },
      create: { userId, endpoint: sub.endpoint, endpointHash, p256dh: sub.p256dh, auth: sub.auth, userAgent: userAgent?.slice(0, 300) ?? null },
    });
    return { subscribed: true };
  }

  async unsubscribePush(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpointHash: createHash('sha256').update(endpoint).digest('hex') } });
    return { subscribed: false };
  }
}
