import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { AppEvents } from '../../core/events/app-events.service.js';
import { safeEqual } from '../../core/crypto/crypto.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';

export interface CaptureInput {
  email: string;
  name?: string | null;
  phone?: string | null;
  source: string;
  /** true = explicit opt-in to marketing; false/undefined never removes an existing consent. */
  consent?: boolean;
  tags?: string[];
  ip?: string | null;
  userId?: string | null;
}

const normTags = (tags: string[] | undefined) => [...new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter((t) => t && t.length <= 40))].slice(0, 20);

/** Contacts of an academy and their marketing consent (append-only consent log). */
@Injectable()
export class LeadsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly events: AppEvents,
  ) {}

  private ipHash(ip?: string | null) {
    return ip ? createHash('sha256').update(ip).digest('hex') : null;
  }

  /** Creates or updates a lead. Consent is only ever granted here, never silently revoked. */
  async capture(input: CaptureInput) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.db.lead.findFirst({ where: { email } });
    const grant = input.consent === true && (!existing?.marketingConsent || existing.unsubscribedAt);
    const now = new Date();
    const lead = existing
      ? await this.db.lead.update({
          where: { id: existing.id },
          data: {
            name: existing.name ?? input.name?.trim() ?? null, phone: existing.phone ?? input.phone ?? null, userId: existing.userId ?? input.userId ?? null,
            tags: normTags([...(existing.tags as string[]), ...(input.tags ?? [])]),
            ...(grant ? { marketingConsent: true, consentAt: now, consentSource: input.source.slice(0, 60), unsubscribedAt: null } : {}),
          },
        })
      : await this.db.lead.create({
          data: {
            email, name: input.name?.trim() || null, phone: input.phone ?? null, source: input.source.slice(0, 60), tags: normTags(input.tags), userId: input.userId ?? null,
            marketingConsent: input.consent === true, consentAt: input.consent ? now : null, consentSource: input.consent ? input.source.slice(0, 60) : null,
          } as never,
        });
    if (grant || (!existing && input.consent)) await this.db.consentEvent.create({ data: { leadId: lead.id, action: 'GRANTED', source: input.source.slice(0, 60), ipHash: this.ipHash(input.ip) } as never });
    if (!existing) await this.events.emit('lead.created', { tenantId: lead.tenantId, leadId: lead.id, email: lead.email, source: lead.source });
    return lead;
  }

  /** Same as capture, for flows that run outside a request tenant context. */
  captureFor(tenantId: string, input: CaptureInput) {
    return this.ctx.run(tenantId, () => this.capture(input));
  }

  async list(params: { q?: string; tag?: string; consent?: 'yes' | 'no'; page?: number; pageSize?: number }) {
    const page = params.page ?? 1;
    const pageSize = Math.min(100, params.pageSize ?? 25);
    const where: Record<string, unknown> = {
      ...(params.q ? { OR: [{ email: { contains: params.q } }, { name: { contains: params.q } }] } : {}),
      ...(params.consent === 'yes' ? { marketingConsent: true, unsubscribedAt: null } : params.consent === 'no' ? { OR: [{ marketingConsent: false }, { unsubscribedAt: { not: null } }] } : {}),
      ...(params.tag ? { tags: { array_contains: params.tag.toLowerCase() } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.lead.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.db.lead.count({ where }),
    ]);
    return { items: items.map((l) => this.view(l)), meta: { page, pageSize, total } };
  }

  view(l: any) {
    return { ...l, canEmail: l.marketingConsent && !l.unsubscribedAt };
  }

  async get(id: string) {
    const l = await this.db.lead.findFirst({ where: { id } });
    if (!l) throw AppException.notFound('Contact not found');
    const events = await this.db.consentEvent.findMany({ where: { leadId: id }, orderBy: { createdAt: 'desc' }, select: { action: true, source: true, createdAt: true } });
    return { ...this.view(l), consentHistory: events };
  }

  async update(id: string, input: { name?: string | null; tags?: string[]; notes?: string | null }, actorUserId: string) {
    await this.get(id);
    const l = await this.db.lead.update({ where: { id }, data: { ...(input.name !== undefined ? { name: input.name?.trim() || null } : {}), ...(input.tags ? { tags: normTags(input.tags) } : {}), ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}) } });
    await this.audit.record({ action: 'lead.update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Lead', targetId: id });
    return this.view(l);
  }

  /** Erasure request: removes the contact and its consent log. */
  async remove(id: string, actorUserId: string) {
    await this.get(id);
    await this.db.consentEvent.deleteMany({ where: { leadId: id } });
    await this.db.campaignRecipient.deleteMany({ where: { leadId: id } });
    await this.db.lead.delete({ where: { id } });
    await this.audit.record({ action: 'lead.erase', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Lead', targetId: id });
    return { deleted: true };
  }

  /** Bulk import. Rows only count as consented when the creator confirms they hold that consent. */
  async import(rows: { email: string; name?: string; phone?: string; tags?: string[] }[], consentConfirmed: boolean, actorUserId: string) {
    let created = 0;
    let updated = 0;
    const invalid: string[] = [];
    for (const r of rows.slice(0, 5000)) {
      const email = r.email?.trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 191) {
        invalid.push(r.email);
        continue;
      }
      const exists = await this.db.lead.findFirst({ where: { email }, select: { id: true } });
      await this.capture({ email, name: r.name, phone: r.phone, tags: r.tags, source: 'import', consent: consentConfirmed });
      if (exists) updated++;
      else created++;
    }
    await this.audit.record({ action: 'lead.import', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Lead', after: { created, updated, invalid: invalid.length, consentConfirmed } });
    return { created, updated, invalid };
  }

  // ── unsubscribe tokens ────────────────────────────────────
  private sign(v: string) {
    return createHmac('sha256', this.config.get('JWT_ACCESS_SECRET')).update(`unsub:${v}`).digest('base64url');
  }

  unsubscribeToken(tenantId: string, leadId: string) {
    return `${tenantId}.${leadId}.${this.sign(`${tenantId}.${leadId}`)}`;
  }

  unsubscribeUrl(tenantId: string, leadId: string) {
    return `${this.config.get('API_PUBLIC_URL').replace(/\/$/, '')}/api/v1/public/unsubscribe?t=${encodeURIComponent(this.unsubscribeToken(tenantId, leadId))}`;
  }

  /** Public, host-independent: works from any email client. */
  async unsubscribe(token: string, ip?: string | null) {
    const [tenantId, leadId, sig] = token.split('.');
    if (!tenantId || !leadId || !sig || !safeEqual(sig, this.sign(`${tenantId}.${leadId}`))) throw AppException.notFound('Invalid unsubscribe link');
    return this.ctx.run(tenantId, async () => {
      const lead = await this.db.lead.findFirst({ where: { id: leadId } });
      if (!lead) return { unsubscribed: true };
      if (!lead.unsubscribedAt) {
        await this.db.lead.update({ where: { id: leadId }, data: { unsubscribedAt: new Date() } });
        await this.db.consentEvent.create({ data: { leadId, action: 'WITHDRAWN', source: 'unsubscribe_link', ipHash: this.ipHash(ip) } as never });
      }
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      return { unsubscribed: true, academy: tenant?.name ?? null };
    });
  }
}
