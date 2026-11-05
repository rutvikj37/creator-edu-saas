import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { isEnrollmentUsable } from '../learning/access.js';
import { OrdersService } from './orders.service.js';
import { fromMinor, toMinor } from './providers/money.js';

const MAX_ITEMS = 20;

/** A student's cart: paid courses and bundles bought together in one order. */
@Injectable()
export class CartService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly orders: OrdersService,
  ) {}

  /**
   * Cart contents with current prices. Items that can no longer be bought (unpublished, already
   * owned) are listed with a reason so the student can remove them; checkout refuses them.
   */
  async get(userId: string) {
    const rows = await this.db.cartItem.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    const owned = new Set((await this.db.enrollment.findMany({ where: { userId } })).filter((e) => isEnrollmentUsable(e)).map((e) => e.courseId));
    const items = [];
    for (const r of rows) {
      if (r.digitalProductId) {
        const p = await this.db.digitalProduct.findFirst({ where: { id: r.digitalProductId } });
        const ownedP = p ? Boolean(await this.db.digitalProductAccess.findFirst({ where: { productId: p.id, userId, revokedAt: null } })) : false;
        const problem = !p || p.status !== 'PUBLISHED' || Number(p.priceAmount) <= 0 ? 'No longer available' : ownedP ? 'You already have this product' : null;
        items.push({ id: r.id, kind: 'product' as const, refId: r.digitalProductId, title: p?.title ?? 'Removed product', slug: p?.slug ?? null, priceAmount: p ? String(p.priceAmount) : null, currency: p?.currency ?? null, courseCount: 0, problem });
      } else if (r.bundleId) {
        const b = await this.db.bundle.findFirst({ where: { id: r.bundleId } });
        const ids = (b?.courseIds as string[] | undefined) ?? [];
        const live = b ? await this.db.course.count({ where: { id: { in: ids }, status: 'PUBLISHED', deletedAt: null } }) : 0;
        const problem = !b || b.status !== 'PUBLISHED' || live !== ids.length ? 'No longer available' : ids.every((id) => owned.has(id)) ? 'You already have every course in this bundle' : null;
        items.push({ id: r.id, kind: 'bundle' as const, refId: r.bundleId, title: b?.title ?? 'Removed bundle', slug: b?.slug ?? null, priceAmount: b ? String(b.priceAmount) : null, currency: b?.currency ?? null, courseCount: ids.length, problem });
      } else {
        const c = await this.db.course.findFirst({ where: { id: r.courseId! } });
        const sellable = c && !c.deletedAt && c.status === 'PUBLISHED' && c.visibility !== 'PRIVATE' && !c.isFree && c.priceAmount !== null && Number(c.priceAmount) > 0;
        const problem = !sellable ? 'No longer available' : owned.has(c.id) ? 'You already have this course' : null;
        items.push({ id: r.id, kind: 'course' as const, refId: r.courseId!, title: c?.title ?? 'Removed course', slug: c?.slug ?? null, priceAmount: c?.priceAmount?.toString() ?? null, currency: c?.currency ?? null, courseCount: 1, problem });
      }
    }
    const ok = items.filter((i) => !i.problem && i.priceAmount !== null);
    const currency = ok[0]?.currency ?? null;
    const subtotal = currency ? fromMinor(ok.reduce((s, i) => s + toMinor(i.priceAmount!, i.currency!), 0), currency) : '0';
    return { items, count: items.length, currency, subtotal, ready: items.length > 0 && items.every((i) => !i.problem) };
  }

  async add(userId: string, ref: { courseId?: string; bundleId?: string; digitalProductId?: string }) {
    if ([ref.courseId, ref.bundleId, ref.digitalProductId].filter(Boolean).length !== 1) throw AppException.validation([{ field: 'courseId', message: 'Add a course, a bundle or a product' }]);
    if ((await this.db.cartItem.count({ where: { userId } })) >= MAX_ITEMS) throw AppException.conflict(`A cart holds up to ${MAX_ITEMS} items.`);
    const existing = await this.db.cartItem.findFirst({ where: { userId, ...(ref.courseId ? { courseId: ref.courseId } : ref.bundleId ? { bundleId: ref.bundleId } : { digitalProductId: ref.digitalProductId }) } });
    if (existing) return this.get(userId);
    // Same rules as checkout: sellable, not owned, no overlap between courses and bundles, one currency.
    const line = ref.bundleId ? await this.orders.sellableBundle(ref.bundleId) : ref.digitalProductId ? await this.orders.sellableProduct(ref.digitalProductId) : await this.orders.sellableLine(ref.courseId!);
    const current = (await this.get(userId)).items.filter((i) => !i.problem);
    const others = [];
    for (const i of current) others.push(i.kind === 'bundle' ? await this.orders.sellableBundle(i.refId) : i.kind === 'product' ? await this.orders.sellableProduct(i.refId) : await this.orders.sellableLine(i.refId));
    if (others.length && others[0].currency !== line.currency) throw AppException.conflict('This item is priced in a different currency from your cart. Buy it separately.');
    await this.orders.assertBuyable(userId, [...others, line]);
    await this.db.cartItem.create({ data: { userId, courseId: ref.courseId ?? null, bundleId: ref.bundleId ?? null, digitalProductId: ref.digitalProductId ?? null } as never });
    return this.get(userId);
  }

  async remove(userId: string, itemId: string) {
    await this.db.cartItem.deleteMany({ where: { id: itemId, userId } });
    return this.get(userId);
  }

  async clear(userId: string) {
    await this.db.cartItem.deleteMany({ where: { userId } });
    return this.get(userId);
  }
}
