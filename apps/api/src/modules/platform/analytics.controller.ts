import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@ce/shared';
import { RequirePermissions, RequireRealm } from '../../common/decorators/auth.decorators.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { dailySeries, resolveRange } from './dashboard.service.js';
import { DateRangeQuery } from './dto/platform.dto.js';

type DayCount = { day: Date; count: bigint };
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Platform-wide growth, engagement and sales analytics across academies (read-only).
 * Complements the dashboard: who is learning, which academies sell, and which features are adopted.
 */
@ApiTags('Platform · Analytics')
@ApiBearerAuth()
@RequireRealm('PLATFORM')
@Controller({ path: 'platform/analytics', version: '1' })
export class PlatformAnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_READ)
  @ApiOperation({ summary: 'Growth, learning activity, sales conversion, top academies and feature adoption' })
  async overview(@Query() q: DateRangeQuery) {
    const { start, end } = resolveRange(q.from, q.to);
    const inRange = { gte: start, lte: end };
    const [enrollDaily, learnerDaily, ordersDaily, gmvDaily, newAcademies, newStudents, enrollments, completions, ordersCreated, ordersPaid, liveHeld, coursesPublished, learners] = await Promise.all([
      this.prisma.$queryRaw<DayCount[]>`SELECT DATE(createdAt) AS day, COUNT(*) AS count FROM Enrollment WHERE createdAt BETWEEN ${start} AND ${end} GROUP BY DATE(createdAt)`,
      this.prisma.$queryRaw<DayCount[]>`SELECT DATE(lp.updatedAt) AS day, COUNT(DISTINCT e.userId) AS count FROM LessonProgress lp JOIN Enrollment e ON e.id = lp.enrollmentId WHERE lp.updatedAt BETWEEN ${start} AND ${end} GROUP BY DATE(lp.updatedAt)`,
      this.prisma.$queryRaw<DayCount[]>`SELECT DATE(paidAt) AS day, COUNT(*) AS count FROM \`Order\` WHERE paidAt BETWEEN ${start} AND ${end} GROUP BY DATE(paidAt)`,
      this.prisma.$queryRaw<Array<{ day: Date; currency: string; amount: string | number }>>`SELECT DATE(createdAt) AS day, currency, SUM(amount) AS amount FROM LedgerEntry WHERE type = 'SALE' AND createdAt BETWEEN ${start} AND ${end} GROUP BY DATE(createdAt), currency`,
      this.prisma.tenant.count({ where: { createdAt: inRange } }),
      this.prisma.user.count({ where: { realm: 'TENANT', deletedAt: null, createdAt: inRange } }),
      this.prisma.enrollment.count({ where: { createdAt: inRange } }),
      this.prisma.enrollment.count({ where: { completedAt: inRange } }),
      this.prisma.order.count({ where: { createdAt: inRange, totalAmount: { gt: 0 } } }),
      this.prisma.order.count({ where: { createdAt: inRange, totalAmount: { gt: 0 }, paidAt: { not: null } } }),
      this.prisma.liveSession.count({ where: { status: 'ENDED', startsAt: inRange } }),
      this.prisma.course.count({ where: { publishedAt: inRange } }),
      this.prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(DISTINCT e.userId) AS count FROM LessonProgress lp JOIN Enrollment e ON e.id = lp.enrollmentId WHERE lp.updatedAt BETWEEN ${start} AND ${end}`,
    ]);

    const gmvByCurrency = new Map<string, number>();
    for (const r of gmvDaily) gmvByCurrency.set(r.currency, (gmvByCurrency.get(r.currency) ?? 0) + Number(r.amount));
    const mainCurrency = [...gmvByCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'INR';
    const gmvSeries = dailySeries(start, end, gmvDaily.filter((r) => r.currency === mainCurrency).map((r) => ({ day: r.day, count: Math.round(Number(r.amount)) }))).map((d) => ({ date: d.date, amount: d.count }));

    return {
      range: { from: start.toISOString(), to: end.toISOString() },
      totals: {
        newAcademies, newStudents, enrollments, completions, activeLearners: Number(learners[0]?.count ?? 0), liveSessionsHeld: liveHeld, coursesPublished,
        ordersCreated, ordersPaid, checkoutConversion: ordersCreated ? round((ordersPaid / ordersCreated) * 100) : null,
        gmv: [...gmvByCurrency.entries()].map(([currency, amount]) => ({ currency, amount: round(amount) })),
      },
      series: {
        enrollments: dailySeries(start, end, enrollDaily),
        activeLearners: dailySeries(start, end, learnerDaily),
        paidOrders: dailySeries(start, end, ordersDaily),
        gmv: { currency: mainCurrency, points: gmvSeries },
      },
      activation: await this.activation(start, end),
      topAcademies: await this.topAcademies(start, end),
      topCourses: await this.topCourses(start, end),
      adoption: await this.adoption(),
    };
  }

  /** Of the academies created in the range: how many published a course, made a sale, and are active. */
  private async activation(start: Date, end: Date) {
    const cohort = await this.prisma.tenant.findMany({ where: { createdAt: { gte: start, lte: end }, status: { not: 'DELETED' } }, select: { id: true, status: true } });
    const ids = cohort.map((t) => t.id);
    if (!ids.length) return [{ step: 'Signed up', count: 0 }, { step: 'Published a course', count: 0 }, { step: 'Made a sale', count: 0 }, { step: 'Active', count: 0 }];
    const [published, sold] = await Promise.all([
      this.prisma.course.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, status: 'PUBLISHED' } }),
      this.prisma.order.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, paidAt: { not: null }, totalAmount: { gt: 0 } } }),
    ]);
    return [
      { step: 'Signed up', count: ids.length },
      { step: 'Published a course', count: published.length },
      { step: 'Made a sale', count: sold.length },
      { step: 'Active', count: cohort.filter((t) => t.status === 'ACTIVE').length },
    ];
  }

  private async topAcademies(start: Date, end: Date) {
    const rows = await this.prisma.ledgerEntry.groupBy({ by: ['tenantId', 'currency'], where: { type: 'SALE', createdAt: { gte: start, lte: end } }, _sum: { amount: true }, _count: { _all: true }, orderBy: { _sum: { amount: 'desc' } }, take: 10 });
    const ids = [...new Set(rows.map((r) => r.tenantId))];
    const [tenants, students] = await Promise.all([
      this.prisma.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true, status: true } }),
      this.prisma.enrollment.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, createdAt: { gte: start, lte: end } }, _count: { _all: true } }),
    ]);
    return rows.map((r) => ({
      key: `${r.tenantId}:${r.currency}`,
      tenant: tenants.find((t) => t.id === r.tenantId) ?? null, currency: r.currency, gmv: round(Number(r._sum.amount ?? 0)), sales: r._count._all,
      newEnrollments: students.find((s) => s.tenantId === r.tenantId)?._count._all ?? 0,
    }));
  }

  private async topCourses(start: Date, end: Date) {
    const rows = await this.prisma.enrollment.groupBy({ by: ['courseId'], where: { createdAt: { gte: start, lte: end } }, _count: { _all: true }, orderBy: { _count: { courseId: 'desc' } }, take: 10 });
    const courses = await this.prisma.course.findMany({ where: { id: { in: rows.map((r) => r.courseId) } }, select: { id: true, title: true, tenantId: true } });
    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: [...new Set(courses.map((c) => c.tenantId))] } }, select: { id: true, name: true } });
    return rows.map((r) => {
      const c = courses.find((x) => x.id === r.courseId);
      return { courseId: r.courseId, title: c?.title ?? 'Deleted course', academy: tenants.find((t) => t.id === c?.tenantId)?.name ?? null, enrollments: r._count._all };
    });
  }

  /** Academies (not deleted) using each feature at least once. */
  private async adoption() {
    const distinct = async (sql: Promise<Array<{ count: bigint }>>) => Number((await sql)[0]?.count ?? 0);
    const [academies, courses, live, products, bundles, memberships, communities, customDomains, payments, coupons, funnels, links] = await Promise.all([
      this.prisma.tenant.count({ where: { status: { notIn: ['DELETED', 'PENDING_DELETION'] } } }),
      distinct(this.prisma.$queryRaw`SELECT COUNT(DISTINCT tenantId) AS count FROM Course WHERE status = 'PUBLISHED'`),
      distinct(this.prisma.$queryRaw`SELECT COUNT(DISTINCT tenantId) AS count FROM LiveSession`),
      distinct(this.prisma.$queryRaw`SELECT COUNT(DISTINCT tenantId) AS count FROM DigitalProduct`),
      distinct(this.prisma.$queryRaw`SELECT COUNT(DISTINCT tenantId) AS count FROM Bundle`),
      distinct(this.prisma.$queryRaw`SELECT COUNT(DISTINCT tenantId) AS count FROM MembershipPlan`),
      distinct(this.prisma.$queryRaw`SELECT COUNT(DISTINCT tenantId) AS count FROM Community`),
      distinct(this.prisma.$queryRaw`SELECT COUNT(DISTINCT tenantId) AS count FROM TenantDomain WHERE type = 'CUSTOM' AND status = 'VERIFIED'`),
      distinct(this.prisma.$queryRaw`SELECT COUNT(DISTINCT tenantId) AS count FROM PaymentGatewayAccount WHERE isActive = 1`),
      distinct(this.prisma.$queryRaw`SELECT COUNT(DISTINCT tenantId) AS count FROM Coupon`),
      distinct(this.prisma.$queryRaw`SELECT COUNT(DISTINCT tenantId) AS count FROM SalesOffer WHERE status = 'ACTIVE'`),
      distinct(this.prisma.$queryRaw`SELECT COUNT(DISTINCT tenantId) AS count FROM PaymentLink`),
    ]);
    const features: Array<[string, number]> = [
      ['Published a course', courses], ['Accepts payments', payments], ['Live classes', live], ['Promo codes', coupons], ['Bundles', bundles],
      ['Digital products', products], ['Memberships', memberships], ['Communities', communities], ['Upsells & bumps', funnels], ['Payment links', links], ['Custom domain', customDomains],
    ];
    return {
      academies,
      features: features
        .map(([feature, count]) => ({ feature, academies: count, percent: academies ? round((count / academies) * 100) : 0 }))
        .sort((a, b) => b.academies - a.academies),
    };
  }
}
