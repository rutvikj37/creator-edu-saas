import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { emailTemplates } from '../../core/mail/templates.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { QUEUES } from '../../core/queue/queue.constants.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { academyOrigin } from '../tenants/academy-origin.js';
import { isEnrollmentUsable } from '../learning/access.js';
import { MESSAGING_JOBS } from '../notifications/notifications.service.js';
import { fmtMoney, RECOVERY_DONE } from './orders.service.js';
import { toMinor } from './providers/money.js';

export const RECOVERY_KEY = 'sales.recovery';
const DAY = 86_400_000;
/** Reminders stop once a checkout is this old. */
const MAX_AGE_MS = 7 * DAY;
const UNPAID = ['PENDING', 'PAYMENT_INITIATED', 'FAILED', 'EXPIRED'] as const;

export interface RecoverySettings {
  enabled: boolean;
  /** Minutes after the checkout started at which each reminder goes out (up to 3). */
  steps: number[];
  /** Promo code offered in the reminders (optional). */
  couponCode: string | null;
  /** Also remind over WhatsApp when the platform has WhatsApp set up and the buyer gave a phone number. */
  whatsapp: boolean;
}

export const RECOVERY_DEFAULTS: RecoverySettings = { enabled: false, steps: [60, 1440], couponCode: null, whatsapp: false };

export function parseRecovery(value: unknown): RecoverySettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<RecoverySettings>;
  const steps = Array.isArray(v.steps) ? v.steps.filter((n) => Number.isInteger(n) && n >= 15 && n <= MAX_AGE_MS / 60_000).slice(0, 3) : RECOVERY_DEFAULTS.steps;
  return { enabled: v.enabled === true, steps: steps.length ? [...steps].sort((a, b) => a - b) : RECOVERY_DEFAULTS.steps, couponCode: typeof v.couponCode === 'string' && v.couponCode ? v.couponCode : null, whatsapp: v.whatsapp === true };
}

type OrderWithItems = Awaited<ReturnType<RecoveryService['candidates']>>[number];

/**
 * Abandoned-checkout recovery: reminds buyers who started checkout but didn't pay, by email and
 * optionally WhatsApp, on the academy's schedule. Runs in the worker with the commerce reconciliation.
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly mail: MailService,
    private readonly config: AppConfig,
    @InjectQueue(QUEUES.MESSAGING) private readonly messaging: Queue,
  ) {}

  whatsappAvailable() {
    return Boolean(this.config.get('WHATSAPP_PHONE_NUMBER_ID') && this.config.get('WHATSAPP_ACCESS_TOKEN') && this.config.get('WHATSAPP_TEMPLATE_NAME'));
  }

  // ── academy settings ──────────────────────────────────────
  async settings() {
    const row = await this.db.tenantSetting.findFirst({ where: { key: RECOVERY_KEY } });
    return { ...parseRecovery(row?.value), whatsappAvailable: this.whatsappAvailable() };
  }

  async saveSettings(input: RecoverySettings) {
    const tenantId = this.ctx.requireTenantId();
    const s = parseRecovery(input);
    if (input.steps?.length && s.steps.length !== input.steps.length) throw AppException.validation([{ field: 'steps', message: 'Each reminder must be between 15 minutes and 7 days after checkout' }]);
    if (s.couponCode) {
      const c = await this.db.coupon.findFirst({ where: { code: s.couponCode.toUpperCase() } });
      if (!c) throw AppException.validation([{ field: 'couponCode', message: 'No promo code with this code' }]);
      s.couponCode = c.code;
    }
    await this.prisma.tenantSetting.upsert({ where: { tenantId_key: { tenantId, key: RECOVERY_KEY } }, create: { tenantId, key: RECOVERY_KEY, value: s as never }, update: { value: s as never } });
    return this.settings();
  }

  /** Reminders sent and checkouts won back over the last `days` days. */
  async stats(days = 30) {
    const since = new Date(Date.now() - days * DAY);
    const [reminded, recovered] = await Promise.all([
      this.db.order.count({ where: { recoveryLastAt: { gte: since } } }),
      this.db.order.findMany({ where: { recoveredAt: { gte: since } }, select: { recoveredByOrderId: true } }),
    ]);
    const winners = [...new Set(recovered.map((r) => r.recoveredByOrderId).filter((x): x is string => Boolean(x)))];
    const paid = winners.length ? await this.db.order.findMany({ where: { id: { in: winners } }, select: { totalAmount: true, currency: true } }) : [];
    const revenue: Record<string, number> = {};
    for (const o of paid) revenue[o.currency] = (revenue[o.currency] ?? 0) + Number(o.totalAmount);
    const abandoned = await this.db.order.count({ where: { createdAt: { gte: since }, status: { in: [...UNPAID] }, totalAmount: { gt: 0 } } });
    return { days, abandoned, reminded, recovered: winners.length, revenue: Object.entries(revenue).map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })) };
  }

  /** Recent checkouts that were reminded or recovered. */
  async recent() {
    const rows = await this.db.order.findMany({
      where: { recoveryStage: { gt: 0, lt: RECOVERY_DONE } }, orderBy: { recoveryLastAt: 'desc' }, take: 50,
      select: { id: true, number: true, userId: true, status: true, totalAmount: true, currency: true, createdAt: true, recoveryStage: true, recoveryLastAt: true, recoveredAt: true, recoveredByOrderId: true, items: { select: { title: true } } },
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, fullName: true, email: true } });
    return rows.map((r) => ({ ...r, totalAmount: r.totalAmount.toString(), buyer: users.find((u) => u.id === r.userId) ?? null }));
  }

  // ── worker ────────────────────────────────────────────────
  /** Sends due reminders for every academy that turned recovery on. */
  async run() {
    const rows = await this.prisma.tenantSetting.findMany({ where: { key: RECOVERY_KEY } });
    let sent = 0;
    for (const row of rows) {
      const s = parseRecovery(row.value);
      if (!s.enabled) continue;
      const tenant = await this.prisma.tenant.findUnique({ where: { id: row.tenantId }, select: { status: true } });
      if (tenant?.status !== 'ACTIVE') continue;
      try {
        sent += await this.ctx.run(row.tenantId, () => this.runTenant(row.tenantId, s));
      } catch (e) {
        this.logger.error({ err: (e as Error).message, tenantId: row.tenantId }, 'checkout recovery failed');
      }
    }
    return { recoveryReminders: sent };
  }

  private candidates(firstStepMin: number) {
    const now = Date.now();
    return this.db.order.findMany({
      where: { status: { in: [...UNPAID] }, totalAmount: { gt: 0 }, recoveredAt: null, recoveryStage: { lt: RECOVERY_DONE }, createdAt: { gte: new Date(now - MAX_AGE_MS), lte: new Date(now - firstStepMin * 60_000) } },
      include: { items: true }, orderBy: { createdAt: 'asc' }, take: 200,
    });
  }

  private async runTenant(tenantId: string, s: RecoverySettings) {
    const now = Date.now();
    let sent = 0;
    for (const o of await this.candidates(s.steps[0])) {
      const stage = o.recoveryStage;
      if (stage >= s.steps.length || o.createdAt.getTime() + s.steps[stage] * 60_000 > now) continue;
      // The previous reminder went out recently (e.g. carried over from an earlier checkout): wait for the next step.
      if (o.recoveryLastAt && stage > 0 && o.recoveryLastAt.getTime() + (s.steps[stage] - s.steps[stage - 1]) * 60_000 > now) continue;
      if (await this.settled(o)) {
        await this.db.order.updateMany({ where: { id: o.id, recoveryStage: stage }, data: { recoveryStage: RECOVERY_DONE } });
        continue;
      }
      const claimed = await this.db.order.updateMany({ where: { id: o.id, recoveryStage: stage }, data: { recoveryStage: stage + 1, recoveryLastAt: new Date() } });
      if (!claimed.count) continue;
      try {
        if (await this.remind(tenantId, o, s)) sent++;
      } catch (e) {
        this.logger.warn({ err: (e as Error).message, orderId: o.id }, 'checkout reminder failed');
      }
    }
    return sent;
  }

  /** True when a reminder makes no sense: a newer checkout, a purchase, an upsell, or the buyer already has everything. */
  private async settled(o: OrderWithItems) {
    if (o.items.some((i) => i.source === 'UPSELL')) return true;
    const match = o.items.map((i) => (i.bundleId ? { bundleId: i.bundleId } : i.liveClassId ? { liveClassId: i.liveClassId } : i.digitalProductId ? { digitalProductId: i.digitalProductId } : i.membershipPlanId ? { membershipPlanId: i.membershipPlanId } : { courseId: i.courseId }));
    const newer = await this.db.order.findFirst({ where: { userId: o.userId, id: { not: o.id }, createdAt: { gt: o.createdAt }, items: { some: { OR: match } } }, select: { id: true } });
    if (newer) return true;
    const courses = [...new Set(o.items.flatMap((i) => (Array.isArray(i.grantCourseIds) ? (i.grantCourseIds as string[]) : i.courseId ? [i.courseId] : [])))];
    const owned = courses.length ? (await this.db.enrollment.findMany({ where: { userId: o.userId, courseId: { in: courses } } })).filter((e) => isEnrollmentUsable(e)).length : 0;
    const products = o.items.map((i) => i.digitalProductId).filter((x): x is string => Boolean(x));
    const ownedProducts = products.length ? await this.db.digitalProductAccess.count({ where: { userId: o.userId, productId: { in: products }, revokedAt: null } }) : 0;
    const otherKinds = o.items.some((i) => i.liveClassId || i.membershipPlanId);
    return !otherKinds && courses.length + products.length > 0 && owned >= courses.length && ownedProducts >= products.length;
  }

  /** Where the buyer picks up: the payment link, the item's checkout page, or the cart. */
  private async checkoutPath(o: OrderWithItems) {
    if (o.paymentLinkId) {
      const link = await this.db.paymentLink.findFirst({ where: { id: o.paymentLinkId }, select: { code: true } });
      if (link) return `/pay/${link.code}`;
    }
    const main = o.items.filter((i) => i.source !== 'BUMP');
    if (main.length !== 1) return '/cart/checkout';
    const i = main[0];
    if (i.bundleId) return `/checkout/bundle/${(await this.db.bundle.findFirst({ where: { id: i.bundleId }, select: { slug: true } }))?.slug ?? ''}`;
    if (i.digitalProductId) return `/checkout/product/${(await this.db.digitalProduct.findFirst({ where: { id: i.digitalProductId }, select: { slug: true } }))?.slug ?? ''}`;
    if (i.liveClassId) return `/checkout/webinar/${(await this.db.liveClass.findFirst({ where: { id: i.liveClassId }, select: { slug: true } }))?.slug ?? ''}`;
    if (i.membershipPlanId) return `/checkout/membership/${i.membershipPlanId}`;
    return `/checkout/${(await this.db.course.findFirst({ where: { id: i.courseId ?? '' }, select: { slug: true } }))?.slug ?? ''}`;
  }

  private async offerLine(s: RecoverySettings, currency: string) {
    if (!s.couponCode) return null;
    const now = new Date();
    const c = await this.db.coupon.findFirst({ where: { code: s.couponCode, isActive: true, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } });
    if (!c || (c.maxRedemptions !== null && c.redemptionCount >= c.maxRedemptions)) return null;
    const off = c.type === 'PERCENT' ? `${Number(c.value)}% off` : `${fmtMoney(toMinor(c.value, currency), currency)} off`;
    return { code: c.code, text: `Use code ${c.code} to get ${off}.` };
  }

  private async remind(tenantId: string, o: OrderWithItems, s: RecoverySettings) {
    const user = await this.prisma.user.findUnique({ where: { id: o.userId }, select: { email: true, fullName: true, phone: true, phoneVerifiedAt: true, status: true } });
    if (!user || user.status !== 'ACTIVE') return false;
    const pref = await this.prisma.notificationPreference.findUnique({ where: { userId_category: { userId: o.userId, category: 'orders' } } });
    const { origin, name: brand } = await academyOrigin(this.prisma, this.config, tenantId);
    const offer = await this.offerLine(s, o.currency);
    const path = await this.checkoutPath(o);
    const url = `${origin}${path}${offer ? `${path.includes('?') ? '&' : '?'}coupon=${encodeURIComponent(offer.code)}` : ''}`;
    const billing = (o.billing ?? {}) as Record<string, string | null>;
    const items = o.items.map((i) => i.title);
    const total = fmtMoney(toMinor(o.totalAmount, o.currency), o.currency);
    let delivered = false;
    if (pref?.email !== false) {
      await this.mail.send({ to: billing.email || user.email, tenantId, tag: 'checkout-recovery', ...emailTemplates.checkoutRecovery({ brand, name: billing.name || user.fullName, items, total, offer: offer?.text ?? null, url }) });
      delivered = true;
    }
    const phone = [billing.phone, user.phoneVerifiedAt ? user.phone : null].find((p) => p && /^\+[1-9]\d{7,14}$/.test(p));
    if (s.whatsapp && phone && pref?.whatsapp !== false && this.whatsappAvailable()) {
      await this.messaging.add(MESSAGING_JOBS.WHATSAPP, { to: phone, title: `${brand}: your checkout is waiting`, body: `You left ${items.join(', ').slice(0, 200)} (${total}) at checkout.${offer ? ` ${offer.text}` : ''} Finish here: ${url}` }, { attempts: 3 });
      delivered = true;
    }
    return delivered;
  }
}
