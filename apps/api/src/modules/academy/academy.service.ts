import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { HostResolverService } from '../../core/tenancy/host-resolver.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { FilesService } from '../files/files.service.js';
import { financialYear, invoiceNumber } from '../commerce/invoice-number.js';
import { FONT_CHOICES, type UpdateAcademyDto, type UpdateBusinessDto } from './dto/academy.dto.js';

export const ONBOARDING_STEPS = ['name', 'category', 'logo', 'colors', 'description', 'business', 'gst', 'plan', 'payment', 'publish'] as const;

@Injectable()
export class AcademyService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly hosts: HostResolverService,
  ) {}

  private async ensure() {
    const existing = await this.db.academy.findFirst({});
    return existing ?? this.db.academy.create({ data: {} as never });
  }

  async get(apiOrigin: string) {
    const tenantId = this.ctx.requireTenantId();
    const [academy, tenant] = await Promise.all([this.ensure(), this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, slug: true, status: true } })]);
    return {
      ...academy,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      logoUrl: await this.files.urlFor(academy.logoFileId, apiOrigin),
      faviconUrl: await this.files.urlFor(academy.faviconFileId, apiOrigin),
      fontChoices: FONT_CHOICES,
    };
  }

  async update(dto: UpdateAcademyDto, actorUserId: string, apiOrigin: string) {
    const tenantId = this.ctx.requireTenantId();
    if (dto.logoFileId) await this.files.assertUsable(dto.logoFileId, ['LOGO', 'IMAGE']);
    if (dto.faviconFileId) await this.files.assertUsable(dto.faviconFileId, ['FAVICON', 'LOGO']);
    for (const f of [dto.fontHeading, dto.fontBody]) if (f && !FONT_CHOICES.includes(f)) throw AppException.validation([{ field: 'font', message: 'Choose a font from the list' }]);
    if (dto.categorySlug) {
      const cat = await this.prisma.courseCategory.findFirst({ where: { slug: dto.categorySlug, scopeKey: 'platform' } });
      if (!cat) throw AppException.validation([{ field: 'categorySlug', message: 'Unknown category' }]);
    }
    const academy = await this.ensure();
    const { name, ...rest } = dto;
    await this.db.academy.update({ where: { id: academy.id }, data: { ...rest, socialLinks: rest.socialLinks as never } });
    if (name) await this.prisma.tenant.update({ where: { id: tenantId }, data: { name } });
    await this.audit.record({ action: 'academy.update', tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Academy', targetId: academy.id, after: dto });
    return this.get(apiOrigin);
  }

  async getBusiness() {
    const b = await this.db.tenantBusinessProfile.findFirst({});
    return b ?? this.db.tenantBusinessProfile.create({ data: {} as never });
  }

  /** The business profile plus the number the next invoice will get. */
  async businessView() {
    const b = await this.getBusiness();
    const fy = financialYear(new Date());
    const seq = await this.prisma.tenantSequence.findUnique({ where: { tenantId_name: { tenantId: this.ctx.requireTenantId(), name: `invoice:${fy}` } } }).catch(() => null);
    return { ...b, nextInvoiceNumber: invoiceNumber(b.invoicePrefix || 'INV', fy, b.invoiceStartNumber, Number((seq as { value?: number } | null)?.value ?? 0) + 1) };
  }

  async updateBusiness(dto: UpdateBusinessDto, actorUserId: string) {
    if (dto.gstRegistered && dto.gstin === '') throw AppException.validation([{ field: 'gstin', message: 'Enter your GSTIN or turn off GST registration' }]);
    const b = await this.getBusiness();
    const clean = { ...dto, ...(dto.gstin !== undefined ? { gstin: dto.gstin || null } : {}), ...(dto.pan !== undefined ? { pan: dto.pan || null } : {}),
      ...(dto.taxDetails !== undefined ? { taxDetails: dto.taxDetails?.trim() || null } : {}), ...(dto.invoiceNote !== undefined ? { invoiceNote: dto.invoiceNote?.trim() || null } : {}) };
    const updated = await this.db.tenantBusinessProfile.update({ where: { id: b.id }, data: clean });
    await this.audit.record({ action: 'academy.business_update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'TenantBusinessProfile', targetId: b.id, after: dto });
    return updated;
  }

  /** Onboarding state is derived from real data so it can be resumed from any device. */
  async onboarding(userId: string) {
    const tenantId = this.ctx.requireTenantId();
    const [tenant, academy, business, sub, owner] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      this.ensure(),
      this.getBusiness(),
      this.prisma.subscription.findFirst({ where: { tenantId, currentKey: 'current' }, include: { plan: true } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } }),
    ]);
    const checks = {
      name: tenant.name.trim().length >= 2,
      category: Boolean(academy.categorySlug),
      logo: Boolean(academy.logoFileId),
      colors: academy.primaryColor !== '#4f46e5' || academy.accentColor !== '#0d9488' || tenant.onboardingStep > 4,
      description: (academy.description ?? '').trim().length >= 20,
      business: Boolean(business.legalName && business.addressLine1 && business.city && business.country),
      gst: !business.gstRegistered || Boolean(business.gstin),
      plan: Boolean(sub),
      payment: Boolean(sub && ['TRIALING', 'ACTIVE'].includes(sub.status)),
      publish: tenant.status === 'ACTIVE' && Boolean(academy.publishedAt),
    };
    const blockers: string[] = [];
    if (!owner.emailVerifiedAt) blockers.push('Verify your email address');
    if (!checks.name) blockers.push('Add an academy name');
    if (!checks.description) blockers.push('Add a description of at least 20 characters');
    if (!checks.gst) blockers.push('Enter your GSTIN or turn off GST registration');
    if (!checks.payment) blockers.push('Choose an active plan');
    const done = ONBOARDING_STEPS.filter((s) => checks[s]).length;
    return {
      currentStep: tenant.onboardingStep,
      completedAt: tenant.onboardingCompletedAt,
      status: tenant.status,
      steps: ONBOARDING_STEPS.map((key, i) => ({ step: i + 1, key, complete: checks[key] })),
      progress: Math.round((done / ONBOARDING_STEPS.length) * 100),
      plan: sub ? { name: sub.plan.name, status: sub.status, trialEndsAt: sub.trialEndsAt } : null,
      canPublish: blockers.length === 0 && tenant.status === 'ONBOARDING',
      blockers,
    };
  }

  async saveStep(step: number) {
    const tenantId = this.ctx.requireTenantId();
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { onboardingStep: step } });
  }

  async publish(userId: string) {
    const tenantId = this.ctx.requireTenantId();
    const state = await this.onboarding(userId);
    if (state.status === 'ACTIVE') return state;
    if (!state.canPublish) throw new AppException(ERROR_CODES.VALIDATION_FAILED, `Before publishing: ${state.blockers.join('; ')}.`, HttpStatus.UNPROCESSABLE_ENTITY, state.blockers.map((b) => ({ field: 'publish', message: b })));
    const academy = await this.ensure();
    await this.prisma.$transaction([
      this.prisma.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE', onboardingCompletedAt: new Date(), onboardingStep: 10 } }),
      this.prisma.academy.update({ where: { id: academy.id }, data: { publishedAt: new Date() } }),
    ]);
    const domains = await this.db.tenantDomain.findMany({ select: { hostname: true } });
    await this.hosts.invalidate(...domains.map((d) => d.hostname));
    await this.audit.record({ action: 'academy.publish', tenantId, actorUserId: userId, actorRealm: 'PLATFORM', targetType: 'Tenant', targetId: tenantId });
    return this.onboarding(userId);
  }
}
