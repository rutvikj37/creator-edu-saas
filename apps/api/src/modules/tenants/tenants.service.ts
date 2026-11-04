import { Injectable } from '@nestjs/common';
import { TENANT_ROLES } from '@ce/shared';
import { randomBytes } from 'node:crypto';
import { AppConfig } from '../../config/app-config.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { RESERVED_SLUGS } from '../../core/tenancy/host-resolver.service.js';
import { slugify } from './slug.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';

/** Tenant lifecycle operations that run inside a caller-provided transaction. */
@Injectable()
export class TenantsService {
  constructor(
    private readonly config: AppConfig,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async uniqueSlug(tx: Prisma.TransactionClient, name: string): Promise<string> {
    const base = slugify(name);
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? base : `${base.slice(0, 36)}-${i + 1}`;
      if (RESERVED_SLUGS.has(candidate)) continue;
      const taken = await tx.tenant.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!taken) return candidate;
    }
    return `${base.slice(0, 30)}-${randomBytes(4).toString('hex')}`;
  }

  /** Creates the tenant, its owner membership and default subdomain. */
  async createForOwner(tx: Prisma.TransactionClient, owner: { id: string; country?: string | null }, name: string) {
    const slug = await this.uniqueSlug(tx, name);
    const ownerRole = await tx.role.findUniqueOrThrow({ where: { uniqueKey: `system:${TENANT_ROLES.OWNER}` } });
    const tenant = await tx.tenant.create({
      data: {
        slug,
        name,
        ownerUserId: owner.id,
        country: owner.country ?? null,
        defaultCurrency: owner.country === 'IN' || !owner.country ? 'INR' : 'USD',
      },
    });
    await tx.tenantMember.create({ data: { tenantId: tenant.id, userId: owner.id, roleId: ownerRole.id } });
    await tx.tenantDomain.create({
      data: {
        tenantId: tenant.id,
        hostname: `${slug}.${this.config.get('PLATFORM_ROOT_DOMAIN')}`,
        type: 'SUBDOMAIN',
        isPrimary: true,
        status: 'VERIFIED',
        verificationToken: randomBytes(16).toString('hex'),
        verifiedAt: new Date(),
      },
    });
    await this.subscriptions.assignDefault(tx, tenant.id);
    return tenant;
  }
}
