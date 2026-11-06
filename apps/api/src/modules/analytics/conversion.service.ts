import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../core/redis/redis.constants.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { fromMinor, toMinor } from '../commerce/providers/money.js';
import { localDate } from '../live/recurrence.js';
import { AnalyticsService, type RangeQuery } from './analytics.service.js';

export interface TrackInput {
  type: 'page_view' | 'checkout_started';
  path: string;
  visitorId: string;
  /** checkout_started: what is being bought. */
  item?: { kind: 'course' | 'bundle' | 'product' | 'webinar' | 'membership' | 'cart'; id?: string } | null;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  referrer?: string | null;
}

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|monitor|curl|wget|python-requests/i;
const PAID = ['PAID', 'PARTIALLY_REFUNDED'] as const;
const clean = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase().slice(0, max) : null);
const ITEM_PATHS: [RegExp, 'course' | 'bundle' | 'product' | 'webinar' | 'page'][] = [
  [/^\/courses\/([\w-]{1,120})\/?$/, 'course'], [/^\/bundles\/([\w-]{1,120})\/?$/, 'bundle'], [/^\/products\/([\w-]{1,120})\/?$/, 'product'],
  [/^\/webinars\/([\w-]{1,120})\/?$/, 'webinar'], [/^\/p\/([\w-]{1,120})\/?$/, 'page'],
];

/**
 * First-party conversion tracking for academy sites: page views and checkout starts recorded
 * with a random visitor id (no IP address, no third-party scripts), joined to real paid orders
 * that carry the same visitor id and first-touch UTM attribution.
 */
@Injectable()
export class ConversionService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly analytics: AnalyticsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Path → item, resolved by slug (cached briefly). */
  private async itemFor(path: string): Promise<{ itemType: string | null; itemId: string | null }> {
    if (path === '/' || path === '') return { itemType: 'home', itemId: null };
    if (/^\/courses\/?$/.test(path)) return { itemType: 'catalog', itemId: null };
    for (const [re, kind] of ITEM_PATHS) {
      const m = re.exec(path);
      if (!m) continue;
      const tenantId = this.ctx.requireTenantId();
      const key = `trk:item:${tenantId}:${kind}:${m[1]}`;
      const cached = await this.redis.get(key);
      if (cached !== null) return { itemType: kind, itemId: cached || null };
      const slug = m[1];
      const row = kind === 'course' ? await this.db.course.findFirst({ where: { slug }, select: { id: true } })
        : kind === 'bundle' ? await this.db.bundle.findFirst({ where: { slug }, select: { id: true } })
        : kind === 'product' ? await this.db.digitalProduct.findFirst({ where: { slug }, select: { id: true } })
        : kind === 'webinar' ? await this.db.liveClass.findFirst({ where: { slug, kind: 'WEBINAR' }, select: { id: true } })
        : await this.db.sitePage.findFirst({ where: { slug }, select: { id: true } });
      await this.redis.set(key, row?.id ?? '', 'EX', 600);
      return { itemType: kind, itemId: row?.id ?? null };
    }
    return { itemType: null, itemId: null };
  }

  async track(input: TrackInput, meta: { userId?: string | null; userAgent?: string; dnt?: boolean }) {
    if (meta.dnt || (meta.userAgent && BOT.test(meta.userAgent))) return { recorded: false };
    const visitorId = /^[\w-]{8,40}$/.test(input.visitorId) ? input.visitorId : null;
    if (!visitorId) return { recorded: false };
    // At most one identical event per visitor and path every 10 seconds (refreshes, double mounts).
    const path = (input.path || '/').split('?')[0].split('#')[0].slice(0, 255) || '/';
    if (!(await this.redis.set(`trk:dedupe:${this.ctx.requireTenantId()}:${visitorId}:${input.type}:${path}`, '1', 'EX', 10, 'NX'))) return { recorded: false, duplicate: true };
    let { itemType, itemId } = await this.itemFor(path);
    if (input.type === 'checkout_started' && input.item) {
      itemType = input.item.kind;
      itemId = input.item.id && /^[a-z0-9]{25}$/.test(input.item.id) ? input.item.id : null;
    }
    let referrerHost: string | null = null;
    try { referrerHost = input.referrer ? new URL(input.referrer).hostname.toLowerCase().slice(0, 191) : null; } catch { /* ignore */ }
    await this.db.analyticsEvent.create({
      data: { type: input.type, path, itemType, itemId, visitorId, userId: meta.userId ?? null, utmSource: clean(input.source, 100), utmMedium: clean(input.medium, 100), utmCampaign: clean(input.campaign, 150), referrerHost } as never,
    });
    return { recorded: true };
  }

  /** Funnel, per item, per page, per source and per day for a date range. */
  async insights(q: RangeQuery) {
    const r = await this.analytics.range(q);
    const where = { createdAt: { gte: r.from, lt: r.to } };
    const events = await this.db.analyticsEvent.findMany({ where, select: { type: true, path: true, itemType: true, itemId: true, visitorId: true, utmSource: true, utmMedium: true, utmCampaign: true, referrerHost: true, createdAt: true }, take: 500_000 });
    const orders = await this.db.order.findMany({ where: { status: { in: [...PAID] }, paidAt: { gte: r.from, lt: r.to } }, select: { totalAmount: true, currency: true, attribution: true, paidAt: true, items: { select: { courseId: true, bundleId: true, digitalProductId: true, liveClassId: true, membershipPlanId: true, totalAmount: true } } } });
    const cur = r.currency;
    const minor = (v: unknown) => toMinor(v as never, cur);

    const views = events.filter((e) => e.type === 'page_view');
    const checkouts = events.filter((e) => e.type === 'checkout_started');
    const visitors = new Set(views.map((e) => e.visitorId));
    const itemViewers = new Set(views.filter((e) => ['course', 'bundle', 'product', 'webinar'].includes(e.itemType ?? '')).map((e) => e.visitorId));
    const checkoutVisitors = new Set(checkouts.map((e) => e.visitorId));
    const attr = (o: (typeof orders)[number]) => (o.attribution ?? {}) as { visitorId?: string; source?: string; medium?: string; campaign?: string; referrerHost?: string; landingPath?: string };
    const revenue = orders.reduce((s, o) => s + minor(o.totalAmount), 0);
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

    // Per item: views, unique visitors, checkouts, paid sales and revenue from order lines.
    const items = new Map<string, { type: string; id: string; views: number; visitors: Set<string>; checkouts: Set<string>; sales: number; revenue: number }>();
    const itemRow = (type: string, id: string) => {
      const k = `${type}:${id}`;
      if (!items.has(k)) items.set(k, { type, id, views: 0, visitors: new Set(), checkouts: new Set(), sales: 0, revenue: 0 });
      return items.get(k)!;
    };
    for (const e of views) if (e.itemId && e.itemType && e.itemType !== 'page') { const it = itemRow(e.itemType, e.itemId); it.views++; it.visitors.add(e.visitorId); }
    for (const e of checkouts) if (e.itemId && e.itemType) itemRow(e.itemType, e.itemId).checkouts.add(e.visitorId);
    for (const o of orders) for (const li of o.items) {
      const [type, id] = li.courseId ? ['course', li.courseId] : li.bundleId ? ['bundle', li.bundleId] : li.digitalProductId ? ['product', li.digitalProductId] : li.liveClassId ? ['webinar', li.liveClassId] : li.membershipPlanId ? ['membership', li.membershipPlanId] : [null, null];
      if (!type || !id) continue;
      const it = itemRow(type, id);
      it.sales++;
      it.revenue += minor(li.totalAmount);
    }
    const titles = await this.titles([...items.values()]);

    // Per page and per source.
    const pages = new Map<string, { views: number; visitors: Set<string>; sales: number; revenue: number }>();
    for (const e of views) { const p = pages.get(e.path) ?? { views: 0, visitors: new Set(), sales: 0, revenue: 0 }; p.views++; p.visitors.add(e.visitorId); pages.set(e.path, p); }
    for (const o of orders) { const lp = attr(o).landingPath; if (lp && pages.has(lp)) { const p = pages.get(lp)!; p.sales++; p.revenue += minor(o.totalAmount); } }
    const sourceOf = (s: string | null | undefined, m: string | null | undefined, ref: string | null | undefined) => (s ? `${s}${m ? ` / ${m}` : ''}` : ref ? `${ref} (referral)` : 'Direct');
    const sources = new Map<string, { visitors: Set<string>; checkouts: Set<string>; sales: number; revenue: number; campaigns: Set<string> }>();
    const firstTouch = new Map<string, (typeof views)[number]>();
    for (const e of [...views].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) if (!firstTouch.has(e.visitorId)) firstTouch.set(e.visitorId, e);
    const srcRow = (k: string) => { if (!sources.has(k)) sources.set(k, { visitors: new Set(), checkouts: new Set(), sales: 0, revenue: 0, campaigns: new Set() }); return sources.get(k)!; };
    for (const [v, e] of firstTouch) { const s = srcRow(sourceOf(e.utmSource, e.utmMedium, e.referrerHost)); s.visitors.add(v); if (e.utmCampaign) s.campaigns.add(e.utmCampaign); }
    for (const e of checkouts) { const ft = firstTouch.get(e.visitorId); srcRow(ft ? sourceOf(ft.utmSource, ft.utmMedium, ft.referrerHost) : sourceOf(e.utmSource, e.utmMedium, e.referrerHost)).checkouts.add(e.visitorId); }
    for (const o of orders) { const a = attr(o); const s = srcRow(sourceOf(a.source, a.medium, a.referrerHost)); s.sales++; s.revenue += minor(o.totalAmount); if (a.campaign) s.campaigns.add(a.campaign); }

    // Daily trend in the academy's time zone.
    const daily = new Map(r.days.map((d) => [d, { day: d, visitors: new Set<string>(), checkouts: new Set<string>(), sales: 0 }]));
    for (const e of views) daily.get(localDate(e.createdAt, r.tz))?.visitors.add(e.visitorId);
    for (const e of checkouts) daily.get(localDate(e.createdAt, r.tz))?.checkouts.add(e.visitorId);
    for (const o of orders) { const d = daily.get(localDate(o.paidAt!, r.tz)); if (d) d.sales++; }

    const attributed = orders.filter((o) => attr(o).visitorId && visitors.has(attr(o).visitorId!)).length;
    return {
      range: { from: r.fromDay, to: r.toDay, timezone: r.tz }, currency: cur,
      funnel: {
        visitors: visitors.size, pageViews: views.length, itemViewers: itemViewers.size, checkoutStarted: checkoutVisitors.size, paidOrders: orders.length, attributedOrders: attributed,
        revenue: fromMinor(revenue, cur), viewToCheckout: pct(checkoutVisitors.size, itemViewers.size), checkoutToPaid: pct(attributed, checkoutVisitors.size), conversionRate: pct(attributed, visitors.size),
      },
      items: [...items.values()].map((it) => ({ type: it.type, id: it.id, title: titles.get(`${it.type}:${it.id}`) ?? 'Removed', views: it.views, visitors: it.visitors.size, checkouts: it.checkouts.size, sales: it.sales, revenue: fromMinor(it.revenue, cur), conversionRate: pct(it.sales, it.visitors.size) }))
        .sort((a, b) => b.sales - a.sales || b.views - a.views).slice(0, 100),
      pages: [...pages.entries()].map(([path, p]) => ({ path, views: p.views, visitors: p.visitors.size, sales: p.sales, revenue: fromMinor(p.revenue, cur), conversionRate: pct(p.sales, p.visitors.size) })).sort((a, b) => b.views - a.views).slice(0, 100),
      sources: [...sources.entries()].map(([source, s]) => ({ source, visitors: s.visitors.size, checkouts: s.checkouts.size, sales: s.sales, revenue: fromMinor(s.revenue, cur), conversionRate: pct(s.sales, s.visitors.size), campaigns: [...s.campaigns].slice(0, 20) })).sort((a, b) => b.visitors - a.visitors || b.sales - a.sales),
      daily: [...daily.values()].map((d) => ({ day: d.day, visitors: d.visitors.size, checkouts: d.checkouts.size, sales: d.sales })),
    };
  }

  private async titles(rows: { type: string; id: string }[]) {
    const by = (t: string) => rows.filter((r) => r.type === t).map((r) => r.id);
    const out = new Map<string, string>();
    const add = (t: string, list: { id: string; title?: string; name?: string }[]) => list.forEach((x) => out.set(`${t}:${x.id}`, x.title ?? x.name ?? ''));
    add('course', await this.db.course.findMany({ where: { id: { in: by('course') } }, select: { id: true, title: true } }));
    add('bundle', await this.db.bundle.findMany({ where: { id: { in: by('bundle') } }, select: { id: true, title: true } }));
    add('product', await this.db.digitalProduct.findMany({ where: { id: { in: by('product') } }, select: { id: true, title: true } }));
    add('webinar', await this.db.liveClass.findMany({ where: { id: { in: by('webinar') } }, select: { id: true, title: true } }));
    add('membership', await this.db.membershipPlan.findMany({ where: { id: { in: by('membership') } }, select: { id: true, name: true } }));
    return out;
  }
}
