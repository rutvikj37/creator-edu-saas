import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { toCsv } from '../../common/csv/csv.js';
import { isValidTimeZone } from '../../common/time/timezone.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { OrdersService } from '../commerce/orders.service.js';
import { fromMinor, toMinor } from '../commerce/providers/money.js';
import { localDate, zonedTimeToUtc } from '../live/recurrence.js';
import { isInterState, splitTax, type GstParty } from './gst.js';

const DAY = 86_400_000;
const MAX_DAYS = 366;
const MAX_EXPORT_ROWS = 50_000;
const PAID = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;

export interface RangeQuery { from?: string; to?: string }
interface Range { tz: string; currency: string; from: Date; to: Date; fromDay: string; toDay: string; days: string[] }

/**
 * Academy analytics computed from the operational tables (orders, ledger, enrolments, users) —
 * no tracking pixels and no estimates. Days are bucketed in the academy's time zone.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly orders: OrdersService,
  ) {}

  /** `from`/`to` are inclusive calendar days (YYYY-MM-DD) in the academy time zone; default: last 30 days. */
  async range(q: RangeQuery): Promise<Range> {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: this.ctx.requireTenantId() }, select: { timezone: true, defaultCurrency: true } });
    const tz = isValidTimeZone(t.timezone) ? t.timezone : 'Asia/Kolkata';
    const today = localDate(new Date(), tz);
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const errors: { field: string; message: string }[] = [];
    if (q.from && !re.test(q.from)) errors.push({ field: 'from', message: 'Use YYYY-MM-DD' });
    if (q.to && !re.test(q.to)) errors.push({ field: 'to', message: 'Use YYYY-MM-DD' });
    if (errors.length) throw AppException.validation(errors);
    const toDay = q.to ?? today;
    const start = (day: string) => { const [y, m, d] = day.split('-').map(Number); return zonedTimeToUtc(y, m, d, 0, 0, tz); };
    const toDate = start(toDay);
    const fromDay = q.from ?? localDate(new Date(toDate.getTime() - 29 * DAY + DAY / 2), tz);
    const from = start(fromDay);
    if (Number.isNaN(from.getTime()) || Number.isNaN(toDate.getTime())) throw AppException.validation([{ field: 'from', message: 'Invalid date' }]);
    if (from > toDate) throw AppException.validation([{ field: 'from', message: 'Start must be on or before the end' }]);
    // End is exclusive: the start of the day after `to` (computed via noon to stay DST-safe).
    const [ny, nm, nd] = localDate(new Date(toDate.getTime() + DAY + DAY / 2), tz).split('-').map(Number);
    const to = zonedTimeToUtc(ny, nm, nd, 0, 0, tz);
    const days: string[] = [];
    for (let t0 = from.getTime() + DAY / 2; t0 < to.getTime(); t0 += DAY) {
      days.push(localDate(new Date(t0), tz));
      if (days.length > MAX_DAYS) throw AppException.validation([{ field: 'from', message: `Choose at most ${MAX_DAYS} days` }]);
    }
    return { tz, currency: t.defaultCurrency, from, to, fromDay, toDay, days: [...new Set(days)] };
  }

  async overview(q: RangeQuery) {
    const r = await this.range(q);
    const tenantId = this.ctx.requireTenantId();
    const at = { gte: r.from, lt: r.to };
    const [money, ledger, enrolments, completions, students, leads, paidOrders] = await Promise.all([
      this.orders.summary(r.from, r.to),
      this.db.ledgerEntry.findMany({ where: { createdAt: at, type: { in: ['SALE', 'REFUND'] }, currency: r.currency }, select: { createdAt: true, amount: true } }),
      this.db.enrollment.findMany({ where: { createdAt: at }, select: { createdAt: true, source: true } }),
      this.db.enrollment.count({ where: { completedAt: at } }),
      this.prisma.user.findMany({ where: { tenantId, realm: 'TENANT', deletedAt: null, createdAt: at }, select: { createdAt: true } }),
      this.db.lead.count({ where: { createdAt: at } }),
      this.db.order.findMany({ where: { status: { in: [...PAID] }, paidAt: at }, select: { id: true } }),
    ]);
    const series = new Map(r.days.map((d) => [d, { date: d, revenue: 0, enrollments: 0, students: 0 }]));
    for (const l of ledger) { const s = series.get(localDate(l.createdAt, r.tz)); if (s) s.revenue += toMinor(l.amount, r.currency); }
    for (const e of enrolments) { const s = series.get(localDate(e.createdAt, r.tz)); if (s) s.enrollments += 1; }
    for (const u of students) { const s = series.get(localDate(u.createdAt, r.tz)); if (s) s.students += 1; }
    const bySource: Record<string, number> = {};
    for (const e of enrolments) bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    const top = paidOrders.length
      ? await this.db.orderItem.groupBy({ by: ['courseId'], where: { orderId: { in: paidOrders.map((o) => o.id) }, courseId: { not: null } }, _sum: { totalAmount: true }, _count: { _all: true } })
      : [];
    const titles = await this.db.course.findMany({ where: { id: { in: top.map((t) => t.courseId!).filter(Boolean) } }, select: { id: true, title: true } });
    return {
      range: { from: r.fromDay, to: r.toDay, timezone: r.tz, currency: r.currency },
      money,
      counts: { newStudents: students.length, enrollments: enrolments.length, completions, leads, paidOrders: paidOrders.length },
      enrollmentsBySource: bySource,
      series: [...series.values()].map((s) => ({ ...s, revenue: fromMinor(s.revenue, r.currency) })),
      topCourses: top
        .map((t) => ({ courseId: t.courseId, title: titles.find((c) => c.id === t.courseId)?.title ?? 'Deleted course', sales: t._count._all, revenue: t._sum.totalAmount?.toString() ?? '0' }))
        .sort((a, b) => Number(b.revenue) - Number(a.revenue))
        .slice(0, 10),
    };
  }

  /** Per-course learning and sales figures (lifetime). */
  async courses() {
    const since = new Date(Date.now() - 30 * DAY);
    const [courses, byStatus, completed, progress, active, revenue] = await Promise.all([
      this.db.course.findMany({ where: { deletedAt: null }, select: { id: true, title: true, status: true }, orderBy: { createdAt: 'desc' } }),
      this.db.enrollment.groupBy({ by: ['courseId', 'status'], _count: { _all: true } }),
      this.db.enrollment.groupBy({ by: ['courseId'], where: { completedAt: { not: null } }, _count: { _all: true } }),
      this.db.enrollment.groupBy({ by: ['courseId'], where: { status: 'ACTIVE' }, _avg: { progressPercent: true } }),
      this.db.enrollment.groupBy({ by: ['courseId'], where: { lastAccessedAt: { gte: since } }, _count: { _all: true } }),
      this.db.orderItem.groupBy({ by: ['courseId'], where: { courseId: { not: null }, order: { status: { in: [...PAID] } } }, _sum: { totalAmount: true }, _count: { _all: true } }),
    ]);
    return courses.map((c) => {
      const enrolled = byStatus.filter((b) => b.courseId === c.id).reduce((n, b) => n + b._count._all, 0);
      const done = completed.find((x) => x.courseId === c.id)?._count._all ?? 0;
      const rev = revenue.find((x) => x.courseId === c.id);
      return {
        id: c.id, title: c.title, status: c.status,
        enrollments: enrolled,
        activeEnrollments: byStatus.find((b) => b.courseId === c.id && b.status === 'ACTIVE')?._count._all ?? 0,
        activeLast30Days: active.find((x) => x.courseId === c.id)?._count._all ?? 0,
        completions: done,
        completionRate: enrolled ? Math.round((done / enrolled) * 1000) / 10 : 0,
        averageProgress: Math.round(progress.find((x) => x.courseId === c.id)?._avg.progressPercent ?? 0),
        sales: rev?._count._all ?? 0,
        revenue: rev?._sum.totalAmount?.toString() ?? '0',
      };
    });
  }

  // ── GST ───────────────────────────────────────────────────
  /** Invoices and credit notes (processed refunds) in the range, with the IGST/CGST/SGST split. */
  async gst(q: RangeQuery) {
    const r = await this.range(q);
    const at = { gte: r.from, lt: r.to };
    const [invoices, refunds] = await Promise.all([
      this.db.invoice.findMany({ where: { issuedAt: at }, orderBy: { issuedAt: 'asc' }, take: MAX_EXPORT_ROWS + 1 }),
      this.db.refund.findMany({ where: { status: 'PROCESSED', processedAt: at }, orderBy: { processedAt: 'asc' }, take: MAX_EXPORT_ROWS + 1 }),
    ]);
    if (invoices.length + refunds.length > MAX_EXPORT_ROWS) throw AppException.validation([{ field: 'from', message: 'Too many documents — choose a shorter period' }]);
    const orderIds = [...new Set([...invoices.map((i) => i.orderId), ...refunds.map((x) => x.orderId)])];
    const [orders, refundInvoices, reversals] = await Promise.all([
      this.db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true } }),
      this.db.invoice.findMany({ where: { orderId: { in: refunds.map((x) => x.orderId) } } }),
      this.db.ledgerEntry.findMany({ where: { refundId: { in: refunds.map((x) => x.id) }, type: 'TAX_REVERSAL' }, select: { refundId: true, amount: true } }),
    ]);
    const orderNo = new Map(orders.map((o) => [o.id, o.number]));
    const invByOrder = new Map(refundInvoices.map((i) => [i.orderId, i]));
    type Row = { type: 'INVOICE' | 'CREDIT_NOTE'; number: string; date: string; invoiceNumber: string; orderNumber: string; customer: string; gstin: string | null; category: 'B2B' | 'B2C'; placeOfSupply: string | null; interState: boolean; rate: number; currency: string; taxable: number; igst: number; cgst: number; sgst: number; total: number };
    const rows: Row[] = [];
    const doc = (inv: (typeof invoices)[number], sign: 1 | -1, totalMinor: number, taxMinor: number, extra: Pick<Row, 'type' | 'number' | 'date'>) => {
      const seller = inv.seller as GstParty;
      const buyer = inv.buyer as GstParty & { name?: string };
      const totals = inv.totals as { currency: string; taxRate: string | null };
      const inter = isInterState(seller, buyer);
      const split = splitTax(taxMinor, inter);
      const cur = totals.currency;
      const m = (v: number) => Number(fromMinor(sign * v, cur));
      rows.push({
        ...extra, invoiceNumber: inv.number, orderNumber: orderNo.get(inv.orderId) ?? '', customer: buyer.name ?? '', gstin: buyer.gstin || null,
        category: buyer.gstin ? 'B2B' : 'B2C', placeOfSupply: buyer.gstin ? `${buyer.gstin.slice(0, 2)} (GSTIN)` : buyer.state || seller.state || null, interState: inter,
        rate: Number(totals.taxRate ?? 0), currency: cur, taxable: m(totalMinor - taxMinor), igst: m(split.igst), cgst: m(split.cgst), sgst: m(split.sgst), total: m(totalMinor),
      });
    };
    for (const inv of invoices) {
      const t = inv.totals as { currency: string; total: string; tax: string };
      doc(inv, 1, toMinor(t.total, t.currency), toMinor(t.tax, t.currency), { type: 'INVOICE', number: inv.number, date: localDate(inv.issuedAt, r.tz) });
    }
    for (const rf of refunds) {
      const inv = invByOrder.get(rf.orderId);
      if (!inv) continue; // no invoice was issued (cannot happen for paid orders)
      const cur = (inv.totals as { currency: string }).currency;
      // TAX_REVERSAL entries are positive for the creator (the GST on the refunded part goes back).
      const taxBack = reversals.filter((x) => x.refundId === rf.id).reduce((n, x) => n + toMinor(x.amount, cur), 0);
      doc(inv, -1, toMinor(rf.amount, cur), Math.abs(taxBack), { type: 'CREDIT_NOTE', number: `CN-${rf.id}`, date: localDate(rf.processedAt!, r.tz) });
    }
    // Summary per currency and rate (taxes are already signed: credit notes are negative).
    const summary = new Map<string, { currency: string; rate: number; documents: number; taxable: number; igst: number; cgst: number; sgst: number; total: number }>();
    for (const x of rows) {
      const k = `${x.currency}:${x.rate}`;
      const s = summary.get(k) ?? { currency: x.currency, rate: x.rate, documents: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, total: 0 };
      s.documents += 1;
      for (const f of ['taxable', 'igst', 'cgst', 'sgst', 'total'] as const) s[f] = Math.round((s[f] + x[f]) * 100) / 100;
      summary.set(k, s);
    }
    const sellerGstin = invoices.length ? (invoices[invoices.length - 1].seller as GstParty).gstin ?? null : null;
    return { range: { from: r.fromDay, to: r.toDay, timezone: r.tz }, sellerGstin, summary: [...summary.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.rate - b.rate), rows };
  }

  async gstCsv(q: RangeQuery) {
    const g = await this.gst(q);
    return toCsv(
      ['Document type', 'Document number', 'Date', 'Invoice number', 'Order number', 'Customer', 'Customer GSTIN', 'B2B/B2C', 'Place of supply', 'Supply', 'GST rate %', 'Currency', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Total'],
      g.rows.map((x) => [x.type === 'INVOICE' ? 'Invoice' : 'Credit note', x.number, x.date, x.invoiceNumber, x.orderNumber, x.customer, x.gstin, x.category, x.placeOfSupply, x.interState ? 'Inter-state' : 'Intra-state', x.rate, x.currency, x.taxable, x.igst, x.cgst, x.sgst, x.total]),
    );
  }

  // ── exports ───────────────────────────────────────────────
  async ordersCsv(q: RangeQuery) {
    const r = await this.range(q);
    const orders = await this.db.order.findMany({ where: { status: { in: [...PAID] }, paidAt: { gte: r.from, lt: r.to } }, include: { items: true }, orderBy: { paidAt: 'asc' }, take: MAX_EXPORT_ROWS + 1 });
    if (orders.length > MAX_EXPORT_ROWS) throw AppException.validation([{ field: 'from', message: 'Too many orders — choose a shorter period' }]);
    const [users, invoices] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [...new Set(orders.map((o) => o.userId))] } }, select: { id: true, fullName: true, email: true } }),
      this.db.invoice.findMany({ where: { orderId: { in: orders.map((o) => o.id) } }, select: { orderId: true, number: true } }),
    ]);
    const u = new Map(users.map((x) => [x.id, x]));
    const inv = new Map(invoices.map((x) => [x.orderId, x.number]));
    const n = (v: { toString(): string }) => Number(v.toString());
    return toCsv(
      ['Order number', `Paid at (${r.tz})`, 'Student', 'Email', 'Items', 'Coupon', 'Currency', 'Subtotal', 'Discount', 'GST', 'Total', 'Refunded', 'Status', 'Invoice number'],
      orders.map((o) => [o.number, this.localDateTime(o.paidAt!, r.tz), u.get(o.userId)?.fullName, u.get(o.userId)?.email, o.items.map((i) => i.title).join('; '), o.couponCode, o.currency, n(o.subtotalAmount), n(o.discountAmount), n(o.taxAmount), n(o.totalAmount), n(o.refundedAmount), o.status, inv.get(o.id)]),
    );
  }

  async studentsCsv() {
    const tenantId = this.ctx.requireTenantId();
    const tz = (await this.range({})).tz;
    const users = await this.prisma.user.findMany({ where: { tenantId, realm: 'TENANT', deletedAt: null }, orderBy: { createdAt: 'asc' }, take: MAX_EXPORT_ROWS + 1, select: { id: true, fullName: true, email: true, phone: true, status: true, createdAt: true, lastLoginAt: true } });
    if (users.length > MAX_EXPORT_ROWS) throw AppException.validation([{ field: 'export', message: 'Too many students to export at once' }]);
    const [enrolled, done] = await Promise.all([
      this.db.enrollment.groupBy({ by: ['userId'], _count: { _all: true } }),
      this.db.enrollment.groupBy({ by: ['userId'], where: { completedAt: { not: null } }, _count: { _all: true } }),
    ]);
    const e = new Map(enrolled.map((x) => [x.userId, x._count._all]));
    const d = new Map(done.map((x) => [x.userId, x._count._all]));
    return toCsv(
      ['Name', 'Email', 'Phone', 'Status', `Joined (${tz})`, `Last login (${tz})`, 'Courses', 'Completed'],
      users.map((x) => [x.fullName, x.email, x.phone, x.status, this.localDateTime(x.createdAt, tz), x.lastLoginAt ? this.localDateTime(x.lastLoginAt, tz) : '', e.get(x.id) ?? 0, d.get(x.id) ?? 0]),
    );
  }

  async enrollmentsCsv(courseId?: string) {
    const tz = (await this.range({})).tz;
    if (courseId && !(await this.db.course.findFirst({ where: { id: courseId, deletedAt: null }, select: { id: true } }))) throw AppException.notFound('Course not found');
    const rows = await this.db.enrollment.findMany({ where: courseId ? { courseId } : {}, include: { course: { select: { title: true } } }, orderBy: { createdAt: 'asc' }, take: MAX_EXPORT_ROWS + 1 });
    if (rows.length > MAX_EXPORT_ROWS) throw AppException.validation([{ field: 'courseId', message: 'Too many enrolments — export one course at a time' }]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, fullName: true, email: true } });
    const u = new Map(users.map((x) => [x.id, x]));
    return toCsv(
      ['Student', 'Email', 'Course', 'Source', 'Status', `Enrolled (${tz})`, 'Progress %', `Completed (${tz})`, `Access ends (${tz})`],
      rows.map((r) => [u.get(r.userId)?.fullName, u.get(r.userId)?.email, r.course.title, r.source, r.status, this.localDateTime(r.createdAt, tz), r.progressPercent, r.completedAt ? this.localDateTime(r.completedAt, tz) : '', r.expiresAt ? this.localDateTime(r.expiresAt, tz) : '']),
    );
  }

  private localDateTime(d: Date, tz: string) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).replace(',', '');
  }
}
