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
