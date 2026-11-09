import { Inject, Injectable } from '@nestjs/common';
import type { PaymentLink, SalesOffer } from '../../generated/prisma/client.js';
import { AppException } from '../../common/errors/app-exception.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';

export type ItemKind = 'course' | 'bundle' | 'product' | 'webinar' | 'membership';
export const OFFER_ITEM_KINDS = ['course', 'bundle', 'product'] as const;
export const LINK_ITEM_KINDS = ['course', 'bundle', 'product', 'webinar', 'membership'] as const;

/** "kind:id" — how offers name the purchases that trigger them. */
export const itemKey = (kind: string, id: string) => `${kind}:${id}`;

export function orderItemKey(i: { courseId?: string | null; bundleId?: string | null; digitalProductId?: string | null; liveClassId?: string | null; membershipPlanId?: string | null }) {
  if (i.bundleId) return itemKey('bundle', i.bundleId);
  if (i.digitalProductId) return itemKey('product', i.digitalProductId);
  if (i.liveClassId) return itemKey('webinar', i.liveClassId);
  if (i.membershipPlanId) return itemKey('membership', i.membershipPlanId);
  return itemKey('course', i.courseId ?? '');
}

/** Upsell answers that close the offer for that order. CHECKOUT = the buyer started paying for it. */
const FINAL_DECISIONS = ['ACCEPTED', 'DECLINED'];

export function triggered(offer: Pick<SalesOffer, 'triggers'>, keys: string[]) {
  const t = Array.isArray(offer.triggers) ? (offer.triggers as string[]) : [];
  return t.length === 0 || keys.some((k) => t.includes(k));
}

/**
 * Sales-funnel rules used by checkout: payment links, order bumps and post-purchase upsells.
 * Prices and eligibility are always decided here on the server, never taken from the browser.
 */
@Injectable()
export class FunnelService {
  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient) {}

  /** An open payment link, or a clear reason why it can't be used. */
  async link(code: string): Promise<PaymentLink> {
    const link = await this.db.paymentLink.findFirst({ where: { code: code.trim().toUpperCase() } });
    if (!link || !link.isActive) throw AppException.notFound('This payment link is not active');
    if (link.expiresAt && link.expiresAt <= new Date()) throw AppException.conflict('This payment link has expired');
    if (link.maxUses !== null && (await this.paidUses(link.id)) >= link.maxUses) throw AppException.conflict('This payment link has reached its limit');
    return link;
  }

  paidUses(linkId: string) {
    return this.db.order.count({ where: { paymentLinkId: linkId, paidAt: { not: null } } });
  }

  /** The coupon a payment-link checkout uses: the link's own unless the link allows buyer codes. */
  linkCoupon(link: PaymentLink | null, buyerCode?: string | null): string | null {
    const code = buyerCode?.trim() || null;
    if (!link) return code;
    if (link.allowCoupons) return code ?? link.couponCode;
    if (code && code.toUpperCase() !== link.couponCode?.toUpperCase()) throw AppException.validation([{ field: 'couponCode', message: 'Promo codes can’t be used with this payment link' }]);
    return link.couponCode;
  }

  /** Active bumps shown with these items (same currency, not already in the order). */
  async bumpOffers(keys: string[], currency: string) {
    const offers = await this.db.salesOffer.findMany({ where: { type: 'BUMP', status: 'ACTIVE', currency }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 20 });
    return offers.filter((o) => triggered(o, keys) && !keys.includes(itemKey(o.itemKind, o.itemId)));
  }

  /** The buyer's paid order whose upsell window is still open, or null. */
  private async sourceOrder(userId: string, orderId: string) {
    const order = await this.db.order.findFirst({ where: { id: orderId, userId, status: 'PAID' }, include: { items: true } });
    return order?.paidAt ? order : null;
  }

  /** Upsells still open after this order, best first. Ownership is checked by the caller. */
  async upsellsAfter(userId: string, orderId: string) {
    const order = await this.sourceOrder(userId, orderId);
    if (!order) return { order: null, offers: [] as SalesOffer[] };
    const keys = order.items.map(orderItemKey);
    const [offers, answered] = await Promise.all([
      this.db.salesOffer.findMany({ where: { type: 'UPSELL', status: 'ACTIVE', currency: order.currency }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 20 }),
      this.db.salesOfferResponse.findMany({ where: { sourceOrderId: order.id, decision: { in: FINAL_DECISIONS } }, select: { offerId: true } }),
    ]);
    const closed = new Set(answered.map((a) => a.offerId));
    const now = Date.now();
    const open = offers.filter((o) => !closed.has(o.id) && triggered(o, keys) && !keys.includes(itemKey(o.itemKind, o.itemId)) && order.paidAt!.getTime() + o.windowMinutes * 60_000 > now);
    return { order, offers: open };
  }

  /** The upsell being bought, re-checked at checkout time. */
  async upsell(userId: string, sourceOrderId: string, offerId: string) {
    const { order, offers } = await this.upsellsAfter(userId, sourceOrderId);
    if (!order) throw AppException.notFound('Order not found');
    const offer = offers.find((o) => o.id === offerId);
    if (!offer) throw AppException.conflict('This offer is no longer available');
    return offer;
  }

  async recordUpsellCheckout(userId: string, offerId: string, sourceOrderId: string) {
    const prior = await this.db.salesOfferResponse.findFirst({ where: { offerId, sourceOrderId } });
    if (prior) await this.db.salesOfferResponse.update({ where: { id: prior.id }, data: { decision: 'CHECKOUT' } });
    else await this.db.salesOfferResponse.create({ data: { offerId, sourceOrderId, userId, decision: 'CHECKOUT' } as never }).catch(() => undefined);
  }

  async decline(userId: string, sourceOrderId: string, offerId: string) {
    const order = await this.db.order.findFirst({ where: { id: sourceOrderId, userId }, select: { id: true } });
    if (!order) throw AppException.notFound('Order not found');
    if (!(await this.db.salesOffer.findFirst({ where: { id: offerId, type: 'UPSELL' }, select: { id: true } }))) throw AppException.notFound('Offer not found');
    const prior = await this.db.salesOfferResponse.findFirst({ where: { offerId, sourceOrderId } });
    if (prior?.decision === 'ACCEPTED') return { decision: 'ACCEPTED' };
    if (prior) await this.db.salesOfferResponse.update({ where: { id: prior.id }, data: { decision: 'DECLINED' } });
    else await this.db.salesOfferResponse.create({ data: { offerId, sourceOrderId, userId, decision: 'DECLINED' } as never });
    return { decision: 'DECLINED' };
  }

  /** After payment: upsells in the order count as accepted. */
  async markAccepted(userId: string, items: { offerId: string | null; source: string | null }[]) {
    const offerIds = items.filter((i) => i.source === 'UPSELL' && i.offerId).map((i) => i.offerId!);
    if (offerIds.length) await this.db.salesOfferResponse.updateMany({ where: { userId, offerId: { in: offerIds }, decision: 'CHECKOUT' }, data: { decision: 'ACCEPTED' } });
  }
}
