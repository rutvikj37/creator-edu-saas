import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { FunnelService, LINK_ITEM_KINDS, OFFER_ITEM_KINDS } from '../commerce/funnel.service.js';
import { OrdersService } from '../commerce/orders.service.js';
import { fromMinor, toMinor } from '../commerce/providers/money.js';
import { academyOrigin } from '../tenants/academy-origin.js';
import { parseTracking, TRACKING_KEY, TRACKING_PATTERNS, type TrackingSettings } from './tracking.js';

/** Same alphabet as coupon codes: no 0/O or 1/I/L. */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomCode = (n = 8) => Array.from({ length: n }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');

export interface OfferInput {
  type: 'BUMP' | 'UPSELL';
  status?: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  name: string;
  headline: string;
  description?: string | null;
  itemKind: string;
  itemId: string;
  priceAmount: number;
  triggers?: string[] | null;
  windowMinutes?: number;
  sortOrder?: number;
}

export interface LinkInput {
  code?: string;
  title: string;
  itemKind: string;
  itemId: string;
  priceAmount?: number | null;
  couponCode?: string | null;
  allowCoupons?: boolean;
  maxUses?: number | null;
  expiresAt?: string | null;
  isActive?: boolean;
  note?: string | null;
}

/** Academy-side management of upsells, order bumps, payment links and ad-tracking IDs. */
@Injectable()
export class SalesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly orders: OrdersService,
    private readonly funnel: FunnelService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  /** Everything the academy can sell, for the offer and link pickers. */
  async items() {
    const [courses, bundles, products, webinars, plans] = await Promise.all([
      this.db.course.findMany({ where: { deletedAt: null, status: 'PUBLISHED', isFree: false, visibility: { not: 'PRIVATE' } }, select: { id: true, title: true, priceAmount: true, currency: true }, orderBy: { title: 'asc' } }),
      this.db.bundle.findMany({ where: { status: 'PUBLISHED' }, select: { id: true, title: true, priceAmount: true, currency: true }, orderBy: { title: 'asc' } }),
      this.db.digitalProduct.findMany({ where: { status: 'PUBLISHED', priceAmount: { gt: 0 } }, select: { id: true, title: true, priceAmount: true, currency: true }, orderBy: { title: 'asc' } }),
      this.db.liveClass.findMany({ where: { kind: 'WEBINAR', status: 'ACTIVE', priceAmount: { gt: 0 } }, select: { id: true, title: true, priceAmount: true, currency: true }, orderBy: { title: 'asc' } }),
      this.db.membershipPlan.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, priceAmount: true, currency: true }, orderBy: { name: 'asc' } }),
    ]);
    const m = (v: { toString(): string } | null) => (v === null ? null : v.toString());
    return [
      ...courses.filter((c) => c.priceAmount && Number(c.priceAmount) > 0).map((c) => ({ kind: 'course', id: c.id, title: c.title, price: m(c.priceAmount), currency: c.currency })),
      ...bundles.map((b) => ({ kind: 'bundle', id: b.id, title: b.title, price: m(b.priceAmount), currency: b.currency })),
      ...products.map((p) => ({ kind: 'product', id: p.id, title: p.title, price: m(p.priceAmount), currency: p.currency })),
      ...webinars.map((w) => ({ kind: 'webinar', id: w.id, title: w.title, price: m(w.priceAmount), currency: w.currency ?? 'INR' })),
      ...plans.map((p) => ({ kind: 'membership', id: p.id, title: `${p.name} membership`, price: m(p.priceAmount), currency: p.currency })),
    ];
  }

  private async sellable(kind: string, id: string) {
    try {
      return await this.orders.sellableItem(kind, id);
    } catch (e) {
      throw AppException.validation([{ field: 'itemId', message: `This item can’t be sold right now: ${(e as Error).message}` }]);
    }
  }

  /** Item titles for display, without requiring the item to still be on sale. */
  private async titles(refs: { itemKind: string; itemId: string }[]) {
    const ids = (k: string) => refs.filter((r) => r.itemKind === k).map((r) => r.itemId);
    const [c, b, p, w, m] = await Promise.all([
      this.db.course.findMany({ where: { id: { in: ids('course') } }, select: { id: true, title: true } }),
      this.db.bundle.findMany({ where: { id: { in: ids('bundle') } }, select: { id: true, title: true } }),
      this.db.digitalProduct.findMany({ where: { id: { in: ids('product') } }, select: { id: true, title: true } }),
      this.db.liveClass.findMany({ where: { id: { in: ids('webinar') } }, select: { id: true, title: true } }),
      this.db.membershipPlan.findMany({ where: { id: { in: ids('membership') } }, select: { id: true, name: true } }),
    ]);
    return new Map<string, string>([
      ...c.map((x) => [`course:${x.id}`, x.title] as [string, string]), ...b.map((x) => [`bundle:${x.id}`, x.title] as [string, string]),
      ...p.map((x) => [`product:${x.id}`, x.title] as [string, string]), ...w.map((x) => [`webinar:${x.id}`, x.title] as [string, string]),
      ...m.map((x) => [`membership:${x.id}`, `${x.name} membership`] as [string, string]),
    ]);
  }

  // ── offers (bumps & upsells) ──────────────────────────────
  async listOffers(type?: 'BUMP' | 'UPSELL') {
    const offers = await this.db.salesOffer.findMany({ where: { ...(type ? { type } : {}), status: { not: 'ARCHIVED' } }, orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] });
    const ids = offers.map((o) => o.id);
    const [sold, declined] = await Promise.all([
      ids.length ? this.db.orderItem.findMany({ where: { offerId: { in: ids }, order: { paidAt: { not: null } } }, select: { offerId: true, totalAmount: true } }) : [],
      ids.length ? this.db.salesOfferResponse.groupBy({ by: ['offerId'], where: { offerId: { in: ids }, decision: 'DECLINED' }, _count: { _all: true } }) : [],
    ]);
    const names = await this.titles([...offers, ...offers.flatMap((o) => ((o.triggers as string[] | null) ?? []).map((t) => ({ itemKind: t.split(':')[0], itemId: t.split(':')[1] })))]);
    return offers.map((o) => {
      const mine = sold.filter((s) => s.offerId === o.id);
      const triggers = (o.triggers as string[] | null) ?? [];
      return {
        ...o, priceAmount: o.priceAmount.toString(), triggers, itemTitle: names.get(`${o.itemKind}:${o.itemId}`) ?? 'Unavailable item',
        triggerTitles: triggers.map((t) => names.get(t) ?? 'Unavailable item'),
        accepted: mine.length, revenue: mine.reduce((s, x) => s + Number(x.totalAmount), 0).toFixed(2), declined: (declined as { offerId: string; _count: { _all: number } }[]).find((d) => d.offerId === o.id)?._count._all ?? 0,
      };
    });
  }

  private async offerData(dto: OfferInput) {
    if (!(OFFER_ITEM_KINDS as readonly string[]).includes(dto.itemKind)) throw AppException.validation([{ field: 'itemKind', message: 'Offer a course, bundle or digital product' }]);
    const line = await this.sellable(dto.itemKind, dto.itemId);
    const priceMinor = toMinor(String(dto.priceAmount), line.currency);
    if (priceMinor < (line.currency === 'INR' ? 100 : 1)) throw AppException.validation([{ field: 'priceAmount', message: 'Enter a price above zero' }]);
    if (priceMinor > line.unitMinor) throw AppException.validation([{ field: 'priceAmount', message: `The offer price can’t be above the regular price (${fromMinor(line.unitMinor, line.currency)})` }]);
    const triggers = await this.cleanTriggers(dto.triggers);
    if (triggers?.includes(`${dto.itemKind}:${dto.itemId}`)) throw AppException.validation([{ field: 'triggers', message: 'An item can’t trigger an offer for itself' }]);
    return {
      type: dto.type, status: dto.status ?? 'ACTIVE', name: dto.name.trim(), headline: dto.headline.trim(), description: dto.description?.trim() || null,
      itemKind: dto.itemKind, itemId: dto.itemId, priceAmount: fromMinor(priceMinor, line.currency), currency: line.currency,
      triggers: triggers ?? undefined, windowMinutes: dto.windowMinutes ?? 30, sortOrder: dto.sortOrder ?? 0,
    };
  }

  private async cleanTriggers(triggers?: string[] | null) {
    if (!triggers?.length) return null;
    const unique = [...new Set(triggers)];
    const names = await this.titles(unique.map((t) => ({ itemKind: t.split(':')[0], itemId: t.split(':')[1] ?? '' })));
    const unknown = unique.filter((t) => !names.has(t));
    if (unknown.length) throw AppException.validation([{ field: 'triggers', message: 'Some of the chosen purchases no longer exist' }]);
    return unique;
  }

  async createOffer(dto: OfferInput, userId: string) {
    const data = await this.offerData(dto);
    const o = await this.db.salesOffer.create({ data: { ...data, createdById: userId } as never });
    await this.audit.record({ action: 'sales_offer.create', tenantId: this.ctx.tenantId, actorUserId: userId, actorRealm: 'TENANT', targetType: 'SalesOffer', targetId: o.id, after: { type: o.type, item: `${o.itemKind}:${o.itemId}`, price: o.priceAmount.toString() } });
    return o;
  }

  async updateOffer(id: string, dto: OfferInput, userId: string) {
    const o = await this.db.salesOffer.findFirst({ where: { id } });
    if (!o) throw AppException.notFound('Offer not found');
    const data = await this.offerData({ ...dto, type: o.type });
    const updated = await this.db.salesOffer.update({ where: { id }, data: { ...data, triggers: data.triggers ?? (null as never) } as never });
    await this.audit.record({ action: 'sales_offer.update', tenantId: this.ctx.tenantId, actorUserId: userId, actorRealm: 'TENANT', targetType: 'SalesOffer', targetId: id, after: { status: updated.status, price: updated.priceAmount.toString() } });
    return updated;
  }

  async setOfferStatus(id: string, status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED') {
    const r = await this.db.salesOffer.updateMany({ where: { id }, data: { status } });
    if (!r.count) throw AppException.notFound('Offer not found');
    return { id, status };
  }

  /** Deletes an unused offer; one that has sold is archived to keep order history meaningful. */
  async removeOffer(id: string, userId: string) {
    const o = await this.db.salesOffer.findFirst({ where: { id } });
    if (!o) throw AppException.notFound('Offer not found');
    const used = await this.db.orderItem.count({ where: { offerId: id } });
    if (used) await this.db.salesOffer.update({ where: { id }, data: { status: 'ARCHIVED' } });
    else await this.db.salesOffer.delete({ where: { id } });
    await this.audit.record({ action: used ? 'sales_offer.archive' : 'sales_offer.delete', tenantId: this.ctx.tenantId, actorUserId: userId, actorRealm: 'TENANT', targetType: 'SalesOffer', targetId: id });
    return { removed: true, archived: Boolean(used) };
  }

  // ── payment links ─────────────────────────────────────────
  async listLinks() {
    const links = await this.db.paymentLink.findMany({ orderBy: { createdAt: 'desc' } });
    const ids = links.map((l) => l.id);
    const paid = ids.length ? await this.db.order.findMany({ where: { paymentLinkId: { in: ids }, paidAt: { not: null } }, select: { paymentLinkId: true, totalAmount: true } }) : [];
    const names = await this.titles(links);
    const { origin } = await academyOrigin(this.prisma, this.config, this.ctx.requireTenantId());
    const now = new Date();
    return links.map((l) => {
      const mine = paid.filter((p) => p.paymentLinkId === l.id);
      const state = !l.isActive ? 'DISABLED' : l.expiresAt && l.expiresAt <= now ? 'EXPIRED' : l.maxUses !== null && mine.length >= l.maxUses ? 'EXHAUSTED' : 'ACTIVE';
      return {
        ...l, priceAmount: l.priceAmount?.toString() ?? null, itemTitle: names.get(`${l.itemKind}:${l.itemId}`) ?? 'Unavailable item', url: `${origin}/pay/${l.code}`,
        uses: mine.length, revenue: mine.reduce((s, x) => s + Number(x.totalAmount), 0).toFixed(2), state,
      };
    });
  }

  private async linkData(dto: LinkInput) {
    if (!(LINK_ITEM_KINDS as readonly string[]).includes(dto.itemKind)) throw AppException.validation([{ field: 'itemKind', message: 'Unknown item type' }]);
    const line = await this.sellable(dto.itemKind, dto.itemId);
    let priceAmount: string | null = null;
    if (dto.priceAmount !== undefined && dto.priceAmount !== null) {
      if (dto.itemKind === 'membership') throw AppException.validation([{ field: 'priceAmount', message: 'Memberships are always sold at their plan price' }]);
      const minor = toMinor(String(dto.priceAmount), line.currency);
      if (minor < (line.currency === 'INR' ? 100 : 1)) throw AppException.validation([{ field: 'priceAmount', message: 'Enter a price above zero, or leave it empty to use the regular price' }]);
      priceAmount = fromMinor(minor, line.currency);
    }
    let couponCode: string | null = null;
    if (dto.couponCode?.trim()) {
      const c = await this.db.coupon.findFirst({ where: { code: dto.couponCode.trim().toUpperCase() } });
      if (!c) throw AppException.validation([{ field: 'couponCode', message: 'No promo code with this code' }]);
      couponCode = c.code;
    }
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) throw AppException.validation([{ field: 'expiresAt', message: 'Choose a time in the future' }]);
    return {
      title: dto.title.trim(), itemKind: dto.itemKind, itemId: dto.itemId, priceAmount, currency: line.currency, couponCode, allowCoupons: dto.allowCoupons ?? false,
      maxUses: dto.maxUses ?? null, expiresAt, isActive: dto.isActive ?? true, note: dto.note?.trim() || null,
    };
  }

  async createLink(dto: LinkInput, userId: string) {
    const data = await this.linkData(dto);
    let code = dto.code?.trim().toUpperCase();
    if (code) {
      if (!/^[A-Z0-9_-]{4,16}$/.test(code)) throw AppException.validation([{ field: 'code', message: '4–16 letters, digits, - or _' }]);
      if (await this.db.paymentLink.findFirst({ where: { code } })) throw AppException.validation([{ field: 'code', message: 'This code is already used by another link' }]);
    } else {
      do code = randomCode(); while (await this.db.paymentLink.findFirst({ where: { code } }));
    }
    const l = await this.db.paymentLink.create({ data: { ...data, code, createdById: userId } as never });
    await this.audit.record({ action: 'payment_link.create', tenantId: this.ctx.tenantId, actorUserId: userId, actorRealm: 'TENANT', targetType: 'PaymentLink', targetId: l.id, after: { code, item: `${l.itemKind}:${l.itemId}`, price: l.priceAmount?.toString() ?? null } });
    return (await this.listLinks()).find((x) => x.id === l.id);
  }

  async updateLink(id: string, dto: LinkInput, userId: string) {
    const l = await this.db.paymentLink.findFirst({ where: { id } });
    if (!l) throw AppException.notFound('Payment link not found');
    const data = await this.linkData(dto);
    await this.db.paymentLink.update({ where: { id }, data });
    await this.audit.record({ action: 'payment_link.update', tenantId: this.ctx.tenantId, actorUserId: userId, actorRealm: 'TENANT', targetType: 'PaymentLink', targetId: id, after: { price: data.priceAmount, active: data.isActive } });
    return (await this.listLinks()).find((x) => x.id === id);
  }

  /** Deletes an unused link; a link that has taken payments is switched off instead. */
  async removeLink(id: string, userId: string) {
    const l = await this.db.paymentLink.findFirst({ where: { id } });
    if (!l) throw AppException.notFound('Payment link not found');
    const used = await this.db.order.count({ where: { paymentLinkId: id } });
    if (used) await this.db.paymentLink.update({ where: { id }, data: { isActive: false } });
    else await this.db.paymentLink.delete({ where: { id } });
    await this.audit.record({ action: used ? 'payment_link.disable' : 'payment_link.delete', tenantId: this.ctx.tenantId, actorUserId: userId, actorRealm: 'TENANT', targetType: 'PaymentLink', targetId: id });
    return { removed: true, disabled: Boolean(used) };
  }

  /** What the buyer sees before signing in to pay. */
  async publicLink(code: string) {
    const link = await this.funnel.link(code);
    const line = await this.orders.sellableItem(link.itemKind, link.itemId);
    const custom = link.priceAmount !== null && link.currency === line.currency;
    return {
      code: link.code, title: link.title, note: link.note, kind: line.kind, itemId: line.id, itemTitle: line.title, slug: line.slug, currency: line.currency,
      price: custom ? link.priceAmount!.toString() : fromMinor(line.unitMinor, line.currency), regularPrice: fromMinor(line.unitMinor, line.currency),
      couponCode: link.couponCode, allowCoupons: link.allowCoupons, expiresAt: link.expiresAt,
    };
  }

  // ── ad tracking ───────────────────────────────────────────
  async tracking() {
    const row = await this.db.tenantSetting.findFirst({ where: { key: TRACKING_KEY } });
    return parseTracking(row?.value);
  }

  async saveTracking(input: Partial<Record<keyof TrackingSettings, string | null>>, userId: string) {
    const tenantId = this.ctx.requireTenantId();
    const errors: { field: string; message: string }[] = [];
    const value: TrackingSettings = { metaPixelId: null, ga4Id: null, gtmId: null };
    for (const k of Object.keys(TRACKING_PATTERNS) as (keyof TrackingSettings)[]) {
      const v = input[k]?.trim().toUpperCase() || null;
      if (v && !TRACKING_PATTERNS[k].re.test(v)) errors.push({ field: k, message: TRACKING_PATTERNS[k].message });
      value[k] = v;
    }
    if (errors.length) throw AppException.validation(errors);
    await this.prisma.tenantSetting.upsert({ where: { tenantId_key: { tenantId, key: TRACKING_KEY } }, create: { tenantId, key: TRACKING_KEY, value: value as never }, update: { value: value as never } });
    await this.audit.record({ action: 'tracking.update', tenantId, actorUserId: userId, actorRealm: 'TENANT', targetType: 'TenantSetting', targetId: TRACKING_KEY, after: value });
    return value;
  }
}
