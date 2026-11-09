import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ERROR_CODES, FEATURES } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { emailTemplates } from '../../core/mail/templates.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../core/redis/redis.constants.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AppEvents } from '../../core/events/app-events.service.js';
import { AffiliatesService } from '../affiliates/affiliates.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { enrollmentExpiry, isEnrollmentUsable } from '../learning/access.js';
import { CouponsService } from './coupons.service.js';
import { DigitalProductsService } from './digital-products.service.js';
import { CoachingService } from './coaching/coaching.service.js';
import { FunnelService, itemKey } from './funnel.service.js';
import { GatewayService } from './gateway.service.js';
import { renderInvoicePdf } from './invoice-pdf.js';
import { commissionMinor, computeLinesQuote, proportional, transactionFeeMinor, type Quote } from './pricing.js';
import { fromMinor, toMinor } from './providers/money.js';
import { PaymentProviders } from './providers/registry.js';
import { type NormalizedPayment, ProviderError } from './providers/types.js';

/** Unpaid orders stop accepting new payment attempts after this. Late captures are still honoured. */
const ORDER_TTL_MS = 2 * 3600_000;
/** Orders in these states become PAID when a matching capture is confirmed (money was taken). */
const PAYABLE = ['PENDING', 'PAYMENT_INITIATED', 'FAILED', 'EXPIRED', 'CANCELLED'] as const;
export const OFFLINE_MODES = ['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER'] as const;
const OFFLINE_LABEL: Record<string, string> = { CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', UPI: 'UPI (direct)', CHEQUE: 'Cheque', OTHER: 'Offline payment' };

export interface BillingInput {
  name: string;
  email?: string;
  phone?: string | null;
  country?: string | null;
  state?: string | null;
  gstin?: string | null;
}

export interface ProductRef {
  /** Exactly one of courseId / bundleId / membershipPlanId / webinarId / fromCart. */
  courseId?: string;
  /** A paid webinar ticket (LiveClass id). */
  webinarId?: string;
  /** A paid digital product (download). */
  digitalProductId?: string;
  /** A paid 1:1 coaching program. */
  coachingProgramId?: string;
  bundleId?: string;
  membershipPlanId?: string;
  /** Buy everything in the student's cart (courses and bundles). */
  fromCart?: boolean;
  /** Buyer's country (ISO 2) for zero-rated exports; defaults to the account's country. */
  country?: string;
  /** Buy through a shareable payment link (replaces the fields above). */
  paymentLinkCode?: string;
  /** Take a post-purchase upsell offered after `sourceOrderId` (replaces the fields above). */
  upsellOfferId?: string;
  sourceOrderId?: string;
  /** Order bumps ticked on the checkout page. */
  bumpOfferIds?: string[];
}

/** One thing being bought. `grant` = courses it unlocks. */
interface Line {
  kind: 'course' | 'bundle' | 'membership' | 'webinar' | 'product' | 'coaching';
  id: string;
  title: string;
  slug: string | null;
  unitMinor: number;
  currency: string;
  grant: string[];
  /** How the line was added when it isn't a plain purchase. */
  source?: 'BUMP' | 'UPSELL' | 'LINK';
  offerId?: string;
  /** Promo codes don't discount bump and upsell prices. */
  couponable?: boolean;
  /** The item's own GST display (true = included); undefined = the academy's setting. */
  taxInclusive?: boolean;
  /** A lifetime membership: bought once. */
  lifetime?: boolean;
  /** The seller passes the Razorpay charge to the buyer as a transaction fee. */
  passFee?: boolean;
}

/** Order states a buyer can come back from (reminders, recovery). */
const UNPAID = ['PENDING', 'PAYMENT_INITIATED', 'FAILED', 'EXPIRED'] as const;
/** recoveryStage meaning "no reminders for this order" (a newer order or a purchase took over). */
export const RECOVERY_DONE = 99;

export interface CheckoutInput extends ProductRef {
  couponCode?: string | null;
  /** Referral code from an affiliate link (?ref=). Invalid or self-referral codes are ignored. */
  affiliateCode?: string | null;
  /** First-touch attribution from the site tracker: visitorId, source, medium, campaign, referrerHost, landingPath. */
  attribution?: Record<string, unknown> | null;
  billing: BillingInput;
}

type Tx = Parameters<Parameters<TenantPrismaClient['$transaction']>[0]>[0];

/** Keeps only known attribution fields, as short lower-case strings. */
export function cleanAttribution(a: Record<string, unknown> | null | undefined) {
  if (!a || typeof a !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, max] of [['visitorId', 40], ['source', 100], ['medium', 100], ['campaign', 150], ['referrerHost', 191], ['landingPath', 255]] as const) {
    const v = a[k];
    if (typeof v === 'string' && v.trim()) out[k] = k === 'visitorId' || k === 'landingPath' ? v.trim().slice(0, max) : v.trim().toLowerCase().slice(0, max);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Courses an order unlocks: each line's fixed grant list (bundles), or its course. */
export function grantedCourses(items: { courseId: string | null; grantCourseIds?: unknown }[]) {
  const ids = items.flatMap((i) => (Array.isArray(i.grantCourseIds) ? (i.grantCourseIds as string[]) : i.courseId ? [i.courseId] : []));
  return [...new Set(ids)];
}

export function fmtMoney(minor: number, currency: string) {
  return `${currency} ${Number(fromMinor(minor, currency)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

import { financialYear, invoiceNumber } from './invoice-number.js';
export { financialYear };

export async function nextSequence(tx: { $executeRaw: any; $queryRaw: any }, tenantId: string, name: string): Promise<number> {
  await tx.$executeRaw`INSERT INTO TenantSequence (tenantId, name, value) VALUES (${tenantId}, ${name}, 1) ON DUPLICATE KEY UPDATE value = value + 1`;
  const rows: { value: number }[] = await tx.$queryRaw`SELECT value FROM TenantSequence WHERE tenantId = ${tenantId} AND name = ${name}`;
  return Number(rows[0].value);
}

/**
 * Orders, Razorpay payments, fulfilment, refunds and reconciliation.
 * Payment state is only ever taken from Razorpay's API (never from the browser), and an order
 * becomes PAID, grants access, redeems its coupon, books the ledger and issues its invoice in
 * a single transaction guarded by a conditional status update, so duplicate or out-of-order
 * confirmations (browser callback, webhook, reconciliation) fulfil exactly once.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly gateways: GatewayService,
    private readonly coupons: CouponsService,
    private readonly providers: PaymentProviders,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly notifications: NotificationsService,
    private readonly events: AppEvents,
    private readonly affiliates: AffiliatesService,
    private readonly memberships: MembershipsService,
    private readonly digital: DigitalProductsService,
    private readonly coaching: CoachingService,
    private readonly funnel: FunnelService,
  ) {}

  // ── views ─────────────────────────────────────────────────
  view(o: any) {
    const m = (v: any) => (v === null || v === undefined ? null : v.toString());
    return {
      id: o.id, number: o.number, status: o.status, currency: o.currency,
      subtotalAmount: m(o.subtotalAmount), discountAmount: m(o.discountAmount), taxAmount: m(o.taxAmount), totalAmount: m(o.totalAmount), refundedAmount: m(o.refundedAmount),
      taxRate: m(o.taxRate), taxInclusive: o.taxInclusive, transactionFeeAmount: m(o.transactionFeeAmount ?? 0), couponCode: o.couponCode, provider: o.provider, billing: o.billing, paymentMode: o.paymentMode ?? (o.provider ?? null), externalReference: o.externalReference ?? null,
      paidAt: o.paidAt, failureReason: o.failureReason, expiresAt: o.expiresAt, createdAt: o.createdAt, userId: o.userId,
      items: o.items?.map((i: any) => ({ id: i.id, courseId: i.courseId, bundleId: i.bundleId ?? null, membershipPlanId: i.membershipPlanId ?? null, liveClassId: i.liveClassId ?? null, digitalProductId: i.digitalProductId ?? null, coachingProgramId: i.coachingProgramId ?? null, title: i.title, unitAmount: m(i.unitAmount), discountAmount: m(i.discountAmount), totalAmount: m(i.totalAmount), source: i.source ?? null, offerId: i.offerId ?? null })),
      paymentLinkId: o.paymentLinkId ?? null,
      payments: o.payments?.map((p: any) => ({
        id: p.id, provider: p.provider, providerOrderId: p.providerOrderId, providerPaymentId: p.providerPaymentId, status: p.status,
        amount: m(p.amount), currency: p.currency, method: p.method, feeAmount: m(p.feeAmount), failureReason: p.failureReason, capturedAt: p.capturedAt, createdAt: p.createdAt,
      })),
      refunds: o.refunds?.map((r: any) => ({ id: r.id, amount: m(r.amount), reason: r.reason, status: r.status, revokeAccess: r.revokeAccess, providerRefundId: r.providerRefundId, failureReason: r.failureReason, processedAt: r.processedAt, createdAt: r.createdAt })),
    };
  }

  private async academy(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { business: true, domains: { where: { status: 'VERIFIED', isPrimary: true }, take: 1 } } });
    const web = new URL(this.config.get('WEB_PUBLIC_URL'));
    const root = this.config.get('PLATFORM_ROOT_DOMAIN');
    const primary = t.domains[0]?.hostname ?? `${t.slug}.${root}`;
    const origin = primary.endsWith(`.${root}`) ? `${web.protocol}//${primary}${web.port ? `:${web.port}` : ''}` : `https://${primary}`;
    return { tenant: t, origin, business: t.business };
  }

  private async taxRule(tenantId: string) {
    const b = await this.prisma.tenantBusinessProfile.findUnique({ where: { tenantId } });
    return b?.gstRegistered ? { rate: Number(b.taxRate), inclusive: b.pricesIncludeTax } : null;
  }

  // ── checkout ──────────────────────────────────────────────
  private async sellableCourse(courseId: string) {
    const c = await this.db.course.findFirst({ where: { id: courseId, deletedAt: null, status: 'PUBLISHED' } });
    if (!c || c.visibility === 'PRIVATE') throw AppException.notFound('Course not found');
    if (c.isFree) throw AppException.conflict('This course is free — enrol directly.');
    if (c.priceAmount === null || Number(c.priceAmount) <= 0) throw AppException.conflict('This course is not for sale yet.');
    return c;
  }

  /** What is being bought: a course or a membership plan. */
  private async product(ref: { courseId?: string; membershipPlanId?: string }): Promise<Line> {
    if (ref.membershipPlanId) {
      const p = await this.memberships.sellable(ref.membershipPlanId);
      return {
        kind: 'membership', id: p.id, title: `${p.name} membership (${p.lifetime ? 'lifetime' : p.interval === 'YEAR' ? 'yearly' : 'monthly'})`, slug: null, unitMinor: toMinor(p.priceAmount, p.currency), currency: p.currency, grant: [],
        ...(p.taxExclusive === null || p.taxExclusive === undefined ? {} : { taxInclusive: !p.taxExclusive }), lifetime: p.lifetime, passFee: p.passTransactionFee,
      };
    }
    if (!ref.courseId) throw AppException.validation([{ field: 'courseId', message: 'Choose what to buy' }]);
    const c = await this.sellableCourse(ref.courseId);
    return { kind: 'course', id: c.id, title: c.title, slug: c.slug, unitMinor: toMinor(c.priceAmount!, c.currency), currency: c.currency, grant: [c.id] };
  }

  /** A paid, published course as a checkout line. */
  sellableLine(courseId: string) {
    return this.product({ courseId });
  }

  /** A published, paid digital product. */
  async sellableProduct(id: string): Promise<Line> {
    const p = await this.db.digitalProduct.findFirst({ where: { id, status: 'PUBLISHED' } });
    if (!p) throw AppException.notFound('Product not found');
    if (Number(p.priceAmount) <= 0) throw AppException.conflict('This product is free — get it on its page.');
    return { kind: 'product', id: p.id, title: p.title.slice(0, 200), slug: p.slug, unitMinor: toMinor(p.priceAmount, p.currency), currency: p.currency, grant: [] };
  }

  /** A published, paid coaching program with at least one coach and session. */
  async sellableCoaching(id: string): Promise<Line> {
    const p = await this.db.coachingProgram.findFirst({ where: { id, status: 'PUBLISHED' } });
    if (!p) throw AppException.notFound('Coaching program not found');
    if (Number(p.priceAmount) <= 0) throw AppException.conflict('This program is free — get it on its page.');
    return { kind: 'coaching', id: p.id, title: `${p.title} (1:1 coaching)`.slice(0, 200), slug: p.slug, unitMinor: toMinor(p.priceAmount, p.currency), currency: p.currency, grant: [], passFee: p.passTransactionFee };
  }

  /** A paid webinar with upcoming sessions and seats left. */
  async sellableWebinar(id: string): Promise<Line> {
    const c = await this.db.liveClass.findFirst({ where: { id, kind: 'WEBINAR', status: 'ACTIVE' }, include: { sessions: { where: { status: { in: ['SCHEDULED', 'LIVE'] } }, take: 1 } } });
    if (!c) throw AppException.notFound('Webinar not found');
    if (!c.priceAmount || Number(c.priceAmount) <= 0 || !c.currency) throw AppException.conflict('This webinar is free — register on its page.');
    if (!c.sessions.length) throw AppException.conflict('There are no upcoming sessions for this webinar.');
    if (c.capacity && (await this.db.webinarRegistration.count({ where: { liveClassId: c.id, cancelledAt: null } })) >= c.capacity) throw AppException.conflict('This webinar is full.');
    return { kind: 'webinar', id: c.id, title: `${c.title} (webinar ticket)`.slice(0, 200), slug: c.slug, unitMinor: toMinor(c.priceAmount, c.currency), currency: c.currency, grant: [] };
  }

  /** A published bundle whose courses are all still published. */
  async sellableBundle(bundleId: string): Promise<Line> {
    const b = await this.db.bundle.findFirst({ where: { id: bundleId, status: 'PUBLISHED' } });
    if (!b) throw AppException.notFound('Bundle not found');
    const ids = b.courseIds as string[];
    const live = await this.db.course.count({ where: { id: { in: ids }, status: 'PUBLISHED', deletedAt: null } });
    if (live !== ids.length) throw AppException.conflict(`“${b.title}” is not available right now.`);
    return { kind: 'bundle', id: b.id, title: `${b.title} (bundle)`, slug: b.slug, unitMinor: toMinor(b.priceAmount, b.currency), currency: b.currency, grant: ids };
  }

  /** Any sellable item by kind, as a checkout line at its own price. */
  async sellableItem(kind: string, id: string): Promise<Line> {
    if (kind === 'course') return this.product({ courseId: id });
    if (kind === 'membership') return this.product({ membershipPlanId: id });
    if (kind === 'bundle') return this.sellableBundle(id);
    if (kind === 'product') return this.sellableProduct(id);
    if (kind === 'webinar') return this.sellableWebinar(id);
    if (kind === 'coaching') return this.sellableCoaching(id);
    throw AppException.validation([{ field: 'itemKind', message: 'Unknown item type' }]);
  }

  /**
   * Everything a checkout sells: the main lines (cart, item, payment link or upsell), the bumps on offer
   * for them and the bumps the buyer ticked. Owned items and unavailable offers are refused or skipped.
   */
  private async resolve(userId: string, ref: ProductRef) {
    let lines: Line[];
    let link: Awaited<ReturnType<FunnelService['link']>> | null = null;
    let upsell: { offerId: string; sourceOrderId: string } | null = null;
    if (ref.paymentLinkCode) {
      link = await this.funnel.link(ref.paymentLinkCode);
      const base = await this.sellableItem(link.itemKind, link.itemId);
      const custom = link.priceAmount !== null && base.currency === link.currency;
      lines = [{ ...base, source: 'LINK', unitMinor: custom ? toMinor(link.priceAmount!, base.currency) : base.unitMinor }];
    } else if (ref.upsellOfferId) {
      if (!ref.sourceOrderId) throw AppException.validation([{ field: 'sourceOrderId', message: 'Missing the order this offer follows' }]);
      const offer = await this.funnel.upsell(userId, ref.sourceOrderId, ref.upsellOfferId);
      const base = await this.sellableItem(offer.itemKind, offer.itemId);
      if (base.currency !== offer.currency) throw AppException.conflict('This offer is no longer available');
      lines = [{ ...base, source: 'UPSELL', offerId: offer.id, couponable: false, unitMinor: toMinor(offer.priceAmount, offer.currency) }];
      upsell = { offerId: offer.id, sourceOrderId: ref.sourceOrderId };
    } else {
      lines = await this.lines(userId, ref);
    }
    if (!link && !upsell) await this.assertBuyable(userId, lines);

    const bumps: { offer: { id: string; headline: string; description: string | null }; line: Line; regularMinor: number }[] = [];
    if (!link && !upsell) {
      const cur = lines[0].currency;
      for (const o of await this.funnel.bumpOffers(lines.map((l) => itemKey(l.kind, l.id)), cur)) {
        if (bumps.length >= 3) break;
        try {
          const base = await this.sellableItem(o.itemKind, o.itemId);
          if (base.currency !== cur) continue;
          const line: Line = { ...base, source: 'BUMP', offerId: o.id, couponable: false, unitMinor: toMinor(o.priceAmount, cur) };
          await this.assertBuyable(userId, [...lines, line]);
          bumps.push({ offer: o, line, regularMinor: base.unitMinor });
        } catch {
          // Not sellable right now or already owned: simply not offered.
        }
      }
    }
    const chosen = [...new Set(ref.bumpOfferIds ?? [])];
    for (const id of chosen) {
      const b = bumps.find((x) => x.offer.id === id);
      if (!b) throw AppException.validation([{ field: 'bumpOfferIds', message: 'An add-on you picked is no longer available. Refresh and try again.' }]);
      lines.push(b.line);
    }
    if (link || upsell || chosen.length) await this.assertBuyable(userId, lines);
    return { lines, link, upsell, bumps, chosen };
  }

  private async lines(userId: string, ref: ProductRef): Promise<Line[]> {
    let lines: Line[];
    if (ref.fromCart) {
      const items = await this.db.cartItem.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
      if (!items.length) throw AppException.validation([{ field: 'cart', message: 'Your cart is empty' }]);
      lines = [];
      for (const i of items) lines.push(i.bundleId ? await this.sellableBundle(i.bundleId) : i.digitalProductId ? await this.sellableProduct(i.digitalProductId) : await this.product({ courseId: i.courseId! }));
    } else if (ref.bundleId) {
      lines = [await this.sellableBundle(ref.bundleId)];
    } else if (ref.webinarId) {
      lines = [await this.sellableWebinar(ref.webinarId)];
    } else if (ref.digitalProductId) {
      lines = [await this.sellableProduct(ref.digitalProductId)];
    } else if (ref.coachingProgramId) {
      lines = [await this.sellableCoaching(ref.coachingProgramId)];
    } else {
      lines = [await this.product(ref)];
    }
    if (new Set(lines.map((l) => l.currency)).size > 1) throw AppException.conflict('Items in your cart are priced in different currencies. Buy them separately.');
    return lines;
  }

  /** Refuses lines the buyer already has, and courses also included in a bundle in the same order. */
  async assertBuyable(userId: string, lines: Line[]) {
    const all = [...new Set(lines.flatMap((l) => l.grant))];
    const owned = new Set((await this.db.enrollment.findMany({ where: { userId, courseId: { in: all } } })).filter((e) => isEnrollmentUsable(e)).map((e) => e.courseId));
    for (const l of lines) {
      if (l.kind === 'course' && owned.has(l.id)) throw AppException.conflict(lines.length > 1 ? `You already have access to “${l.title}”. Remove it from your cart.` : 'You already have access to this course.');
      if (l.kind === 'bundle' && l.grant.every((id) => owned.has(id))) throw AppException.conflict(`You already have every course in “${l.title}”.`);
    }
    for (const p of lines.filter((l) => l.kind === 'product')) {
      if (await this.db.digitalProductAccess.findFirst({ where: { productId: p.id, userId, revokedAt: null } })) throw AppException.conflict(lines.length > 1 ? `You already have “${p.title}”. Remove it from your cart.` : 'You already have this product. Find it under My downloads.');
    }
    for (const m of lines.filter((l) => l.kind === 'membership' && l.lifetime)) {
      if (await this.db.membership.findFirst({ where: { userId, planId: m.id, status: 'ACTIVE', currentPeriodEnd: { gt: new Date() } } })) throw AppException.conflict('You already have lifetime access to this membership.');
    }
    for (const c of lines.filter((l) => l.kind === 'coaching')) {
      if (await this.db.coachingAccess.findFirst({ where: { programId: c.id, userId, revokedAt: null } })) throw AppException.conflict('You already have this coaching program. Book your sessions under My coaching.');
    }
    for (const w of lines.filter((l) => l.kind === 'webinar')) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      const reg = await this.db.webinarRegistration.findFirst({ where: { liveClassId: w.id, cancelledAt: null, OR: [{ userId }, ...(user ? [{ email: user.email.toLowerCase() }] : [])] } });
      if (reg) throw AppException.conflict('You already have a ticket for this webinar. Check your email for the join link.');
    }
    for (const c of lines.filter((l) => l.kind === 'course')) {
      const b = lines.find((l) => l.kind === 'bundle' && l.grant.includes(c.id));
      if (b) throw AppException.conflict(`“${c.title}” is already included in ${b.title}. Remove one of them.`);
    }
  }

  private async price(userId: string, lines: Line[], couponCode?: string | null, buyerCountry?: string | null) {
    const tenantId = this.ctx.requireTenantId();
    const cur = lines[0].currency;
    const couponable = lines.filter((l) => l.couponable !== false);
    if (couponCode && !couponable.length) throw AppException.validation([{ field: 'couponCode', message: 'Promo codes can’t be used with this offer' }]);
    const coupon = couponCode ? await this.coupons.evaluateLines(couponCode, couponable, userId, cur) : null;
    let k = 0;
    const eligible = lines.map((l) => (l.couponable === false ? false : coupon ? coupon.eligible[k++] : true));
    const rule = await this.taxRule(tenantId);
    // Items can set their own GST display; it applies when every item in the order agrees.
    const own = [...new Set(lines.map((l) => l.taxInclusive))];
    let tax = rule && own.length === 1 && own[0] !== undefined ? { ...rule, inclusive: own[0] } : rule;
    // Exports under a valid LUT are zero-rated: no GST for buyers outside India.
    if (tax && buyerCountry && buyerCountry !== 'IN' && (await this.prisma.tenantBusinessProfile.findUnique({ where: { tenantId }, select: { exportsUnderLut: true } }))?.exportsUnderLut) tax = { ...tax, rate: 0 };
    const base = computeLinesQuote(lines.map((l) => l.unitMinor), eligible, coupon?.rule ?? null, tax);
    // Sellers can pass the gateway charge to buyers ("Charge transaction fee"); it isn't taxed or discounted.
    const fee = transactionFeeMinor(base.lines.map((l) => l.total), lines.map((l) => Boolean(l.passFee)));
    const q = { ...base, total: base.total + fee, net: base.net + fee, fee };
    return { coupon, tax, q, cur };
  }

  async quote(userId: string, ref: ProductRef, couponCode?: string | null) {
    const { lines, link, upsell, bumps, chosen } = await this.resolve(userId, ref);
    const tenantId = this.ctx.requireTenantId();
    const buyer = await this.prisma.user.findUnique({ where: { id: userId }, select: { country: true } });
    const { coupon, tax, q, cur } = await this.price(userId, lines, this.funnel.linkCoupon(link, couponCode), ref.country ?? buyer?.country);
    const first = lines[0];
    const main = lines.filter((l) => l.source !== 'BUMP');
    const active = (await this.entitlements.get(tenantId)).active;
    const selling = active ? await this.gateways.sellingAccount() : null;
    return {
      kind: main.length > 1 ? ('cart' as const) : first.kind, course: { id: first.id, title: first.title, slug: first.slug }, currency: cur, couponCode: coupon?.code ?? null,
      items: lines.map((l, i) => ({ kind: l.kind, id: l.id, title: l.title, slug: l.slug, unit: fromMinor(l.unitMinor, cur), discount: fromMinor(q.lines[i].discount, cur), total: fromMinor(q.lines[i].total, cur), courseCount: l.grant.length, source: l.source ?? null, offerId: l.offerId ?? null })),
      subtotal: fromMinor(q.subtotal, cur), discount: fromMinor(q.discount, cur), tax: fromMinor(q.tax, cur), total: fromMinor(q.total, cur),
      taxRate: tax?.rate ?? null, taxInclusive: tax?.inclusive ?? true, transactionFee: fromMinor(q.fee, cur), paymentsEnabled: Boolean(selling) || (q.total === 0 && active),
      bumps: bumps.map((b) => ({
        offerId: b.offer.id, headline: b.offer.headline, description: b.offer.description, kind: b.line.kind, itemId: b.line.id, title: b.line.title, slug: b.line.slug,
        price: fromMinor(b.line.unitMinor, cur), regularPrice: fromMinor(b.regularMinor, cur), selected: chosen.includes(b.offer.id),
      })),
      paymentLink: link ? { code: link.code, title: link.title, note: link.note, couponLocked: !link.allowCoupons } : null,
      upsell,
    };
  }

  private static signature(items: { courseId?: string | null; bundleId?: string | null; membershipPlanId?: string | null; liveClassId?: string | null; digitalProductId?: string | null; coachingProgramId?: string | null }[]) {
    return items.map((i) => (i.coachingProgramId ? `k:${i.coachingProgramId}` : i.bundleId ? `b:${i.bundleId}` : i.membershipPlanId ? `m:${i.membershipPlanId}` : i.liveClassId ? `w:${i.liveClassId}` : i.digitalProductId ? `p:${i.digitalProductId}` : `c:${i.courseId}`)).sort().join(',');
  }

  async checkout(userId: string, input: CheckoutInput, idempotencyKey?: string) {
    const tenantId = this.ctx.requireTenantId();
    const { lines, link, upsell } = await this.resolve(userId, input);
    const sig = OrdersService.signature(lines.map((l) => ({ courseId: l.kind === 'course' ? l.id : null, bundleId: l.kind === 'bundle' ? l.id : null, membershipPlanId: l.kind === 'membership' ? l.id : null, liveClassId: l.kind === 'webinar' ? l.id : null, digitalProductId: l.kind === 'product' ? l.id : null, coachingProgramId: l.kind === 'coaching' ? l.id : null })));
    if (idempotencyKey) {
      const prior = await this.db.order.findFirst({ where: { userId, idempotencyKey }, include: { items: true } });
      if (prior) {
        if (OrdersService.signature(prior.items) !== sig) throw new AppException(ERROR_CODES.CONFLICT, 'Idempotency-Key was already used for a different order', HttpStatus.CONFLICT);
        return this.view(prior);
      }
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { coupon, tax, q, cur } = await this.price(userId, lines, this.funnel.linkCoupon(link, input.couponCode), input.billing.country ?? user.country);
    if (!(await this.entitlements.get(tenantId)).active) throw AppException.conflict('This academy is not accepting new purchases right now.');
    if (q.total > 0 && !(await this.gateways.sellingAccount())) throw AppException.integrationNotConfigured('Online payments for this academy');
    if (q.total > 0 && q.total < 100 && cur === 'INR') throw AppException.validation([{ field: 'couponCode', message: 'The amount to pay must be at least ₹1' }]);

    const billing = {
      name: input.billing.name.trim(), email: (input.billing.email ?? user.email).trim().toLowerCase(), phone: input.billing.phone?.trim() || user.phone || null,
      country: input.billing.country ?? user.country ?? null, state: input.billing.state?.trim() || null, gstin: input.billing.gstin?.trim().toUpperCase() || null,
    };
    const affiliateId = await this.affiliates.attribute(input.affiliateCode, userId);
    const order = await this.db.$transaction(async (tx) => {
      // A new checkout supersedes this buyer's earlier unpaid orders for any of the same items.
      const ref = (l: Line) => (l.kind === 'course' ? { courseId: l.id } : l.kind === 'bundle' ? { bundleId: l.id } : l.kind === 'webinar' ? { liveClassId: l.id } : l.kind === 'product' ? { digitalProductId: l.id } : l.kind === 'coaching' ? { coachingProgramId: l.id } : { membershipPlanId: l.id });
      const match = lines.map(ref);
      const open = await tx.order.findMany({ where: { userId, status: { in: ['PENDING', 'PAYMENT_INITIATED'] }, items: { some: { OR: match } } }, select: { id: true } });
      if (open.length) await tx.order.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { status: 'CANCELLED', failureReason: 'Superseded by a newer checkout' } });
      // Reminders already sent for these items carry over, so coming back doesn't restart the sequence.
      const reminded = await tx.order.aggregate({
        where: { userId, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) }, recoveryStage: { gt: 0, lt: RECOVERY_DONE }, items: { some: { OR: match } } },
        _max: { recoveryStage: true },
      });
      const n = await nextSequence(tx, tenantId, 'order');
      const o = await tx.order.create({
        data: {
          number: `ORD-${String(n).padStart(6, '0')}`, userId, currency: cur,
          subtotalAmount: fromMinor(q.subtotal, cur), discountAmount: fromMinor(q.discount, cur), taxAmount: fromMinor(q.tax, cur), totalAmount: fromMinor(q.total, cur), transactionFeeAmount: fromMinor(q.fee, cur),
          taxRate: tax?.rate ?? null, taxInclusive: tax?.inclusive ?? true, couponId: coupon?.id ?? null, couponCode: coupon?.code ?? null,
          billing, idempotencyKey: idempotencyKey ?? null, expiresAt: new Date(Date.now() + ORDER_TTL_MS), affiliateId, attribution: cleanAttribution(input.attribution),
          paymentLinkId: link?.id ?? null, recoveryStage: reminded._max.recoveryStage ?? 0,
        } as never,
      });
      for (const [i, l] of lines.entries()) {
        await tx.orderItem.create({
          data: {
            orderId: o.id, ...ref(l), grantCourseIds: l.grant.length ? l.grant : undefined,
            title: l.title.slice(0, 200), unitAmount: fromMinor(q.lines[i].unit, cur), discountAmount: fromMinor(q.lines[i].discount, cur), totalAmount: fromMinor(q.lines[i].total, cur),
            offerId: l.offerId ?? null, source: l.source ?? null,
          } as never,
        });
      }
      return o;
    });
    if (upsell) await this.funnel.recordUpsellCheckout(userId, upsell.offerId, upsell.sourceOrderId);
    await this.audit.record({ action: 'order.create', tenantId, actorUserId: userId, actorRealm: 'TENANT', targetType: 'Order', targetId: order.id, after: { number: order.number, total: order.totalAmount.toString(), coupon: coupon?.code ?? null, items: lines.length } });

    if (q.total === 0) await this.fulfil(order.id, null, q);
    return this.getForUser(userId, order.id);
  }

  /** The one-time offer to show after this paid order, or null. */
  async upsellFor(userId: string, orderId: string) {
    const { order, offers } = await this.funnel.upsellsAfter(userId, orderId);
    if (!order) return null;
    for (const o of offers) {
      try {
        const base = await this.sellableItem(o.itemKind, o.itemId);
        if (base.currency !== o.currency) continue;
        await this.assertBuyable(userId, [base]);
        return {
          offerId: o.id, sourceOrderId: order.id, headline: o.headline, description: o.description, kind: base.kind, itemId: base.id, title: base.title, slug: base.slug,
          currency: o.currency, price: o.priceAmount.toString(), regularPrice: fromMinor(base.unitMinor, o.currency), expiresAt: new Date(order.paidAt!.getTime() + o.windowMinutes * 60_000),
        };
      } catch {
        // Unavailable or already owned: try the next offer.
      }
    }
    return null;
  }

  declineUpsell(userId: string, orderId: string, offerId: string) {
    return this.funnel.decline(userId, orderId, offerId);
  }

  async getForUser(userId: string, id: string) {
    const o = await this.db.order.findFirst({ where: { id, userId }, include: { items: true, payments: { orderBy: { createdAt: 'desc' } }, refunds: { orderBy: { createdAt: 'desc' } } } });
    if (!o) throw AppException.notFound('Order not found');
    const [invoice, slugs] = await Promise.all([
      this.db.invoice.findFirst({ where: { orderId: o.id }, select: { number: true } }),
      this.courseSlugs(o.items.map((i) => i.courseId).filter((x): x is string => Boolean(x))),
    ]);
    const v = this.view(o);
    return { ...v, items: v.items!.map((i: { courseId: string | null }) => ({ ...i, courseSlug: i.courseId ? slugs.get(i.courseId) ?? null : null })), invoiceNumber: invoice?.number ?? null };
  }

  private async courseSlugs(ids: string[]) {
    const rows = await this.db.course.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true } });
    return new Map(rows.map((r) => [r.id, r.slug]));
  }

  async listForUser(userId: string) {
    const rows = await this.db.order.findMany({ where: { userId, status: { notIn: ['CANCELLED'] } }, include: { items: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((o) => this.view(o));
  }

  /** Opens a Razorpay order for an unpaid order and returns what Checkout.js needs. */
  async pay(userId: string, id: string) {
    const o = await this.db.order.findFirst({ where: { id, userId }, include: { items: true } });
    if (!o) throw AppException.notFound('Order not found');
    if (o.status === 'PAID' || o.status === 'REFUNDED' || o.status === 'PARTIALLY_REFUNDED') throw AppException.conflict('This order is already paid.');
    if (!['PENDING', 'PAYMENT_INITIATED', 'FAILED'].includes(o.status) || o.expiresAt <= new Date()) throw AppException.conflict('This order has expired. Start checkout again.');
    if (!(await this.entitlements.get(o.tenantId)).active) throw AppException.conflict('This academy is not accepting new purchases right now.');
    const selling = await this.gateways.sellingAccount();
    if (!selling) throw AppException.integrationNotConfigured('Online payments for this academy');
    const { tenant } = await this.academy(o.tenantId);
    const billing = o.billing as Record<string, string | null>;
    const amountMinor = toMinor(o.totalAmount, o.currency);
    let created;
    try {
      created = await this.providers.get('RAZORPAY').createPayment(selling.creds, {
        orderId: o.id, orderNumber: o.number, amountMinor, currency: o.currency, merchantName: tenant.name,
        description: o.items.map((i) => i.title).join(', ').slice(0, 250),
        customer: { id: userId, name: billing.name ?? '', email: billing.email ?? '', phone: billing.phone },
      });
    } catch (e) {
      throw this.providerFailure(e);
    }
    await this.db.$transaction([
      this.db.payment.create({ data: { orderId: o.id, provider: 'RAZORPAY', gatewayAccountId: selling.account.id, providerOrderId: created.providerOrderId, amount: o.totalAmount, currency: o.currency } as never }),
      this.db.order.update({ where: { id: o.id }, data: { status: 'PAYMENT_INITIATED', provider: 'RAZORPAY', gatewayAccountId: selling.account.id, failureReason: null } }),
    ]);
    return { orderId: o.id, checkout: created.clientPayload };
  }

  /** Browser callback after Checkout.js. Verifies the signature and re-reads the payment from Razorpay. */
  async confirm(userId: string, id: string, data: Record<string, unknown>) {
    const o = await this.db.order.findFirst({ where: { id, userId } });
    if (!o) throw AppException.notFound('Order not found');
    const providerOrderId = String(data.razorpay_order_id ?? '');
    const payment = await this.db.payment.findFirst({ where: { orderId: o.id, providerOrderId } });
    if (!payment) throw AppException.validation([{ field: 'razorpay_order_id', message: 'Unknown payment for this order' }]);
    const account = await this.gateways.credentialsById(payment.gatewayAccountId);
    if (!account) throw AppException.integrationNotConfigured('Razorpay');
    let result: NormalizedPayment;
    try {
      result = await this.providers.get('RAZORPAY').confirm(account.creds, { providerOrderId, currency: payment.currency }, data);
    } catch (e) {
      throw this.providerFailure(e);
    }
    await this.applyPaymentResult(payment.id, result);
    return this.getForUser(userId, id);
  }

  /** Buyer closed or failed Checkout.js. Informational only: Razorpay remains the source of truth. */
  async markAbandoned(userId: string, id: string, reason?: string) {
    const o = await this.db.order.findFirst({ where: { id, userId } });
    if (!o) throw AppException.notFound('Order not found');
    if (o.status === 'PAYMENT_INITIATED') await this.db.order.update({ where: { id: o.id }, data: { failureReason: (reason || 'Payment was not completed').slice(0, 500) } });
    return this.getForUser(userId, id);
  }

  private providerFailure(e: unknown) {
    if (e instanceof ProviderError) {
      this.logger.warn({ provider: e.provider, status: e.httpStatus }, e.message);
      // No HTTP status = rejected locally (bad signature, wrong order): the request is at fault, not Razorpay.
      if (!e.httpStatus) return AppException.validation([{ field: 'payment', message: e.message }], e.message);
      return new AppException(ERROR_CODES.PAYMENT_PROVIDER_ERROR, `Razorpay: ${e.message}`, HttpStatus.BAD_GATEWAY);
    }
    return e;
  }

  // ── fulfilment ────────────────────────────────────────────
  /** Applies a provider-verified payment state. Safe to call repeatedly and in any order. */
  async applyPaymentResult(paymentId: string, r: NormalizedPayment) {
    const payment = await this.db.payment.findFirst({ where: { id: paymentId }, include: { order: true } });
    if (!payment) return 'missing';
    if (payment.status === 'CAPTURED' || payment.status === 'REFUNDED' || payment.status === 'PARTIALLY_REFUNDED') return 'already-captured';
    const order = payment.order;
    if (r.status === 'CAPTURED') {
      const expected = toMinor(order.totalAmount, order.currency);
      if (r.amountMinor !== expected || r.currency !== order.currency) {
        const reason = `Amount mismatch: expected ${fmtMoney(expected, order.currency)}, provider reported ${fmtMoney(r.amountMinor, r.currency)}`;
        await this.db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: reason, providerPaymentId: r.providerPaymentId ?? null, raw: r.raw as never } });
        await this.audit.record({ action: 'payment.amount_mismatch', tenantId: order.tenantId, actorRealm: 'SYSTEM', targetType: 'Payment', targetId: payment.id, after: { expected, reported: r.amountMinor, currency: r.currency } });
        this.logger.error({ paymentId: payment.id }, reason);
        return 'mismatch';
      }
      const tax = toMinor(order.taxAmount, order.currency);
      const q: Quote = { subtotal: toMinor(order.subtotalAmount, order.currency), discount: toMinor(order.discountAmount, order.currency), tax, total: expected, net: expected - tax };
      return (await this.fulfil(order.id, { paymentId: payment.id, result: r }, q)) ? 'fulfilled' : 'already-paid';
    }
    if (r.status === 'FAILED') {
      await this.db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', providerPaymentId: r.providerPaymentId ?? null, failureReason: r.failureReason ?? 'Payment failed', method: r.method ?? null, raw: r.raw as never } });
      await this.db.order.updateMany({ where: { id: order.id, status: { in: ['PENDING', 'PAYMENT_INITIATED'] } }, data: { status: 'FAILED', failureReason: r.failureReason ?? 'Payment failed' } });
      return 'failed';
    }
    return 'pending';
  }

  private async grantInTx(tx: Tx, userId: string, courseId: string) {
    const course = await tx.course.findFirst({ where: { id: courseId } });
    if (!course) return;
    const start = new Date();
    const expiresAt = enrollmentExpiry(course, start);
    const existing = await tx.enrollment.findFirst({ where: { userId, courseId } });
    if (existing) {
      if (isEnrollmentUsable(existing)) return;
      await tx.enrollment.update({ where: { id: existing.id }, data: { status: 'ACTIVE', startedAt: start, expiresAt, source: 'PURCHASE', grantedById: null } });
      return;
    }
    await tx.enrollment.create({ data: { userId, courseId, source: 'PURCHASE', expiresAt } as never });
  }

  /** Returns false when another path already fulfilled the order. */
  private async fulfil(orderId: string, paid: { paymentId: string; result: NormalizedPayment } | null, q: Quote, opts: { offline?: { mode: string; reference: string | null }; notify?: boolean } = {}): Promise<boolean> {
    const tenantId = this.ctx.requireTenantId();
    const ent = await this.entitlements.get(tenantId);
    const commissionPct = ent.features[FEATURES.COMMISSION_PERCENT.key]?.limit ?? 0;
    const { tenant, origin, business } = await this.academy(tenantId);
    const now = new Date();

    const done = await this.db.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({ where: { id: orderId, status: { in: [...PAYABLE] } }, data: { status: 'PAID', paidAt: now, failureReason: null } });
      if (!claimed.count) return null;
      const order = await tx.order.findFirstOrThrow({ where: { id: orderId }, include: { items: true } });
      const cur = order.currency;
      const fee = paid?.result.feeMinor ?? null;
      if (paid) {
        await tx.payment.update({
          where: { id: paid.paymentId },
          data: { status: 'CAPTURED', providerPaymentId: paid.result.providerPaymentId ?? null, method: paid.result.method ?? null, feeAmount: fee === null ? null : fromMinor(fee, cur), capturedAt: now, failureReason: null, raw: paid.result.raw as never },
        });
      }
      const granted = grantedCourses(order.items);
      for (const courseId of granted) await this.grantInTx(tx, order.userId, courseId);
      for (const item of order.items) if (item.membershipPlanId) await this.memberships.applyPurchase(tx, order.userId, item.membershipPlanId, order.id, now);
      const tickets: { code: string; liveClassId: string }[] = [];
      for (const item of order.items) {
        if (!item.liveClassId) continue;
        // Paid webinar ticket: one registration per buyer (a cancelled one is re-issued with a new link).
        const buyer = await tx.user.findUniqueOrThrow({ where: { id: order.userId }, select: { email: true, fullName: true } });
        const email = buyer.email.toLowerCase();
        const code = randomBytes(12).toString('base64url');
        const prior = await tx.webinarRegistration.findFirst({ where: { liveClassId: item.liveClassId, email } });
        if (prior && !prior.cancelledAt) { tickets.push({ code: prior.ticketCode, liveClassId: item.liveClassId }); continue; }
        if (prior) await tx.webinarRegistration.update({ where: { id: prior.id }, data: { cancelledAt: null, orderId: order.id, userId: order.userId, ticketCode: code } });
        else await tx.webinarRegistration.create({ data: { liveClassId: item.liveClassId, name: ((order.billing as Record<string, string | null>).name || buyer.fullName).slice(0, 120), email, userId: order.userId, ticketCode: code, orderId: order.id } as never });
        tickets.push({ code, liveClassId: item.liveClassId });
      }
      // Bought items leave the cart (also courses now unlocked through a bundle).
      const bundles = order.items.map((i) => i.bundleId).filter((x): x is string => Boolean(x));
      const products = order.items.map((i) => i.digitalProductId).filter((x): x is string => Boolean(x));
      for (const pid of products) await this.digital.grant(tx, order.userId, pid, 'PURCHASE', order.id);
      for (const item of order.items) if (item.coachingProgramId) await this.coaching.grant(tx, order.userId, item.coachingProgramId, 'PURCHASE', order.id);
      await tx.cartItem.deleteMany({ where: { userId: order.userId, OR: [{ courseId: { in: granted } }, ...(bundles.length ? [{ bundleId: { in: bundles } }] : []), ...(products.length ? [{ digitalProductId: { in: products } }] : [])] } });
      if (order.couponId) {
        await tx.couponRedemption.create({ data: { couponId: order.couponId, orderId: order.id, userId: order.userId, amount: order.discountAmount } as never });
        await tx.coupon.update({ where: { id: order.couponId }, data: { redemptionCount: { increment: 1 } } });
      }
      if (q.total > 0) {
        const commission = commissionMinor(q.net, commissionPct);
        const entries: { type: string; amount: number; description: string }[] = [{ type: 'SALE', amount: q.total, description: `Order ${order.number}` }];
        if (q.tax) entries.push({ type: 'TAX', amount: -q.tax, description: `GST ${order.taxRate?.toString() ?? ''}%` });
        if (fee) entries.push({ type: 'GATEWAY_FEE', amount: -fee, description: 'Razorpay fee (incl. GST)' });
        if (commission) entries.push({ type: 'PLATFORM_COMMISSION', amount: -commission, description: `Platform commission ${commissionPct}%` });
        const conversion = await this.affiliates.recordConversion(tx, { ...order, paidAt: now });
        if (conversion) entries.push({ type: 'AFFILIATE_COMMISSION', amount: -toMinor(conversion.commission, cur), description: `Affiliate commission ${Number(conversion.percent)}%` });
        for (const e of entries) await tx.ledgerEntry.create({ data: { orderId: order.id, type: e.type, amount: e.amount < 0 ? `-${fromMinor(-e.amount, cur)}` : fromMinor(e.amount, cur), currency: cur, description: e.description } as never });
      }
      if (business && !business.invoicesEnabled) return { order, invoice: null, tickets };
      const fy = financialYear(now);
      const seq = await nextSequence(tx, tenantId, `invoice:${fy}`);
      const prefix = business?.invoicePrefix || 'INV';
      const billing = order.billing as Record<string, string | null>;
      const zeroRated = Boolean(business?.exportsUnderLut && billing.country && billing.country !== 'IN' && Number(order.taxAmount) === 0 && order.taxRate !== null);
      const invoice = await tx.invoice.create({
        data: {
          orderId: order.id, number: invoiceNumber(prefix, fy, business?.invoiceStartNumber ?? 1, seq), issuedAt: now,
          seller: {
            name: business?.legalName || tenant.name, address: [business?.addressLine1, business?.addressLine2, business?.city, business?.state, business?.postalCode, business?.country].filter(Boolean).join(', '),
            gstin: business?.gstRegistered ? business?.gstin ?? null : null, pan: business?.pan ?? null, state: business?.state ?? null,
            details: business?.taxDetails ?? null, note: business?.invoiceNote ?? null,
          },
          buyer: billing,
          lines: [
            ...order.items.map((i) => ({ description: i.title, quantity: 1, unitAmount: i.unitAmount.toString(), discountAmount: i.discountAmount.toString(), totalAmount: i.totalAmount.toString() })),
            ...(Number(order.transactionFeeAmount) > 0 ? [{ description: 'Transaction fee (payment gateway charges)', quantity: 1, unitAmount: order.transactionFeeAmount.toString(), discountAmount: '0', totalAmount: order.transactionFeeAmount.toString() }] : []),
          ],
          totals: { currency: cur, subtotal: order.subtotalAmount.toString(), discount: order.discountAmount.toString(), tax: order.taxAmount.toString(), taxRate: order.taxRate?.toString() ?? null, taxInclusive: order.taxInclusive, total: order.totalAmount.toString(), zeroRated, paidVia: paid ? `Razorpay ${paid.result.method ?? ''}`.trim() : opts.offline ? OFFLINE_LABEL[opts.offline.mode] ?? 'Offline payment' : 'Free (100% discount)', paymentId: paid?.result.providerPaymentId ?? opts.offline?.reference ?? null },
        } as never,
      });
      return { order, invoice, tickets };
    }, { timeout: 20_000 });

    if (!done) return false;
    const { order } = done;
    await this.afterPaid(order).catch((e) => this.logger.warn({ err: (e as Error).message, orderId: order.id }, 'funnel bookkeeping failed'));
    const billing = order.billing as Record<string, string | null>;
    await this.audit.record({ action: 'order.paid', tenantId, actorRealm: 'SYSTEM', targetType: 'Order', targetId: order.id, after: { number: order.number, total: order.totalAmount.toString(), paymentId: paid?.result.providerPaymentId ?? null } });
    await this.events.emit('order.paid', { tenantId, userId: order.userId, orderId: order.id, courseIds: grantedCourses(order.items), total: order.totalAmount.toString(), currency: order.currency });
    await this.notifications.notify({ userId: order.userId, tenantId, category: 'orders', title: 'Purchase confirmed', body: `You now have access to ${order.items.map((i) => i.title).join(', ')}.`, link: '/learn', brand: tenant.name, skipEmail: true }).catch(() => undefined);
    if (billing.email && opts.notify !== false) {
      await this.mail.send({
        to: billing.email, tenantId, tag: 'purchase-receipt',
        ...emailTemplates.purchaseReceipt({ brand: tenant.name, name: billing.name ?? '', orderNumber: order.number, items: order.items.map((i) => i.title), total: fmtMoney(q.total, order.currency), url: `${origin}/learn` }),
      });
    }
    for (const t of done.tickets) await this.sendTicket(tenantId, order.userId, t.liveClassId, t.code, tenant.name, origin).catch((e) => this.logger.warn({ err: (e as Error).message }, 'webinar ticket email failed'));
    return true;
  }

  /** Upsells in the order count as accepted; reminded orders for the same items count as recovered. */
  private async afterPaid(order: { id: string; userId: string; recoveryStage: number; items: { courseId: string | null; bundleId: string | null; liveClassId: string | null; digitalProductId: string | null; coachingProgramId?: string | null; membershipPlanId: string | null; offerId: string | null; source: string | null }[] }) {
    await this.funnel.markAccepted(order.userId, order.items);
    const match = order.items.map((i) => (i.coachingProgramId ? { coachingProgramId: i.coachingProgramId } : i.bundleId ? { bundleId: i.bundleId } : i.liveClassId ? { liveClassId: i.liveClassId } : i.digitalProductId ? { digitalProductId: i.digitalProductId } : i.membershipPlanId ? { membershipPlanId: i.membershipPlanId } : { courseId: i.courseId }));
    const now = new Date();
    const earlier = await this.db.order.updateMany({
      where: { userId: order.userId, id: { not: order.id }, recoveryStage: { gt: 0, lt: RECOVERY_DONE }, recoveredAt: null, status: { in: [...UNPAID, 'CANCELLED'] }, createdAt: { gte: new Date(now.getTime() - 14 * 86_400_000) }, items: { some: { OR: match } } },
      data: { recoveredAt: now, recoveredByOrderId: order.id },
    });
    if (!earlier.count && order.recoveryStage > 0 && order.recoveryStage < RECOVERY_DONE) await this.db.order.update({ where: { id: order.id }, data: { recoveredAt: now, recoveredByOrderId: order.id } });
  }

  /** Emails the personal join link of a paid webinar ticket. */
  private async sendTicket(tenantId: string, userId: string, liveClassId: string, code: string, brand: string, origin: string) {
    const c = await this.db.liveClass.findFirst({ where: { id: liveClassId }, include: { sessions: { where: { status: { in: ['SCHEDULED', 'LIVE'] } }, orderBy: { startsAt: 'asc' }, take: 1 } } });
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true } });
    if (!c || !user) return;
    const when = c.sessions[0] ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeStyle: 'short', timeZone: c.timezone }).format(c.sessions[0].startsAt) : null;
    await this.mail.send({
      to: user.email, tenantId, tag: 'webinar-ticket',
      ...emailTemplates.billingNotice({
        brand, subject: `Your ticket: ${c.title}`, heading: 'Your webinar ticket',
        lines: [`Hi ${user.fullName},`, `Thanks for buying a ticket for “${c.title}”.`, ...(when ? [`Next session: ${when} (${c.timezone}).`] : []), 'Use your personal link below to join — it opens 15 minutes before the start. Please do not share it.'],
        cta: { label: 'Your join link', url: `${origin}/live/ticket/${code}` },
      }),
    });
  }

  /** Invoice PDF. Buyers see only their own orders (userId given); staff see any order of the academy. */
  async invoicePdf(orderId: string, userId?: string) {
    const o = await this.db.order.findFirst({ where: { id: orderId, ...(userId ? { userId } : {}) } });
    if (!o) throw AppException.notFound('Order not found');
    const inv = await this.db.invoice.findFirst({ where: { orderId: o.id } });
    if (!inv) {
      const b = await this.prisma.tenantBusinessProfile.findUnique({ where: { tenantId: o.tenantId }, select: { invoicesEnabled: true } });
      throw AppException.notFound(b && !b.invoicesEnabled && ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(o.status) ? 'This academy does not issue invoices for purchases.' : 'An invoice is issued once the order is paid');
    }
    const pdf = await renderInvoicePdf({
      number: inv.number, issuedAt: inv.issuedAt, orderNumber: o.number, seller: inv.seller as never, buyer: inv.buyer as never,
      lines: inv.lines as never, totals: inv.totals as never, refunded: o.refundedAmount.toString(),
    });
    return { pdf, filename: `${inv.number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf` };
  }

  // ── creator views ─────────────────────────────────────────
  async list(params: { status?: string; q?: string; courseId?: string; channel?: string; type?: string; from?: string; to?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const where: Record<string, unknown> = { status: params.status ? params.status : { notIn: ['CANCELLED'] } };
    if (params.q) {
      const q = params.q.trim();
      const users = await this.prisma.user.findMany({ where: { tenantId: this.ctx.requireTenantId(), OR: [{ email: { contains: q } }, { fullName: { contains: q } }] }, select: { id: true }, take: 200 });
      where.OR = [{ number: { contains: q.toUpperCase() } }, { userId: { in: users.map((u) => u.id) } }, { couponCode: { contains: q.toUpperCase() } }, { externalReference: { contains: q } }, { payments: { some: { providerPaymentId: { contains: q } } } }];
    }
    const items: Record<string, unknown>[] = [];
    if (params.courseId) items.push({ courseId: params.courseId });
    const TYPE: Record<string, Record<string, unknown>> = { course: { courseId: { not: null }, bundleId: null }, bundle: { bundleId: { not: null } }, membership: { membershipPlanId: { not: null } }, webinar: { liveClassId: { not: null } }, product: { digitalProductId: { not: null } }, coaching: { coachingProgramId: { not: null } } };
    if (params.type && TYPE[params.type]) items.push(TYPE[params.type]);
    if (items.length) where.items = { some: items.length === 1 ? items[0] : { AND: items } };
    if (params.channel === 'razorpay') where.provider = 'RAZORPAY';
    if (params.channel === 'offline') where.paymentMode = { in: [...OFFLINE_MODES] };
    if (params.channel === 'free') where.totalAmount = 0;
    if (params.from || params.to) {
      // Whole days, inclusive of `to`
      where.createdAt = { ...(params.from ? { gte: new Date(`${params.from}T00:00:00.000Z`) } : {}), ...(params.to ? { lt: new Date(new Date(`${params.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}) };
    }
    const [rows, total] = await Promise.all([
      this.db.order.findMany({ where, include: { items: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.db.order.count({ where }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, fullName: true, email: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return { items: rows.map((o) => ({ ...this.view(o), buyer: byId.get(o.userId) ?? null })), meta: { page, pageSize, total } };
  }

  /**
   * Records a payment the academy received outside the checkout (cash, bank transfer, direct UPI…):
   * a paid order for the learner at the amount received, fulfilled like any other (access, ledger,
   * invoice), with the mode and reference kept on the order.
   */
  async recordOffline(input: { itemKind: string; itemId: string; userId: string; mode: string; reference?: string | null; amount: number; sendEmail: boolean; affiliateCode?: string | null }, actorUserId: string) {
    const tenantId = this.ctx.requireTenantId();
    if (!OFFLINE_MODES.includes(input.mode as never)) throw AppException.validation([{ field: 'mode', message: 'Choose a payment mode' }]);
    const user = await this.prisma.user.findFirst({ where: { id: input.userId, tenantId, realm: 'TENANT', deletedAt: null } });
    if (!user) throw AppException.validation([{ field: 'userId', message: 'Choose a learner of your academy' }]);
    const base = await this.sellableItem(input.itemKind, input.itemId).catch((e) => {
      if (e instanceof AppException && /free/i.test(e.message)) throw AppException.conflict('This item is free — enrol the learner instead of recording a payment.');
      throw e;
    });
    const line: Line = { ...base, unitMinor: toMinor(input.amount, base.currency), couponable: false, passFee: false };
    const affiliateId = input.affiliateCode?.trim() ? await this.affiliates.attribute(input.affiliateCode.trim(), user.id) : null;
    if (input.affiliateCode?.trim() && !affiliateId) throw AppException.validation([{ field: 'affiliateCode', message: 'No active affiliate with this code (learners can’t refer themselves)' }]);
    await this.assertBuyable(user.id, [line]);
    const { tax, q, cur } = await this.price(user.id, [line], null, user.country);
    const ref = input.reference?.trim() || null;
    const order = await this.db.$transaction(async (tx) => {
      const n = await nextSequence(tx, tenantId, 'order');
      const o = await tx.order.create({
        data: {
          number: `ORD-${String(n).padStart(6, '0')}`, userId: user.id, currency: cur,
          subtotalAmount: fromMinor(q.subtotal, cur), discountAmount: '0', taxAmount: fromMinor(q.tax, cur), totalAmount: fromMinor(q.total, cur), taxRate: tax?.rate ?? null, taxInclusive: tax?.inclusive ?? true,
          billing: { name: user.fullName, email: user.email, phone: user.phone ?? null, country: user.country ?? null, state: null, gstin: null },
          paymentMode: input.mode, externalReference: ref, recordedById: actorUserId, affiliateId, expiresAt: new Date(Date.now() + ORDER_TTL_MS),
        } as never,
      });
      const kindRef = line.kind === 'course' ? { courseId: line.id } : line.kind === 'bundle' ? { bundleId: line.id } : line.kind === 'webinar' ? { liveClassId: line.id } : line.kind === 'product' ? { digitalProductId: line.id } : line.kind === 'coaching' ? { coachingProgramId: line.id } : { membershipPlanId: line.id };
      await tx.orderItem.create({ data: { orderId: o.id, ...kindRef, grantCourseIds: line.grant.length ? line.grant : undefined, title: line.title.slice(0, 200), unitAmount: fromMinor(q.lines[0].unit, cur), discountAmount: '0', totalAmount: fromMinor(q.lines[0].total, cur) } as never });
      return o;
    });
    await this.fulfil(order.id, null, q, { offline: { mode: input.mode, reference: ref }, notify: input.sendEmail });
    await this.audit.record({ action: 'order.offline_recorded', tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Order', targetId: order.id, after: { mode: input.mode, reference: ref, total: fromMinor(q.total, cur), item: `${line.kind}:${line.id}` } });
    return this.get(order.id);
  }

  // ── order comments and edits (academy) ──────────────────
  async comments(orderId: string) {
    await this.get(orderId);
    const rows = await this.db.orderComment.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, fullName: true } });
    return rows.map((r) => ({ id: r.id, body: r.body, createdAt: r.createdAt, author: users.find((u) => u.id === r.authorId)?.fullName ?? '' }));
  }

  async addComment(orderId: string, body: string, authorId: string) {
    await this.get(orderId);
    const text = body.trim();
    if (!text) throw AppException.validation([{ field: 'body', message: 'Write a comment' }]);
    await this.db.orderComment.create({ data: { orderId, authorId, body: text.slice(0, 2000) } as never });
    return this.comments(orderId);
  }

  /**
   * Edit order: the buyer's state, GSTIN and GST address (also updated on the invoice), and an
   * affiliate credited after the fact — only on a paid order that has no affiliate yet.
   */
  async editOrder(orderId: string, input: { state?: string | null; gstin?: string | null; gstAddress?: string | null; affiliateCode?: string | null }, actorUserId: string) {
    const o = await this.db.order.findFirst({ where: { id: orderId } });
    if (!o) throw AppException.notFound('Order not found');
    const billing = { ...(o.billing as Record<string, string | null>) };
    if (input.state !== undefined) billing.state = input.state?.trim() || null;
    if (input.gstin !== undefined) billing.gstin = input.gstin?.trim().toUpperCase() || null;
    if (input.gstAddress !== undefined) billing.address = input.gstAddress?.trim() || null;
    let affiliateId: string | null = null;
    if (input.affiliateCode) {
      if (o.affiliateId) throw AppException.conflict('This order already credits an affiliate.');
      if (!['PAID', 'PARTIALLY_REFUNDED'].includes(o.status)) throw AppException.conflict('Affiliates can be added to paid orders only.');
      affiliateId = await this.affiliates.attribute(input.affiliateCode, o.userId);
      if (!affiliateId) throw AppException.validation([{ field: 'affiliateCode', message: 'No active affiliate with this code (buyers can’t refer themselves)' }]);
    }
    await this.db.$transaction(async (tx) => {
      const u = await tx.order.update({ where: { id: orderId }, data: { billing: billing as never, ...(affiliateId ? { affiliateId } : {}) } });
      const inv = await tx.invoice.findFirst({ where: { orderId } });
      if (inv) await tx.invoice.update({ where: { id: inv.id }, data: { buyer: { ...(inv.buyer as Record<string, unknown>), state: billing.state, gstin: billing.gstin, address: billing.address ?? null } as never } });
      if (affiliateId && u.paidAt) {
        const conv = await this.affiliates.recordConversion(tx, { ...u, paidAt: u.paidAt });
        if (conv) await tx.ledgerEntry.create({ data: { orderId, type: 'AFFILIATE_COMMISSION', amount: `-${fromMinor(toMinor(conv.commission, u.currency), u.currency)}`, currency: u.currency, description: `Affiliate commission ${Number(conv.percent)}% (added later)` } as never });
      }
    });
    await this.audit.record({ action: 'order.edit', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Order', targetId: orderId, after: input as never });
    return this.get(orderId);
  }

  async get(id: string) {
    const o = await this.db.order.findFirst({ where: { id }, include: { items: true, payments: { orderBy: { createdAt: 'desc' } }, refunds: { orderBy: { createdAt: 'desc' } } } });
    if (!o) throw AppException.notFound('Order not found');
    const [buyer, invoice, ledger] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: o.userId }, select: { id: true, fullName: true, email: true, phone: true } }),
      this.db.invoice.findFirst({ where: { orderId: o.id }, select: { number: true } }),
      this.db.ledgerEntry.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { ...this.view(o), buyer, invoiceNumber: invoice?.number ?? null, ledger: ledger.map((l) => ({ type: l.type, amount: l.amount.toString(), description: l.description, createdAt: l.createdAt })) };
  }

  async payments(params: { status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const where = params.status ? { status: params.status as never } : {};
    const [rows, total] = await Promise.all([
      this.db.payment.findMany({ where, include: { order: { select: { number: true, userId: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.db.payment.count({ where }),
    ]);
    return {
      items: rows.map((p) => ({
        id: p.id, orderId: p.orderId, orderNumber: p.order.number, provider: p.provider, providerOrderId: p.providerOrderId, providerPaymentId: p.providerPaymentId,
        status: p.status, amount: p.amount.toString(), currency: p.currency, method: p.method, feeAmount: p.feeAmount?.toString() ?? null, failureReason: p.failureReason, capturedAt: p.capturedAt, createdAt: p.createdAt,
      })),
      meta: { page, pageSize, total },
    };
  }

  /** Revenue summary from the ledger (per currency) for the creator dashboard and orders page. */
  async summary(from?: Date, to?: Date) {
    const createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
    const [byType, paidOrders, refundsPending] = await Promise.all([
      this.db.ledgerEntry.groupBy({ by: ['type', 'currency'], where: { createdAt }, _sum: { amount: true } }),
      this.db.order.count({ where: { status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, paidAt: createdAt } }),
      this.db.refund.count({ where: { status: 'PENDING' } }),
    ]);
    const currencies: Record<string, Record<string, string>> = {};
    for (const r of byType) {
      currencies[r.currency] ??= {};
      currencies[r.currency][r.type] = r._sum.amount?.toString() ?? '0';
    }
    const totals = Object.entries(currencies).map(([currency, t]) => {
      const n = (k: string) => Number(t[k] ?? 0);
      const gross = n('SALE');
      const refunds = -n('REFUND');
      const tax = -(n('TAX') + n('TAX_REVERSAL'));
      const fees = -n('GATEWAY_FEE');
      const commission = -(n('PLATFORM_COMMISSION') + n('COMMISSION_REVERSAL'));
      const affiliate = -(n('AFFILIATE_COMMISSION') + n('AFFILIATE_REVERSAL'));
      return { currency, gross: gross.toFixed(2), refunds: refunds.toFixed(2), tax: tax.toFixed(2), gatewayFees: fees.toFixed(2), platformCommission: commission.toFixed(2), affiliateCommission: affiliate.toFixed(2), net: (gross - refunds - tax - fees - commission - affiliate).toFixed(2) };
    });
    return { paidOrders, refundsPending, totals };
  }

  // ── refunds ───────────────────────────────────────────────
  async refund(orderId: string, input: { amount?: number; reason?: string | null; revokeAccess?: boolean }, actorUserId: string) {
    const lockKey = `lock:refund:${orderId}`;
    if (!(await this.redis.set(lockKey, '1', 'EX', 60, 'NX'))) throw AppException.conflict('Another refund for this order is in progress.');
    try {
      const o = await this.db.order.findFirst({ where: { id: orderId }, include: { payments: { where: { status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } } }, refunds: { where: { status: { in: ['PENDING', 'PROCESSED'] } } } } });
      if (!o) throw AppException.notFound('Order not found');
      const payment = o.payments[0];
      if (!payment || !['PAID', 'PARTIALLY_REFUNDED'].includes(o.status)) throw AppException.conflict('Only paid online orders can be refunded.');
      const total = toMinor(o.totalAmount, o.currency);
      const reserved = o.refunds.reduce((s, r) => s + toMinor(r.amount, o.currency), 0);
      const available = total - reserved;
      const amount = input.amount !== undefined ? toMinor(input.amount, o.currency) : available;
      if (amount <= 0 || amount > available) throw AppException.validation([{ field: 'amount', message: `You can refund up to ${fmtMoney(available, o.currency)}` }]);
      const account = await this.gateways.credentialsById(payment.gatewayAccountId);
      if (!account) throw AppException.integrationNotConfigured('Razorpay');
      const refund = await this.db.refund.create({
        data: { orderId: o.id, paymentId: payment.id, amount: fromMinor(amount, o.currency), reason: input.reason?.trim() || null, revokeAccess: Boolean(input.revokeAccess) && amount === available && reserved === 0, requestedById: actorUserId } as never,
      });
      await this.audit.record({ action: 'refund.request', tenantId: o.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Order', targetId: o.id, after: { refundId: refund.id, amount: fromMinor(amount, o.currency), revokeAccess: refund.revokeAccess } });
      try {
        const r = await this.providers.get('RAZORPAY').refund(account.creds, { providerOrderId: payment.providerOrderId, providerPaymentId: payment.providerPaymentId, currency: payment.currency }, amount, refund.id, input.reason);
        await this.db.refund.update({ where: { id: refund.id }, data: { providerRefundId: r.providerRefundId } });
        await this.applyRefundStatus(refund.id, r.status);
      } catch (e) {
        const msg = e instanceof ProviderError ? e.message : 'Could not reach Razorpay';
        await this.db.refund.update({ where: { id: refund.id }, data: { status: 'FAILED', failureReason: msg.slice(0, 500) } });
        throw this.providerFailure(e);
      }
      return this.get(o.id);
    } finally {
      await this.redis.del(lockKey);
    }
  }

  async applyRefundStatus(refundId: string, status: 'PENDING' | 'PROCESSED' | 'FAILED') {
    if (status === 'PENDING') return 'pending';
    if (status === 'FAILED') {
      await this.db.refund.updateMany({ where: { id: refundId, status: 'PENDING' }, data: { status: 'FAILED', failureReason: 'Razorpay could not process the refund' } });
      return 'failed';
    }
    const done = await this.db.$transaction(async (tx) => {
      const claimed = await tx.refund.updateMany({ where: { id: refundId, status: 'PENDING' }, data: { status: 'PROCESSED', processedAt: new Date() } });
      if (!claimed.count) return null;
      const r = await tx.refund.findFirstOrThrow({ where: { id: refundId }, include: { order: { include: { items: true } } } });
      const o = r.order;
      const cur = o.currency;
      const amount = toMinor(r.amount, cur);
      const total = toMinor(o.totalAmount, cur);
      const refunded = toMinor(o.refundedAmount, cur) + amount;
      const full = refunded >= total;
      await tx.order.update({ where: { id: o.id }, data: { refundedAmount: fromMinor(refunded, cur), status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      await tx.payment.update({ where: { id: r.paymentId }, data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      const commissionRows = await tx.ledgerEntry.findMany({ where: { orderId: o.id, type: 'PLATFORM_COMMISSION' } });
      const commission = commissionRows.reduce((s, l) => s + toMinor(l.amount, cur), 0) * -1;
      const taxBack = proportional(toMinor(o.taxAmount, cur), amount, total);
      const commissionBack = proportional(commission, amount, total);
      const neg = (m: number) => `-${fromMinor(m, cur)}`;
      await tx.ledgerEntry.create({ data: { orderId: o.id, refundId: r.id, type: 'REFUND', amount: neg(amount), currency: cur, description: `Refund for ${o.number}` } as never });
      if (taxBack) await tx.ledgerEntry.create({ data: { orderId: o.id, refundId: r.id, type: 'TAX_REVERSAL', amount: fromMinor(taxBack, cur), currency: cur, description: 'GST on refunded amount' } as never });
      if (commissionBack) await tx.ledgerEntry.create({ data: { orderId: o.id, refundId: r.id, type: 'COMMISSION_REVERSAL', amount: fromMinor(commissionBack, cur), currency: cur, description: 'Commission on refunded amount' } as never });
      const conv = await tx.affiliateConversion.findFirst({ where: { orderId: o.id } });
      if (conv && conv.status !== 'REVERSED' && conv.status !== 'PAID') {
        const before = toMinor(conv.commission, cur);
        const after = await this.affiliates.adjustForRefund(tx, o.id, refunded, total);
        const now2 = after && 'commission' in after ? toMinor(after.commission, cur) : before;
        if (before - now2 > 0) await tx.ledgerEntry.create({ data: { orderId: o.id, refundId: r.id, type: 'AFFILIATE_REVERSAL', amount: fromMinor(before - now2, cur), currency: cur, description: 'Affiliate commission on refunded amount' } as never });
      }
      if (r.revokeAccess && full) {
        await tx.enrollment.updateMany({ where: { userId: o.userId, courseId: { in: grantedCourses(o.items) }, source: 'PURCHASE' }, data: { status: 'REVOKED' } });
        for (const i of o.items) if (i.membershipPlanId) await this.memberships.revokeForRefund(tx, o.userId, i.membershipPlanId);
        await tx.webinarRegistration.updateMany({ where: { orderId: o.id, cancelledAt: null }, data: { cancelledAt: new Date() } });
        await tx.digitalProductAccess.updateMany({ where: { orderId: o.id, revokedAt: null }, data: { revokedAt: new Date() } });
        const coachingAccess = await tx.coachingAccess.findMany({ where: { orderId: o.id, revokedAt: null }, select: { id: true } });
        if (coachingAccess.length) {
          await tx.coachingAccess.updateMany({ where: { id: { in: coachingAccess.map((a) => a.id) } }, data: { revokedAt: new Date() } });
          await tx.coachingBooking.updateMany({ where: { accessId: { in: coachingAccess.map((a) => a.id) }, status: 'BOOKED', startsAt: { gt: new Date() } }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'REFUND' } });
        }
      }
      return { r, o, amount };
    });
    if (!done) return 'already-processed';
    const billing = done.o.billing as Record<string, string | null>;
    const { tenant } = await this.academy(done.o.tenantId);
    await this.audit.record({ action: 'refund.processed', tenantId: done.o.tenantId, actorRealm: 'SYSTEM', targetType: 'Order', targetId: done.o.id, after: { refundId: done.r.id, amount: done.r.amount.toString() } });
    await this.notifications.notify({ userId: done.o.userId, tenantId: done.o.tenantId, category: 'orders', title: 'Refund processed', body: `${fmtMoney(done.amount, done.o.currency)} for order ${done.o.number} is on its way.`, link: `/learn/orders/${done.o.id}`, brand: tenant.name, skipEmail: true }).catch(() => undefined);
    if (billing.email) {
      await this.mail.send({ to: billing.email, tenantId: done.o.tenantId, tag: 'refund-issued', ...emailTemplates.refundIssued({ brand: tenant.name, name: billing.name ?? '', orderNumber: done.o.number, amount: fmtMoney(done.amount, done.o.currency), accessRevoked: done.r.revokeAccess }) });
    }
    return 'processed';
  }

  // ── reconciliation (worker) ───────────────────────────────
  /**
   * Re-reads unsettled payments and refunds from Razorpay so missed webhooks or closed browser
   * tabs never leave a buyer charged without access. Runs across tenants, each in its own context.
   */
  async reconcile(now = new Date()) {
    const stats = { payments: 0, fulfilled: 0, refunds: 0, expired: 0, errors: 0 };
    const stalePayments = await this.prisma.payment.findMany({
      where: { status: 'CREATED', createdAt: { lt: new Date(now.getTime() - 5 * 60_000), gt: new Date(now.getTime() - 3 * 86_400_000) } },
      select: { id: true, tenantId: true, gatewayAccountId: true, providerOrderId: true, currency: true }, take: 200,
    });
    for (const p of stalePayments) {
      try {
        const account = await this.gateways.credentialsById(p.gatewayAccountId);
        if (!account) continue;
        const r = await this.providers.get('RAZORPAY').fetchPayment(account.creds, { providerOrderId: p.providerOrderId, currency: p.currency });
        const outcome = await this.ctx.run(p.tenantId, () => this.applyPaymentResult(p.id, r));
        stats.payments++;
        if (outcome === 'fulfilled') stats.fulfilled++;
      } catch (e) {
        stats.errors++;
        this.logger.warn({ paymentId: p.id, err: (e as Error).message }, 'reconcile payment failed');
      }
    }
    const pendingRefunds = await this.prisma.refund.findMany({
      where: { status: 'PENDING', providerRefundId: { not: null }, createdAt: { lt: new Date(now.getTime() - 2 * 60_000) } },
      include: { payment: { select: { gatewayAccountId: true } } }, take: 200,
    });
    for (const r of pendingRefunds) {
      try {
        const account = await this.gateways.credentialsById(r.payment.gatewayAccountId);
        if (!account) continue;
        const s = await this.providers.get('RAZORPAY').fetchRefund(account.creds, r.providerRefundId!);
        await this.ctx.run(r.tenantId, () => this.applyRefundStatus(r.id, s.status));
        stats.refunds++;
      } catch (e) {
        stats.errors++;
        this.logger.warn({ refundId: r.id, err: (e as Error).message }, 'reconcile refund failed');
      }
    }
    // Unpaid orders past their window stop accepting payment attempts (a late capture still fulfils).
    const expired = await this.prisma.order.updateMany({ where: { status: { in: ['PENDING', 'PAYMENT_INITIATED', 'FAILED'] }, expiresAt: { lt: now } }, data: { status: 'EXPIRED' } });
    stats.expired = expired.count;
    return stats;
  }
}
