import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { CryptoService } from '../../core/crypto/crypto.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { PaymentProviders } from './providers/registry.js';
import { type GatewayCredentials, ProviderError } from './providers/types.js';

export const RAZORPAY_KEY_ID = /^rzp_(test|live)_[A-Za-z0-9]{8,32}$/;

export interface SaveRazorpayInput {
  keyId: string;
  /** Omitted on update keeps the stored secret. */
  keySecret?: string;
  webhookSecret?: string | null;
}

type Account = Awaited<ReturnType<TenantPrismaClient['paymentGatewayAccount']['findFirst']>> & {};

/**
 * The academy's own Razorpay account (creator-owned merchant model: money settles directly to the
 * creator). Secrets are encrypted at rest and never returned. Selling requires a successful
 * credential check against Razorpay.
 */
@Injectable()
export class GatewayService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly providers: PaymentProviders,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly ctx: TenantContext,
  ) {}

  webhookUrl(accountId: string) {
    return `${this.config.get('API_PUBLIC_URL').replace(/\/$/, '')}/api/v1/webhooks/razorpay/${accountId}`;
  }

  view(a: Account | null) {
    if (!a) return { provider: 'RAZORPAY', configured: false, status: null };
    return {
      id: a.id, provider: a.provider, configured: true, mode: a.mode, keyId: a.publicKey, status: a.status, isActive: a.isActive,
      hasWebhookSecret: Boolean(a.webhookSecretEnc), webhookUrl: this.webhookUrl(a.id),
      webhookEvents: ['payment.captured', 'payment.failed', 'order.paid', 'refund.processed', 'refund.failed'],
      lastVerifiedAt: a.lastVerifiedAt, lastError: a.lastError, updatedAt: a.updatedAt,
    };
  }

  async get() {
    return this.view(await this.db.paymentGatewayAccount.findFirst({ where: { provider: 'RAZORPAY' } }));
  }

  async save(input: SaveRazorpayInput, actorUserId: string) {
    const keyId = input.keyId.trim();
    const m = RAZORPAY_KEY_ID.exec(keyId);
    if (!m) throw AppException.validation([{ field: 'keyId', message: 'Enter a Razorpay key id (rzp_test_… or rzp_live_…)' }]);
    const existing = await this.db.paymentGatewayAccount.findFirst({ where: { provider: 'RAZORPAY' } });
    if (!existing && !input.keySecret) throw AppException.validation([{ field: 'keySecret', message: 'Enter the key secret' }]);
    const data = {
      mode: m[1] === 'live' ? ('LIVE' as const) : ('TEST' as const),
      publicKey: keyId,
      ...(input.keySecret ? { secretEnc: this.crypto.encrypt(input.keySecret.trim()) } : {}),
      ...(input.webhookSecret !== undefined ? { webhookSecretEnc: input.webhookSecret ? this.crypto.encrypt(input.webhookSecret.trim()) : null } : {}),
      // Any change must be re-verified before the academy can sell again.
      status: 'CONFIGURED' as const, lastError: null, isActive: true,
    };
    const a = existing
      ? await this.db.paymentGatewayAccount.update({ where: { id: existing.id }, data })
      : await this.db.paymentGatewayAccount.create({ data: { ...data, provider: 'RAZORPAY', isDefault: true, createdById: actorUserId, secretEnc: data.secretEnc! } as never });
    await this.audit.record({ action: 'payments.gateway.save', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'PaymentGatewayAccount', targetId: a.id, after: { keyId, mode: data.mode, secretChanged: Boolean(input.keySecret) } });
    return this.verify(actorUserId);
  }

  /** Calls Razorpay with the stored keys and records the outcome. */
  async verify(actorUserId?: string) {
    const a = await this.db.paymentGatewayAccount.findFirst({ where: { provider: 'RAZORPAY' } });
    if (!a) throw AppException.integrationNotConfigured('Razorpay');
    try {
      await this.providers.get('RAZORPAY').verifyCredentials(this.decrypt(a));
      await this.db.paymentGatewayAccount.update({ where: { id: a.id }, data: { status: 'VERIFIED', lastVerifiedAt: new Date(), lastError: null } });
    } catch (e) {
      const msg = e instanceof ProviderError ? (e.authFailed ? 'Razorpay rejected these keys' : e.message) : 'Could not reach Razorpay';
      await this.db.paymentGatewayAccount.update({ where: { id: a.id }, data: { status: 'ERROR', lastError: msg.slice(0, 500) } });
    }
    if (actorUserId) await this.audit.record({ action: 'payments.gateway.verify', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'PaymentGatewayAccount', targetId: a.id });
    return this.get();
  }

  async setActive(isActive: boolean, actorUserId: string) {
    const a = await this.db.paymentGatewayAccount.findFirst({ where: { provider: 'RAZORPAY' } });
    if (!a) throw AppException.integrationNotConfigured('Razorpay');
    await this.db.paymentGatewayAccount.update({ where: { id: a.id }, data: { isActive } });
    await this.audit.record({ action: isActive ? 'payments.gateway.enable' : 'payments.gateway.disable', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'PaymentGatewayAccount', targetId: a.id });
    return this.get();
  }

  async remove(actorUserId: string) {
    const a = await this.db.paymentGatewayAccount.findFirst({ where: { provider: 'RAZORPAY' } });
    if (!a) return { removed: false };
    const used = await this.db.payment.count({ where: { gatewayAccountId: a.id } });
    if (used) throw AppException.conflict('This account has payments on record. Disable it instead so refunds keep working.');
    await this.db.paymentGatewayAccount.delete({ where: { id: a.id } });
    await this.audit.record({ action: 'payments.gateway.remove', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'PaymentGatewayAccount', targetId: a.id });
    return { removed: true };
  }

  decrypt(a: { id: string; provider: 'RAZORPAY'; mode: 'TEST' | 'LIVE'; publicKey: string; secretEnc: string; webhookSecretEnc: string | null }): GatewayCredentials {
    return {
      accountId: a.id, provider: a.provider, mode: a.mode, publicKey: a.publicKey,
      secret: this.crypto.decrypt(a.secretEnc), webhookSecret: a.webhookSecretEnc ? this.crypto.decrypt(a.webhookSecretEnc) : null,
    };
  }

  /** The account that takes new payments, or null when selling is not possible. */
  async sellingAccount() {
    const a = await this.db.paymentGatewayAccount.findFirst({ where: { provider: 'RAZORPAY', isActive: true, status: 'VERIFIED' } });
    return a ? { account: a, creds: this.decrypt(a) } : null;
  }

  /** Credentials by id for any tenant (webhooks, background jobs). Used only outside request tenant context. */
  async credentialsById(accountId: string) {
    const a = await this.prisma.paymentGatewayAccount.findUnique({ where: { id: accountId } });
    return a ? { account: a, creds: this.decrypt(a) } : null;
  }
}
