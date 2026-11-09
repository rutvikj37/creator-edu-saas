import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantScoped } from '../../common/decorators/auth.decorators.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { EntitlementsService } from '../subscriptions/entitlements.service.js';
import { AuthzService } from '../authz/authz.service.js';
import { CurrentAuth } from '../../common/decorators/auth.decorators.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { fromMinor, toMinor } from '../commerce/providers/money.js';
import { localDate } from '../live/recurrence.js';
import { isValidTimeZone } from '../../common/time/timezone.js';

const DAY = 86_400_000;
const PAID = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;

/** Percentage change from the previous period; null when there is nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Creator dashboard widgets from live data. Revenue/enrolment widgets join as those modules ship. */
@ApiTags('Creator · Dashboard')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/dashboard', version: '1' })
export class CreatorDashboardController {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly entitlements: EntitlementsService,
    private readonly authz: AuthzService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Workspace KPIs, last-30-day trends, setup checklist, recent activity and plan usage' })
  async get(@CurrentAuth() auth: AuthContext) {
    const tenantId = this.ctx.requireTenantId();
    const since = new Date(Date.now() - 30 * DAY);
    const perms = await this.authz.permissions(auth);
    const canSeeSales = perms.has('orders.read');
    const canSeeActivity = perms.has('settings.manage');
    const [byStatus, students, newStudents, staff, activity, ent, storage, last30, setup] = await Promise.all([
      this.db.course.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.user.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.user.count({ where: { tenantId, createdAt: { gte: since } } }),
      this.db.tenantMember.count({ where: { status: 'ACTIVE' } }),
      canSeeActivity ? this.prisma.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, action: true, createdAt: true, actorUserId: true } }) : Promise.resolve([]),
      this.entitlements.get(tenantId),
      this.db.fileAsset.aggregate({ where: { status: 'READY' }, _sum: { sizeBytes: true } }),
      this.last30(tenantId, canSeeSales),
      this.setup(tenantId),
    ]);
    const courses = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
    const actors = await this.prisma.user.findMany({ where: { id: { in: activity.map((a) => a.actorUserId).filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
    return {
      courses: { total: Object.entries(courses).filter(([k]) => k !== 'ARCHIVED').reduce((s, [, v]) => s + v, 0), published: courses.PUBLISHED ?? 0, draft: (courses.DRAFT ?? 0) + (courses.UNPUBLISHED ?? 0), scheduled: courses.SCHEDULED ?? 0 },
      students: { total: students, newLast30Days: newStudents },
      staff,
      usage: {
        courses: { used: (courses.DRAFT ?? 0) + (courses.PUBLISHED ?? 0) + (courses.SCHEDULED ?? 0) + (courses.UNPUBLISHED ?? 0), limit: ent.features['courses.max']?.limit ?? null },
        students: { used: students, limit: ent.features['students.max']?.limit ?? null },
        storageBytes: { used: Number(storage._sum.sizeBytes ?? 0), limit: ent.features['storage.gb']?.limit != null ? ent.features['storage.gb'].limit! * 1024 ** 3 : null },
      },
      plan: { name: ent.planName, status: ent.status },
      activity: activity.map((a) => ({ ...a, actor: actors.find((u) => u.id === a.actorUserId)?.fullName ?? null })),
      revenue: { available: false, reason: 'Revenue appears once payments are enabled.' },
      last30,
      setup,
    };
  }

  /**
   * Sign-ups, paying students and net revenue for the last 30 days, compared with the 30 days before,
   * plus a daily series (academy time zone) for sparklines. Sales figures need `orders.read`.
   */
  private async last30(tenantId: string, canSeeSales: boolean) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true, defaultCurrency: true } });
    const tz = t.timezone && isValidTimeZone(t.timezone) ? t.timezone : 'Asia/Kolkata';
    const currency = t.defaultCurrency;
    const now = Date.now();
    const curFrom = new Date(now - 30 * DAY);
    const prevFrom = new Date(now - 60 * DAY);
    const [users, orders, ledger] = await Promise.all([
      this.prisma.user.findMany({ where: { tenantId, realm: 'TENANT', deletedAt: null, createdAt: { gte: prevFrom } }, select: { createdAt: true } }),
      canSeeSales ? this.db.order.findMany({ where: { status: { in: [...PAID] }, paidAt: { gte: prevFrom } }, select: { userId: true, paidAt: true } }) : [],
      canSeeSales ? this.db.ledgerEntry.findMany({ where: { type: { in: ['SALE', 'REFUND'] }, currency, createdAt: { gte: prevFrom } }, select: { createdAt: true, amount: true } }) : [],
    ]);
    const days: string[] = [];
    for (let i = 29; i >= 0; i--) days.push(localDate(new Date(now - i * DAY), tz));
    const series = new Map([...new Set(days)].map((d) => [d, { date: d, signups: 0, paidUsers: new Set<string>(), revenue: 0 }]));
    const isCur = (d: Date) => d.getTime() >= curFrom.getTime();

    let signups = 0, prevSignups = 0;
    for (const u of users) {
      if (isCur(u.createdAt)) { signups++; const s = series.get(localDate(u.createdAt, tz)); if (s) s.signups++; } else prevSignups++;
    }
    const payers = new Set<string>(), prevPayers = new Set<string>();
    for (const o of orders) {
      if (!o.paidAt) continue;
      if (isCur(o.paidAt)) { payers.add(o.userId); series.get(localDate(o.paidAt, tz))?.paidUsers.add(o.userId); } else prevPayers.add(o.userId);
    }
    let revenue = 0, prevRevenue = 0;
    for (const l of ledger) {
      const minor = toMinor(l.amount, currency);
      if (isCur(l.createdAt)) { revenue += minor; const s = series.get(localDate(l.createdAt, tz)); if (s) s.revenue += minor; } else prevRevenue += minor;
    }
    return {
      currency,
      asOf: new Date(now).toISOString(),
      signups: { value: signups, previous: prevSignups, change: percentChange(signups, prevSignups) },
      paidUsers: canSeeSales ? { value: payers.size, previous: prevPayers.size, change: percentChange(payers.size, prevPayers.size) } : null,
      revenue: canSeeSales ? { value: fromMinor(revenue, currency), previous: fromMinor(prevRevenue, currency), change: percentChange(revenue, prevRevenue) } : null,
      series: [...series.values()].map((s) => ({ date: s.date, signups: s.signups, paidUsers: s.paidUsers.size, revenue: canSeeSales ? fromMinor(s.revenue, currency) : null })),
    };
  }

  /** Launch checklist: what an academy still needs before it can sell and grow. */
  private async setup(tenantId: string) {
    const [tenant, gateways, published, students, live, communities] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { status: true } }),
      this.db.paymentGatewayAccount.count({ where: { isActive: true } }),
      this.db.course.count({ where: { status: 'PUBLISHED', deletedAt: null } }),
      this.prisma.user.count({ where: { tenantId, realm: 'TENANT', deletedAt: null } }),
      this.db.liveClass.count(),
      this.db.community.count(),
    ]);
    return [
      { key: 'publish_academy', done: tenant.status === 'ACTIVE' },
      { key: 'connect_payments', done: gateways > 0 },
      { key: 'publish_course', done: published > 0 },
      { key: 'add_students', done: students > 0 },
      { key: 'schedule_live', done: live > 0 },
      { key: 'start_community', done: communities > 0 },
    ];
  }
}
