import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ERROR_CODES } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { QUEUES } from '../../core/queue/queue.constants.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { GatewayService } from './gateway.service.js';
import { OrdersService } from './orders.service.js';
import { PaymentProviders } from './providers/registry.js';
import { InvalidSignatureError } from './providers/types.js';

export const WEBHOOK_JOB = 'razorpay-event';

/**
 * Razorpay webhooks: verify signature on the raw body → store once (unique event id) → ack fast →
 * process in the worker. Processing never trusts the payload: it re-reads the payment or refund
 * from Razorpay, so duplicates and out-of-order delivery are harmless.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateways: GatewayService,
    private readonly providers: PaymentProviders,
    private readonly orders: OrdersService,
    private readonly ctx: TenantContext,
    @InjectQueue(QUEUES.WEBHOOKS_IN) private readonly queue: Queue,
  ) {}

  async receive(accountId: string, rawBody: Buffer | undefined, headers: Record<string, string | undefined>) {
    const account = await this.gateways.credentialsById(accountId);
    if (!account || !rawBody?.length) throw AppException.notFound('Unknown webhook endpoint');
    let event;
    try {
      event = await this.providers.get('RAZORPAY').verifyWebhook(account.creds, rawBody, headers);
    } catch (e) {
      if (e instanceof InvalidSignatureError) {
        this.logger.warn({ accountId }, 'rejected Razorpay webhook with invalid signature');
        throw new AppException(ERROR_CODES.UNAUTHENTICATED, 'Invalid webhook signature', HttpStatus.UNAUTHORIZED);
      }
      throw AppException.validation([{ field: 'body', message: 'Malformed webhook payload' }]);
    }
    const existing = await this.prisma.webhookEvent.findUnique({ where: { provider_eventId: { provider: 'RAZORPAY', eventId: event.eventId } } });
    if (existing) return { received: true, duplicate: true };
    let row;
    try {
      row = await this.prisma.webhookEvent.create({
        data: {
          provider: 'RAZORPAY', gatewayAccountId: accountId, tenantId: account.account.tenantId, eventId: event.eventId, type: event.type.slice(0, 100),
          payload: event.payload as never, status: event.kind === 'ignore' ? 'IGNORED' : 'RECEIVED', processedAt: event.kind === 'ignore' ? new Date() : null,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') return { received: true, duplicate: true };
      throw e;
    }
    if (event.kind !== 'ignore') await this.queue.add(WEBHOOK_JOB, { id: row.id }, { jobId: row.id });
    return { received: true };
  }

  /** Worker entry point. Throws to let BullMQ retry transient failures. */
  async process(id: string) {
    const row = await this.prisma.webhookEvent.findUnique({ where: { id } });
    if (!row || row.status === 'PROCESSED' || row.status === 'IGNORED' || !row.tenantId || !row.gatewayAccountId) return 'skipped';
    const account = await this.gateways.credentialsById(row.gatewayAccountId);
    if (!account) return this.finish(id, 'IGNORED', 'Gateway account removed');
    const adapter = this.providers.get('RAZORPAY');
    // The signature was verified at receipt; only the ids are read from the stored payload.
    const parsed = this.normalizeStored(row.type, row.payload as any);
    try {
      const outcome = await this.ctx.run(row.tenantId, async () => {
        if (parsed.kind === 'payment' && parsed.providerOrderId) {
          const payment = await this.prisma.payment.findFirst({ where: { provider: 'RAZORPAY', providerOrderId: parsed.providerOrderId, tenantId: row.tenantId! } });
          if (!payment) return { status: 'IGNORED' as const, note: 'No matching payment (order created outside this academy)' };
          const r = await adapter.fetchPayment(account.creds, { providerOrderId: payment.providerOrderId, currency: payment.currency });
          return { status: 'PROCESSED' as const, note: await this.orders.applyPaymentResult(payment.id, r) };
        }
        if (parsed.kind === 'refund' && parsed.providerRefundId) {
          const refund = await this.prisma.refund.findFirst({ where: { providerRefundId: parsed.providerRefundId, tenantId: row.tenantId! } });
          if (!refund) {
            // Our refund row is written right after Razorpay answers; give that a moment before ignoring.
            if (Date.now() - row.receivedAt.getTime() < 2 * 60_000) throw new Error('Refund not recorded yet');
            return { status: 'IGNORED' as const, note: 'Refund was not initiated from this academy' };
          }
          const s = await adapter.fetchRefund(account.creds, parsed.providerRefundId);
          return { status: 'PROCESSED' as const, note: await this.orders.applyRefundStatus(refund.id, s.status) };
        }
        return { status: 'IGNORED' as const, note: 'Not relevant' };
      });
      return this.finish(id, outcome.status, outcome.note);
    } catch (e) {
      await this.prisma.webhookEvent.update({ where: { id }, data: { attempts: { increment: 1 }, error: (e as Error).message.slice(0, 1000), status: 'FAILED' } });
      throw e;
    }
  }

  private normalizeStored(type: string, body: any) {
    if (type.startsWith('payment.') || type === 'order.paid') return { kind: 'payment' as const, providerOrderId: body?.payload?.payment?.entity?.order_id ?? body?.payload?.order?.entity?.id ?? null, providerRefundId: null };
    if (type.startsWith('refund.')) return { kind: 'refund' as const, providerOrderId: null, providerRefundId: body?.payload?.refund?.entity?.id ?? null };
    return { kind: 'ignore' as const, providerOrderId: null, providerRefundId: null };
  }

  private async finish(id: string, status: 'PROCESSED' | 'IGNORED', note: string) {
    await this.prisma.webhookEvent.update({ where: { id }, data: { status, error: status === 'IGNORED' ? note : null, processedAt: new Date(), attempts: { increment: 1 } } });
    return note;
  }
}
