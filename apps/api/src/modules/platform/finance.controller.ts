import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { RequirePermissions, RequireRealm } from '../../common/decorators/auth.decorators.js';
import { Paginated } from '../../common/interceptors/response-envelope.interceptor.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { DashboardService, resolveRange } from './dashboard.service.js';
import { DateRangeQuery } from './dto/platform.dto.js';

class TransactionsQuery {
  @IsOptional() @IsIn(['CREATED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

/** Cross-academy view of sales for finance administrators (read-only). */
@ApiTags('Platform · Finance')
@ApiBearerAuth()
@RequireRealm('PLATFORM')
@Controller({ path: 'platform/finance', version: '1' })
export class FinanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
  ) {}

  @Get('overview')
  @RequirePermissions(PERMISSIONS.PLATFORM_FINANCE_READ)
  @ApiOperation({ summary: 'Academy sales (GMV), refunds and platform commission from the ledger' })
  overview(@Query() q: DateRangeQuery) {
    const { start, end } = resolveRange(q.from, q.to);
    return this.dashboard.commerce(start, end);
  }

  @Get('tax')
  @RequirePermissions(PERMISSIONS.PLATFORM_FINANCE_READ)
  @ApiOperation({ summary: 'GST on paid platform invoices (plans, renewals, commission): totals, by month, by rate, and the invoice register' })
  async tax(@Query() q: DateRangeQuery) {
    const { start, end } = resolveRange(q.from, q.to);
    const rows = await this.prisma.billingInvoice.findMany({
      where: { status: 'PAID', paidAt: { gte: start, lte: end } }, orderBy: { paidAt: 'asc' }, take: 5000,
      select: { id: true, tenantId: true, number: true, kind: true, currency: true, subtotalAmount: true, creditAmount: true, taxAmount: true, totalAmount: true, taxRate: true, paidAt: true, paidVia: true },
    });
    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true, slug: true } });
    const byId = new Map(tenants.map((t) => [t.id, t]));
    const round = (n: number) => Math.round(n * 100) / 100;
    const invoices = rows.map((r) => {
      const total = Number(r.totalAmount);
      const tax = Number(r.taxAmount);
      return {
        id: r.id, number: r.number, kind: r.kind, tenant: byId.get(r.tenantId) ?? null, currency: r.currency, paidAt: r.paidAt, paidVia: r.paidVia,
        taxRate: r.taxRate === null ? null : Number(r.taxRate), taxable: round(total - tax), tax: round(tax), total: round(total),
      };
    });
    type Bucket = { currency: string; invoices: number; taxable: number; tax: number; total: number };
    const add = (map: Map<string, Bucket & Record<string, unknown>>, key: string, extra: Record<string, unknown>, i: (typeof invoices)[number]) => {
      const b = map.get(key) ?? { currency: i.currency, invoices: 0, taxable: 0, tax: 0, total: 0, ...extra };
      b.invoices += 1; b.taxable = round(b.taxable + i.taxable); b.tax = round(b.tax + i.tax); b.total = round(b.total + i.total);
      map.set(key, b);
    };
    const totals = new Map<string, Bucket>();
    const months = new Map<string, Bucket & { month: string }>();
    const rates = new Map<string, Bucket & { rate: number | null }>();
    const kinds = new Map<string, Bucket & { kind: string }>();
    for (const i of invoices) {
      const month = i.paidAt!.toISOString().slice(0, 7);
      add(totals as never, i.currency, {}, i);
      add(months as never, `${month}|${i.currency}`, { month }, i);
      add(rates as never, `${i.taxRate ?? 'none'}|${i.currency}`, { rate: i.taxRate }, i);
      add(kinds as never, `${i.kind}|${i.currency}`, { kind: i.kind }, i);
    }
    return {
      from: start, to: end, totals: [...totals.values()], months: [...months.values()], rates: [...rates.values()].sort((a, b) => (a.rate ?? -1) - (b.rate ?? -1)),
      kinds: [...kinds.values()], invoices: invoices.reverse(), truncated: rows.length === 5000,
    };
  }

  @Get('transactions')
  @RequirePermissions(PERMISSIONS.PLATFORM_FINANCE_READ)
  @ApiOperation({ summary: 'Razorpay payments across all academies' })
  async transactions(@Query() q: TransactionsQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where = q.status ? { status: q.status as never } : {};
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({ where, include: { order: { select: { number: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.payment.count({ where }),
    ]);
    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true, slug: true } });
    const byId = new Map(tenants.map((t) => [t.id, t]));
    return new Paginated(
      rows.map((p) => ({
        id: p.id, tenant: byId.get(p.tenantId) ?? null, orderNumber: p.order.number, provider: p.provider, providerPaymentId: p.providerPaymentId,
        status: p.status, amount: p.amount.toString(), currency: p.currency, method: p.method, feeAmount: p.feeAmount?.toString() ?? null, createdAt: p.createdAt, capturedAt: p.capturedAt,
      })),
      { page, pageSize, total },
    );
  }
}
